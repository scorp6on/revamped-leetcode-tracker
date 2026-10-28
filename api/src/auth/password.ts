import bcrypt from "bcryptjs";

// Cost 12 ≈ a few hundred ms per check: cheap for one login, expensive for guessing.
export const hashPassword = (password: string, rounds = 12) => bcrypt.hash(password, rounds);

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
