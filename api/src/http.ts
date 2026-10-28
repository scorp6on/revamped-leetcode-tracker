import type { APIGatewayProxyResultV2 } from "aws-lambda";

export const json = (
  statusCode: number,
  body: unknown,
  cookies?: string[],
): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  ...(cookies && { cookies }),
});
