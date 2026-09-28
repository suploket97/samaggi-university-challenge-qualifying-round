/**
 * Password hashing for the host login. scrypt with a random 16-byte salt per
 * password; only the salt and hash are stored, never the password.
 * Kept free of framework imports so it can be unit-tested.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

export interface StoredPassword {
  v: 1;
  salt: string; // base64
  hash: string; // base64
  /** Changes whenever the password changes, which signs every existing session out. */
  epoch: string;
  updated_at: string;
}

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key as Buffer),
    ),
  );
}

/** Returns a problem to show the user, or null if the password is acceptable. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (/^(.)\1+$/.test(pw)) return "Don't repeat a single character.";
  if (["password", "12345678", "123456789", "qwertyui", "samaggi1", "samaggi123"].includes(pw.toLowerCase())) return "That password is too easy to guess.";
  return null;
}

export async function hashPassword(pw: string): Promise<StoredPassword> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt);
  return {
    v: 1,
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    epoch: randomBytes(12).toString("base64url"),
    updated_at: new Date().toISOString(),
  };
}

export async function verifyPassword(pw: string, rec: StoredPassword): Promise<boolean> {
  if (!pw || pw.length > MAX_PASSWORD_LENGTH) return false;
  const expected = Buffer.from(rec.hash, "base64");
  const actual = await scrypt(pw, Buffer.from(rec.salt, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
