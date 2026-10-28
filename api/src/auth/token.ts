import { SignJWT, jwtVerify } from "jose";

export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const COOKIE_NAME = "token";

// The JWT secret is stored base64-encoded (32 random bytes) in Parameter Store.
const key = (secret: string) => Buffer.from(secret, "base64");

export const signToken = (secret: string, now = Date.now()) => {
  const iat = Math.floor(now / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setIssuedAt(iat)
    .setExpirationTime(iat + TOKEN_TTL_SECONDS)
    .sign(key(secret));
};

export const verifyToken = async (token: string, secret: string, now = Date.now()) => {
  try {
    await jwtVerify(token, key(secret), { algorithms: ["HS256"], currentDate: new Date(now) });
    return true;
  } catch {
    return false;
  }
};

const cookieFlags = "HttpOnly; Secure; SameSite=Strict; Path=/";

export const sessionCookie = (token: string) =>
  `${COOKIE_NAME}=${token}; ${cookieFlags}; Max-Age=${TOKEN_TTL_SECONDS}`;

export const clearedCookie = () => `${COOKIE_NAME}=; ${cookieFlags}; Max-Age=0`;

export const tokenFromCookies = (cookies: string[] | undefined) =>
  cookies
    ?.flatMap((header) => header.split(";"))
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
