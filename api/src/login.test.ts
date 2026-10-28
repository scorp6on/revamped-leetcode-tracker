import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeAll, describe, expect, it } from "vitest";
import { LOCKOUT_MS, MAX_FAILURES, type LockoutState } from "./auth/lockout";
import { hashPassword } from "./auth/password";
import { verifyToken } from "./auth/token";
import { makeLoginHandler } from "./login";

const jwtSecret = randomBytes(32).toString("base64");
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword("correct horse", 4);
});

const setup = (initial: LockoutState = { failures: 0, lockedUntil: 0 }, start = 1_000_000) => {
  let state = initial;
  let clock = start;
  const login = makeLoginHandler({
    lockout: { get: async () => state, save: async (s) => void (state = s) },
    secret: async (name) => (name === "password-hash" ? passwordHash : jwtSecret),
    now: () => clock,
  });
  const attempt = async (password: string) => {
    const res = (await login({ body: JSON.stringify({ password }) } as APIGatewayProxyEventV2)) as {
      statusCode: number;
      body: string;
      cookies?: string[];
    };
    return { ...res, body: JSON.parse(res.body) };
  };
  return { attempt, state: () => state, advance: (ms: number) => void (clock += ms), now: () => clock };
};

describe("login", () => {
  it("logs in with the right password and sets a valid session cookie", async () => {
    const { attempt, now } = setup();
    const res = await attempt("correct horse");

    expect(res.statusCode).toBe(200);
    const token = res.cookies?.[0].match(/^token=([^;]+)/)?.[1];
    expect(token && (await verifyToken(token, jwtSecret, now()))).toBe(true);
  });

  it("rejects a wrong password and counts the failure", async () => {
    const { attempt, state } = setup();
    const res = await attempt("nope");

    expect(res.statusCode).toBe(401);
    expect(res.cookies).toBeUndefined();
    expect(state()).toEqual({ failures: 1, lockedUntil: 0 });
  });

  it("requires a password", async () => {
    const { attempt } = setup();
    expect((await attempt("")).statusCode).toBe(400);
  });

  it(`locks for 15 minutes after ${MAX_FAILURES} wrong passwords, even for the right one`, async () => {
    const { attempt, advance } = setup();
    for (let i = 0; i < MAX_FAILURES; i++) await attempt("nope");

    const locked = await attempt("correct horse");
    expect(locked.statusCode).toBe(429);
    expect(locked.body.retryAfterSeconds).toBe(LOCKOUT_MS / 1000);

    advance(LOCKOUT_MS + 1);
    expect((await attempt("correct horse")).statusCode).toBe(200);
  });

  it("resets the failure count after a successful login", async () => {
    const { attempt, state } = setup({ failures: 3, lockedUntil: 0 });
    await attempt("correct horse");
    expect(state()).toEqual({ failures: 0, lockedUntil: 0 });
  });
});
