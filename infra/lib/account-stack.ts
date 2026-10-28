import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

interface AccountStackProps extends cdk.StackProps {
  repo: string;
  budgetEmail?: string;
}

export class AccountStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AccountStackProps) {
    super(scope, id, props);

    const github = new iam.CfnOIDCProvider(this, "GithubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIdList: ["sts.amazonaws.com"],
    });

    // A GitHub job's OIDC "sub" claim names its environment, e.g.
    // repo:owner/name:environment:prod. Each role trusts only its own environment
    // (dev also allows PR jobs, which only run `cdk diff`).
    const deployRole = (stage: "dev" | "prod", subjects: string[]) => {
      const role = new iam.Role(this, `Deploy-${stage}`, {
        roleName: `leettracker-deploy-${stage}`,
        assumedBy: new iam.WebIdentityPrincipal(github.attrArn, {
          StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
          StringLike: { "token.actions.githubusercontent.com:sub": subjects },
        }),
        maxSessionDuration: cdk.Duration.hours(1),
      });
      // CDK deploys through the roles `cdk bootstrap` created, so this role only needs to assume them.
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["sts:AssumeRole"],
          resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
        }),
      );
      return role;
    };

    deployRole("dev", [`repo:${props.repo}:environment:dev`, `repo:${props.repo}:pull_request`]);
    deployRole("prod", [`repo:${props.repo}:environment:prod`]);

    if (props.budgetEmail) {
      const email = props.budgetEmail;
      new budgets.CfnBudget(this, "MonthlyBudget", {
        budget: {
          budgetName: "leettracker-monthly",
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: 5, unit: "USD" },
        },
        notificationsWithSubscribers: [80, 100].map((threshold) => ({
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "EMAIL", address: email }],
        })),
      });
    }
  }
}
