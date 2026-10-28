// Thrown for any 401: the token is missing, expired or invalid, so the app shows the login page.
export class Unauthorized extends Error {}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler;
};

// The session cookie is HttpOnly, so JavaScript never sees it; the browser attaches it itself.
export async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (res.status === 401 && path !== "/api/login") {
    onUnauthorized();
    throw new Unauthorized();
  }
  return res;
}
