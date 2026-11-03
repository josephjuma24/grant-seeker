import argon2 from 'argon2';

// OWASP Password Storage Cheat Sheet minimum for argon2id.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

// Verified against when the email is unknown, so a miss costs the same time
// as a wrong password and response timing does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= argon2.hash('grantseeker-timing-equaliser', ARGON2_OPTIONS);
  return dummyHash;
}

export interface VerifyResult {
  valid: boolean;
  /** True when the stored hash uses weaker parameters than ARGON2_OPTIONS. */
  needsRehash: boolean;
}

export async function verifyPassword(
  storedHash: string | null | undefined,
  plain: string,
): Promise<VerifyResult> {
  if (!storedHash) {
    await argon2.verify(await getDummyHash(), plain).catch(() => false);
    return { valid: false, needsRehash: false };
  }
  try {
    const valid = await argon2.verify(storedHash, plain);
    return { valid, needsRehash: valid && argon2.needsRehash(storedHash, ARGON2_OPTIONS) };
  } catch {
    // Malformed hash in the database: treat as a failed login, never a 500.
    return { valid: false, needsRehash: false };
  }
}
