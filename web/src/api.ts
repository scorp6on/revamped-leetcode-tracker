// Thrown when the session is gone, so the app shows the login page. API Gateway answers 401 when
// there's no cookie at all and 403 when the authorizer rejects the token (expired or invalid).
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
  if ((res.status === 401 || res.status === 403) && path !== "/api/login") {
    onUnauthorized();
    throw new Unauthorized();
  }
  return res;
}
