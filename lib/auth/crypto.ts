import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const KEY_LENGTH = 64;
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

function deriveKey(password: string, salt: string, options: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, options, (error, key) => error ? reject(error) : resolve(key));
  });
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function hashPassword(password: string) {
  assertPasswordStrength(password);
  const salt = randomBytes(16).toString("base64url");
  const result = await deriveKey(password, salt, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt}$${result.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, n, r, p, salt, expectedValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !salt || !expectedValue) return false;
  const expected = Buffer.from(expectedValue, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await deriveKey(password, salt, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function assertPasswordStrength(password: string) {
  if (password.length < 12 || password.length > 128) {
    throw new Error("Password must be between 12 and 128 characters.");
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("Password must include uppercase, lowercase, and numeric characters.");
  }
}
