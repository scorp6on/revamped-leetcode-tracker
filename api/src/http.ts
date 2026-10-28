import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

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

// A JSON request body as an object; {} when it's missing or not valid JSON.
export const readBody = (event: APIGatewayProxyEventV2): Record<string, unknown> => {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
