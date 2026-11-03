import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { RunCode } from "./routes";

// Calls the Code runner Lambda (runner/handler.py): no permissions, no network (#62 B).
export const lambdaRunCode =
  (lambda: LambdaClient, functionName: string | undefined): RunCode =>
  async (job) => {
    const res = await lambda.send(new InvokeCommand({ FunctionName: functionName, Payload: JSON.stringify(job) }));
    const body = JSON.parse(new TextDecoder().decode(res.Payload));
    if (res.FunctionError) throw new Error(`the code runner failed: ${body?.errorMessage ?? res.FunctionError}`);
    return body;
  };
