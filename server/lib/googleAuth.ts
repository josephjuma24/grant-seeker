import { eq } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

import { env } from '../config/env.ts';
import type { Tx } from '../db/index.ts';
import { notifications, users, type User } from '../db/schema.ts';
import { loadAccessPolicy } from './accessPolicy.ts';
import { conflict, forbidden, HttpError } from './httpError.ts';
import { refreshProfile } from './profileService.ts';

// Sign in with Google, straight into GrantSeeker's own accounts: the
// browser gets a one-time authorization code from Google's popup, the API
// exchanges it (with the client secret, which never leaves the server) for
// an ID token, verifies that token, and finds, links or creates the user.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
let googleKeys: JWTVerifyGetKey | undefined;

export const googleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export class GoogleAuthError extends HttpError {
  constructor(message: string) {
    super(401, 'google_failed', message);
  }
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

const TokenResponse = z.object({ id_token: z.string().min(1) });

/** Exchanges the popup's authorization code for Google's ID token. */
export async function exchangeGoogleCode(code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      // Popup mode: Google returns the code by postMessage, not a redirect.
      redirect_uri: 'postmessage',
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) throw new GoogleAuthError('Google sign-in could not be completed. Try again.');
  const parsed = TokenResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new GoogleAuthError('Google sign-in could not be completed. Try again.');
  return parsed.data.id_token;
}

const IdClaims = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean(),
  name: z.string().optional(),
  given_name: z.string().optional(),
});

/** Checks the ID token's signature, issuer, audience and expiry; Google keys by default. */
export async function verifyGoogleIdToken(idToken: string, keys?: JWTVerifyGetKey): Promise<GoogleIdentity> {
  googleKeys ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(idToken, keys ?? googleKeys, { issuer: ISSUERS, audience: env.GOOGLE_CLIENT_ID! }));
  } catch {
    throw new GoogleAuthError('Google sign-in could not be verified. Try again.');
  }
  const claims = IdClaims.safeParse(payload);
  if (!claims.success) throw new GoogleAuthError('Google did not share an email address for this account.');
  if (!claims.data.email_verified) throw new GoogleAuthError('This Google account’s email address is not verified.');
  const email = claims.data.email.trim().toLowerCase();
  return { sub: claims.data.sub, email, name: (claims.data.name ?? claims.data.given_name ?? email.split('@')[0]!).slice(0, 120) };
}

/**
 * The account for a verified Google identity: the one already linked to
 * it, else the one with the same (verified) email, which gets linked, else
 * a new researcher account. Runs in a system transaction.
 */
export async function findOrCreateGoogleUser(tx: Tx, id: GoogleIdentity): Promise<{ user: User; created: boolean; linked: boolean }> {
  const [bySub] = await tx.select().from(users).where(eq(users.googleSub, id.sub));
  if (bySub) return { user: bySub, created: false, linked: false };

  const [byEmail] = await tx.select().from(users).where(eq(users.email, id.email));
  if (byEmail) {
    if (byEmail.googleSub) throw conflict('google_mismatch', 'This email is linked to a different Google account.');
    const [linked] = await tx
      .update(users)
      .set({ googleSub: id.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() })
      .where(eq(users.id, byEmail.id))
      .returning();
    return { user: linked!, created: false, linked: true };
  }

  // Invite-only: Google can sign existing members in, but not create accounts.
  if ((await loadAccessPolicy(tx)).registrationMode === 'invite_only') {
    throw forbidden('invite_only', 'Registration is by invitation. Ask your research office for an invite code, then register.');
  }
  const [created] = await tx
    .insert(users)
    .values({
      email: id.email,
      googleSub: id.sub,
      // No password: this account signs in with Google.
      passwordHash: null,
      name: id.name,
      persona: 'academic',
      role: 'researcher',
      // Google verified the address.
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!created) throw new Error('user insert returned no row');
  await refreshProfile(tx, created.id, { applicantType: null, rescore: false });
  await tx.insert(notifications).values({
    userId: created.id,
    type: 'system',
    title: 'Welcome to GrantSeeker',
    message: 'Your account was created with Google. Upload your CV on Smart Profile & Matches to get ranked, explained matches.',
  });
  return { user: created, created: true, linked: false };
}
