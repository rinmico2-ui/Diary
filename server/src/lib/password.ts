import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

// scrypt parameters: ~32MB memory cost, CPU-hard, and no native build required.
// maxmem is set well above the actual 128*N*r cost so Node never rejects the call.
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_COST = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_OPTIONS: ScryptOptions = {
  N: SCRYPT_COST,
  r: SCRYPT_R,
  p: SCRYPT_P,
  maxmem: 256 * SCRYPT_COST * SCRYPT_R,
};

/** Stored format: scrypt$N$r$p$salt$hash (all base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return [
    'scrypt',
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  let expected: Buffer;
  let salt: Buffer;
  try {
    salt = Buffer.from(saltRaw, 'base64url');
    expected = Buffer.from(hashRaw, 'base64url');
  } catch {
    return false;
  }

  const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: 256 * Number(nRaw) * Number(rRaw),
  });

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push('at least 10 characters');
  if (!/[a-zA-Z]/.test(password)) problems.push('at least one letter');
  if (!/[0-9]/.test(password)) problems.push('at least one number');
  return problems;
}
