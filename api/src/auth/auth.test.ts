import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import {
  TOKEN_TTL_SECONDS,
  clearedCookie,
  sessionCookie,
  signToken,
  tokenFromCookies,
  verifyToken,
} from "./token";

const secret = randomBytes(32).toString("base64");

describe("password", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse", 4);
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  });
});

describe("token", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");

  it("accepts a fresh token signed with the same secret", async () => {
    expect(await verifyToken(await signToken(secret, now), secret, now)).toBe(true);
  });

  it("rejects a token after it expires", async () => {
    const token = await signToken(secret, now);
    const justAfter = now + (TOKEN_TTL_SECONDS + 1) * 1000;
    expect(await verifyToken(token, secret, justAfter)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const other = randomBytes(32).toString("base64");
    expect(await verifyToken(await signToken(other, now), secret, now)).toBe(false);
  });

  it("rejects a tampered token", async () => {
    const [header, , signature] = (await signToken(secret, now)).split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "attacker" })).toString("base64url");
    expect(await verifyToken(`${header}.${forged}.${signature}`, secret, now)).toBe(false);
  });
});

describe("cookies", () => {
  it("sets a locked-down cookie and clears it on logout", () => {
    expect(sessionCookie("abc")).toBe(
      `token=abc; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TOKEN_TTL_SECONDS}`,
    );
    expect(clearedCookie()).toContain("Max-Age=0");
  });

  it("finds the token among other cookies", () => {
    expect(tokenFromCookies(["theme=dark", "token=abc.def.ghi"])).toBe("abc.def.ghi");
    expect(tokenFromCookies(["theme=dark; token=xyz"])).toBe("xyz");
    expect(tokenFromCookies(["theme=dark"])).toBeUndefined();
    expect(tokenFromCookies(undefined)).toBeUndefined();
  });
});
