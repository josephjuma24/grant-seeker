import { randomBytes } from 'node:crypto';

// Crockford base32: no I, L, O or U, so a code read aloud or retyped from
// an email survives. 16 characters × 5 bits = 80 bits of entropy.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 16;

/** e.g. "7K3M-QX9D-2HPA-V04N". */
export function generateInviteCode(): string {
  // 32 divides 256, so masking a byte to 5 bits is unbiased.
  const chars = [...randomBytes(LENGTH)].map((b) => ALPHABET[b & 31]);
  return chars.join('').match(/.{4}/g)!.join('-');
}

/**
 * Canonical form of what someone typed: case, spaces and dashes ignored,
 * and the look-alikes Crockford defines (O→0, I/L→1) folded. Returns null
 * for anything that cannot be a code, so the lookup never runs on junk.
 */
export function normalizeInviteCode(input: string): string | null {
  const folded = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (folded.length !== LENGTH || ![...folded].every((c) => ALPHABET.includes(c))) return null;
  return folded.match(/.{4}/g)!.join('-');
}
