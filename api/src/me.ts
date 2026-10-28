import { json } from "./http";

// Only reachable through the authorizer, so getting here means the token is valid.
export const handler = async () => json(200, { loggedIn: true });
