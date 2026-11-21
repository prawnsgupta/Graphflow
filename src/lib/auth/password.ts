import { hash, verify, type Algorithm } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1).
const OPTIONS = {
  algorithm: 2 as Algorithm, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string | null | undefined, password: string): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used to equalise timing when the user does not exist.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword("graphflow-timing-equaliser");
  await verifyPassword(await dummyHash, password);
}

export const PASSWORD_RULES = {
  minLength: 10,
  description: "At least 10 characters, including a letter and a number.",
};

export function isStrongPassword(pw: string) {
  return pw.length >= PASSWORD_RULES.minLength && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}
