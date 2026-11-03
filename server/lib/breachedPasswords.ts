import { createHash } from 'node:crypto';

import { env } from '../config/env.ts';

const TIMEOUT_MS = 2_000;

/**
 * True when the password appears in the Have I Been Pwned corpus. Only the
 * first 5 hex chars of its SHA-1 leave the server (k-anonymity), and
 * Add-Padding hides the response size. An outage must not block sign-up,
 * so any failure counts as "not breached".
 */
export async function isBreachedPassword(password: string): Promise<boolean> {
  if (!env.PASSWORD_BREACH_CHECK) return false;

  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'grantseeker-api' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split('\n').some((line) => {
      const [hashSuffix, count] = line.trim().split(':');
      return hashSuffix === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
