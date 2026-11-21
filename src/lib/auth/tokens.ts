import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return s;
}

/** Cryptographically random URL-safe token with a readable prefix. */
export function generateToken(prefix: string, bytes = 32): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

/** Keyed hash stored in the database instead of the raw token. */
export function hashToken(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
