import { randomBytes } from "node:crypto";
import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { signToken } from "./auth/token";
import { makeAuthorizer } from "./authorizer";

const secret = randomBytes(32).toString("base64");
const authorize = makeAuthorizer(async () => secret);
const withCookies = (cookies?: string[]) =>
  authorize({ cookies } as APIGatewayRequestAuthorizerEventV2);

describe("authorizer", () => {
  it("allows a request carrying a valid token cookie", async () => {
    const token = await signToken(secret);
    expect(await withCookies(["theme=dark", `token=${token}`])).toEqual({ isAuthorized: true });
  });

  it("denies a request with no token", async () => {
    expect(await withCookies(undefined)).toEqual({ isAuthorized: false });
    expect(await withCookies(["theme=dark"])).toEqual({ isAuthorized: false });
  });

  it("denies a garbage token", async () => {
    expect(await withCookies(["token=not-a-jwt"])).toEqual({ isAuthorized: false });
  });
});
