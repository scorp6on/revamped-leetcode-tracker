import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerResult,
} from "aws-lambda";
import { getSecret } from "./auth/secrets";
import { tokenFromCookies, verifyToken } from "./auth/token";

export const makeAuthorizer =
  (secret: () => Promise<string>, now: () => number = Date.now) =>
  async (event: APIGatewayRequestAuthorizerEventV2): Promise<APIGatewaySimpleAuthorizerResult> => {
    const token = tokenFromCookies(event.cookies);
    return { isAuthorized: !!token && (await verifyToken(token, await secret(), now())) };
  };

export const handler = makeAuthorizer(() => getSecret("jwt-secret"));
