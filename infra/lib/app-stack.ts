import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cr from "aws-cdk-lib/custom-resources";
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

    // Single table (decision #28). Indexes are added in the milestones that need them.
    const table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy,
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

    const health = new NodejsFunction(this, "HealthFn", {
      entry: path.join(repoRoot, "api/src/health.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: { TABLE_NAME: table.tableName },
    });
    table.grantReadData(health);

    const api = new apigw.HttpApi(this, "Api");
    api.addRoutes({
      path: "/api/health",
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration("HealthIntegration", health),
    });

    const site = new s3.Bucket(this, "Site", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: props.stage === "dev",
    });

    // One domain for the app and the API: /api/* goes to API Gateway, everything else to S3.
    const apiDomain = cdk.Fn.select(2, cdk.Fn.split("/", api.apiEndpoint));
    const distribution = new cloudfront.Distribution(this, "Cdn", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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
    });

    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
