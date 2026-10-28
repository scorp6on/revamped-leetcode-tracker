import { clearedCookie } from "./auth/token";
import { json } from "./http";

// A JWT can't be revoked; logging out just makes this browser delete its cookie.
export const handler = async () => json(200, { ok: true }, [clearedCookie()]);
