import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// The extension proves who it is with this token (#56). Only its hash is stored, like the password.
export const newToken = () => randomBytes(32).toString("base64url");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Constant-time, so a wrong guess takes exactly as long as a right one.
export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
