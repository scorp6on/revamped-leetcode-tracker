import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, type NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cr from "aws-cdk-lib/custom-resources";
import * as triggers from "aws-cdk-lib/triggers";
import type { Construct } from "constructs";

interface AppStackProps extends cdk.StackProps {
  stage: "dev" | "prod";
}

const repoRoot = path.join(__dirname, "../..");

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    // Dev can be torn down freely; prod keeps its data even if the stack is deleted.
    const removalPolicy =
      props.stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // Single table (decision #28). GSI1 is overloaded: attempts sit in its ATTEMPTS "drawer" by time,
    // schedules in its DUE drawer by due date. DynamoDB adds only one index per update, so new
    // access patterns get new drawers rather than new indexes.
    const table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy,
      globalSecondaryIndexes: [
        {
          indexName: "GSI1",
          partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // Seed the item the health check reads.
    new cr.AwsCustomResource(this, "SeedHealthItem", {
      onCreate: {
        service: "DynamoDB",
        action: "putItem",
        parameters: {
          TableName: table.tableName,
          Item: { PK: { S: "HEALTH" }, SK: { S: "HEALTH" } },
        },
        physicalResourceId: cr.PhysicalResourceId.of("health-item"),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [table.tableArn] }),
      installLatestAwsSdk: false, // putItem is in Lambda's built-in SDK
    });

    // Secrets are written by `npm run set-password` (CloudFormation can't create SecureStrings).
    const paramPrefix = `/leetcode-tracker/${props.stage}`;
    const canReadSecret = (fn: lambda.IFunction, name: "password-hash" | "jwt-secret") =>
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ssm:GetParameter"],
          resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${paramPrefix}/${name}`],
        }),
      );

    const fn = (id: string, file: string, extra: Partial<NodejsFunctionProps> = {}) =>
      new NodejsFunction(this, id, {
        entry: path.join(repoRoot, "api/src", file),
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: { TABLE_NAME: table.tableName, PARAM_PREFIX: paramPrefix },
        ...extra,
      });

    const health = fn("HealthFn", "health.ts");
    table.grantReadData(health);

    // bcrypt is deliberately slow; more memory means more CPU, so the check stays well under a second.
    const login = fn("LoginFn", "login.ts", { memorySize: 512, timeout: cdk.Duration.seconds(10) });
    canReadSecret(login, "password-hash");
    canReadSecret(login, "jwt-secret");
    // The login Lambda may only touch the lockout item, never practice data.
    login.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        resources: [table.tableArn],
        conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["AUTH"] } },
      }),
    );

    const logout = fn("LogoutFn", "logout.ts");

    const authorizerFn = fn("AuthorizerFn", "authorizer.ts");
    canReadSecret(authorizerFn, "jwt-secret");
    const authorizer = new HttpLambdaAuthorizer("CookieAuthorizer", authorizerFn, {
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      // No Cookie header at all → API Gateway answers 401 without running the authorizer.
      identitySource: ["$request.header.Cookie"],
      resultsCacheTtl: cdk.Duration.seconds(0),
    });

    const api = new apigw.HttpApi(this, "Api");
    const route = (
      routePath: string,
      method: apigw.HttpMethod,
      handler: lambda.IFunction,
      isPublic = false,
    ) =>
      api.addRoutes({
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${handler.node.id}Integration`, handler),
        ...(isPublic ? {} : { authorizer }),
      });

    // Public routes: everything else must go through the authorizer.
    route("/api/health", apigw.HttpMethod.GET, health, true);
    route("/api/login", apigw.HttpMethod.POST, login, true);
    route("/api/logout", apigw.HttpMethod.POST, logout, true);

    // One API Lambda for every app route (#26, #49), so it stays warm across pages.
    // Waits on LeetCode for problem statements, which can be slow.
    const apiFn = fn("ApiFn", "api.ts", { timeout: cdk.Duration.seconds(10) });
    // Practice data only: PROBLEM# items, and the DUE / ATTEMPTS drawers of GSI1. Never AUTH or HEALTH.
    // A transaction is checked as its parts (Put, Update, ConditionCheck) on each item.
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:ConditionCheckItem",
        ],
        resources: [table.tableArn],
        conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["PROBLEM#*"] } },
      }),
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [`${table.tableArn}/index/GSI1`],
        conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["DUE", "ATTEMPTS"] } },
      }),
    );
    route("/api/me", apigw.HttpMethod.GET, apiFn);
    route("/api/problems/{slug}", apigw.HttpMethod.GET, apiFn);
    route("/api/predictions", apigw.HttpMethod.POST, apiFn);
    route("/api/attempts", apigw.HttpMethod.POST, apiFn);
    route("/api/schedule", apigw.HttpMethod.GET, apiFn);

    const site = new s3.Bucket(this, "Site", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: props.stage === "dev",
    });

    // One domain for the app and the API: /api/* goes to API Gateway, everything else to S3.
    const apiDomain = cdk.Fn.select(2, cdk.Fn.split("/", api.apiEndpoint));
    // App routes like /problems/two-sum aren't files: serve index.html and let the router take over.
    // Only on the S3 behavior, so /api/* responses (e.g. the authorizer's 403) pass through untouched.
    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (r.uri.indexOf('.') === -1) { r.uri = '/index.html'; } return r; }",
      ),
    });
    const distribution = new cloudfront.Distribution(this, "Cdn", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.HttpOrigin(apiDomain),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    // web/dist must be built before synth (`npm run build -w web`).
    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset(path.join(repoRoot, "web/dist"))],
      destinationBucket: site,
      distribution,
      // data/ is written by the Catalog Lambda; without this, every web deploy would delete it.
      exclude: ["data/*"],
    });

    // Catalog (decision #29): LeetCode's public problem list → s3://site/data/catalog.json.
    const catalogFn = fn("CatalogFn", "catalog.ts", {
      timeout: cdk.Duration.minutes(3),
      memorySize: 256,
      environment: { SITE_BUCKET: site.bucketName },
    });
    site.grantPut(catalogFn, "data/*");

    new events.Rule(this, "WeeklyCatalog", {
      schedule: events.Schedule.rate(cdk.Duration.days(7)),
      targets: [new targets.LambdaFunction(catalogFn)],
    });

    // Also runs during a deploy whenever its code changes (including the first deploy).
    new triggers.Trigger(this, "CatalogOnDeploy", {
      handler: catalogFn,
      timeout: cdk.Duration.minutes(3),
    });

    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
