import * as cdk from "aws-cdk-lib";
import { AccountStack } from "../lib/account-stack";
import { AppStack } from "../lib/app-stack";

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

// Deployed once from your machine: GitHub OIDC trust, deploy roles, budget alert.
new AccountStack(app, "LeetTracker-Account", {
  env,
  repo: "scorp6on/revamped-leetcode-tracker",
  budgetEmail: app.node.tryGetContext("budgetEmail"),
});

// Deployed by GitHub Actions: dev first, prod after approval.
new AppStack(app, "LeetTracker-dev", { env, stage: "dev" });
new AppStack(app, "LeetTracker-prod", { env, stage: "prod" });
