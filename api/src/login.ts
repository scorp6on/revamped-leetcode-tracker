import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { LOCKOUT_MS, MAX_FAILURES, dynamoLockoutStore, type LockoutStore } from "./auth/lockout";
import { verifyPassword } from "./auth/password";
import { getSecret } from "./auth/secrets";
import { sessionCookie, signToken } from "./auth/token";
import { json } from "./http";

export interface LoginDeps {
  lockout: LockoutStore;
  secret: (name: "password-hash" | "jwt-secret") => Promise<string>;
  now: () => number;
}

const readPassword = (event: APIGatewayProxyEventV2): string | undefined => {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
  try {
    const { password } = JSON.parse(raw);
    return typeof password === "string" && password ? password : undefined;
  } catch {
    return undefined;
  }
};

export const makeLoginHandler =
  ({ lockout, secret, now }: LoginDeps) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const password = readPassword(event);
    if (!password) return json(400, { error: "password required" });

    const t = now();
    const state = await lockout.get();
    if (state.lockedUntil > t) {
      return json(429, { error: "locked", retryAfterSeconds: Math.ceil((state.lockedUntil - t) / 1000) });
    }

    if (!(await verifyPassword(password, await secret("password-hash")))) {
      const failures = state.failures + 1;
      await lockout.save(
        failures >= MAX_FAILURES ? { failures: 0, lockedUntil: t + LOCKOUT_MS } : { failures, lockedUntil: 0 },
      );
      // Same answer whatever was wrong, so a guesser learns nothing.
      return json(401, { error: "invalid password" });
    }

    if (state.failures > 0 || state.lockedUntil > 0) await lockout.save({ failures: 0, lockedUntil: 0 });
    const token = await signToken(await secret("jwt-secret"), t);
    return json(200, { ok: true }, [sessionCookie(token)]);
  };

export const handler = makeLoginHandler({
  lockout: dynamoLockoutStore(process.env.TABLE_NAME ?? ""),
  secret: getSecret,
  now: Date.now,
});
