import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { errors as joseErrors, importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from 'jose';
import { z } from 'zod';

import { env } from '../config/env.ts';
import { withSystemTx, type Tx } from '../db/index.ts';
import { refreshTokens, USER_ROLES, users, type UserRole } from '../db/schema.ts';

/* ------------------------------------------------------------------ */
/* Access tokens (JWT, EdDSA)                                          */
/* ------------------------------------------------------------------ */

const ALG = 'EdDSA';

let keys: Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> | undefined;
function getKeys() {
  keys ??= Promise.all([
    importPKCS8(env.JWT_PRIVATE_KEY, ALG),
    importSPKI(env.JWT_PUBLIC_KEY, ALG),
  ]).then(([privateKey, publicKey]) => ({ privateKey, publicKey }));
  return keys;
}

const AccessClaimsSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(USER_ROLES),
  org: z.string().uuid().nullable(),
  tv: z.number().int().nonnegative(),
  ev: z.boolean(),
});
export type AccessClaims = z.infer<typeof AccessClaimsSchema>;

export interface TokenSubject {
  id: string;
  role: UserRole;
  orgId: string | null;
  tokenVersion: number;
  emailVerifiedAt: Date | null;
}

export async function signAccessToken(user: TokenSubject): Promise<{ token: string; expiresIn: number }> {
  const { privateKey } = await getKeys();
  const token = await new SignJWT({
    role: user.role,
    org: user.orgId,
    tv: user.tokenVersion,
    ev: user.emailVerifiedAt !== null,
  })
    .setProtectedHeader({ alg: ALG, kid: env.JWT_KEY_ID, typ: 'at+jwt' })
    .setSubject(user.id)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
  return { token, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
}

export type AccessTokenError = 'expired' | 'invalid';

export async function verifyAccessToken(
  token: string,
): Promise<{ ok: true; claims: AccessClaims } | { ok: false; error: AccessTokenError }> {
  const { publicKey } = await getKeys();
  try {
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: [ALG],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      typ: 'at+jwt',
      clockTolerance: 5,
    });
    const claims = AccessClaimsSchema.safeParse(payload);
    return claims.success ? { ok: true, claims: claims.data } : { ok: false, error: 'invalid' };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, error: 'expired' };
    return { ok: false, error: 'invalid' };
  }
}

/* ------------------------------------------------------------------ */
/* Refresh tokens (opaque, rotating, family-scoped)                    */
/* ------------------------------------------------------------------ */

export interface ClientMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
  familyId: string;
  /** "Keep me signed in": a cookie that outlives the browser session. */
  persistent: boolean;
}

/** Without "Keep me signed in", a session ends after this long without use. */
export const SESSION_ONLY_TTL_MS = 12 * 60 * 60 * 1000;

const hashToken = (raw: string) => createHash('sha256').update(raw, 'utf8').digest();

function refreshExpiry(persistent: boolean): Date {
  return new Date(Date.now() + (persistent ? env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 : SESSION_ONLY_TTL_MS));
}

async function insertRefreshToken(
  tx: Tx,
  userId: string,
  familyId: string,
  meta: ClientMeta,
  persistent: boolean,
): Promise<IssuedRefreshToken & { id: string }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = refreshExpiry(persistent);
  const [row] = await tx
    .insert(refreshTokens)
    .values({
      userId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip ?? null,
      persistent,
    })
    .returning({ id: refreshTokens.id });
  if (!row) throw new Error('refresh token insert returned no row');
  return { id: row.id, token, expiresAt, familyId, persistent };
}

/** Starts a new session family (login, sign-up). */
export function issueRefreshToken(
  userId: string,
  meta: ClientMeta,
  tx?: Tx,
  opts: { persistent?: boolean } = {},
): Promise<IssuedRefreshToken> {
  const run = (t: Tx) => insertRefreshToken(t, userId, randomUUID(), meta, opts.persistent ?? true);
  return tx ? run(tx) : withSystemTx(run);
}

export type RotateResult =
  | { kind: 'ok'; user: TokenSubject; refresh: IssuedRefreshToken }
  | { kind: 'invalid' }
  | { kind: 'stale' }
  | { kind: 'reused'; userId: string; familyId: string };

const REUSE_GRACE_MS = 10_000;

/**
 * Exchanges a refresh token for its successor. A token exchanged more than
 * REUSE_GRACE_MS ago means it leaked: the whole family is revoked and the
 * caller must log in again.
 */
export function rotateRefreshToken(raw: string, meta: ClientMeta): Promise<RotateResult> {
  return withSystemTx(async (tx) => {
    const [current] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(raw)))
      .for('update');

    if (!current || current.revokedAt || current.expiresAt <= new Date()) {
      return { kind: 'invalid' } as const;
    }

    if (current.usedAt) {
      // Two tabs refreshing at once: the loser presents the token the winner
      // just exchanged. Inside the grace window that is a race, not theft;
      // the browser already holds the successor cookie, so the client retries.
      if (Date.now() - current.usedAt.getTime() < REUSE_GRACE_MS) {
        return { kind: 'stale' } as const;
      }
      await revokeFamilyTx(tx, current.familyId);
      return { kind: 'reused', userId: current.userId, familyId: current.familyId } as const;
    }

    const [user] = await tx
      .select({
        id: users.id,
        role: users.role,
        orgId: users.orgId,
        tokenVersion: users.tokenVersion,
        emailVerifiedAt: users.emailVerifiedAt,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(eq(users.id, current.userId));

    if (!user || user.suspendedAt) {
      await revokeFamilyTx(tx, current.familyId);
      return { kind: 'invalid' } as const;
    }

    // The successor keeps the session's "Keep me signed in" choice.
    const next = await insertRefreshToken(tx, user.id, current.familyId, meta, current.persistent);
    await tx
      .update(refreshTokens)
      .set({ usedAt: new Date(), replacedBy: next.id })
      .where(eq(refreshTokens.id, current.id));

    const { suspendedAt: _s, ...subject } = user;
    return { kind: 'ok', user: subject, refresh: next } as const;
  });
}

async function revokeFamilyTx(tx: Tx, familyId: string) {
  await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/** Logout: ends the session the presented token belongs to. */
export function revokeRefreshFamily(raw: string): Promise<{ userId: string } | null> {
  return withSystemTx(async (tx) => {
    const [row] = await tx
      .select({ userId: refreshTokens.userId, familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(raw)));
    if (!row) return null;
    await revokeFamilyTx(tx, row.familyId);
    return { userId: row.userId };
  });
}

/**
 * Logout everywhere / password change / suspension: revokes every refresh
 * family and bumps token_version so outstanding access tokens fail too.
 */
export function revokeAllSessions(userId: string, tx?: Tx): Promise<void> {
  const run = async (t: Tx) => {
    await t
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    await t
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, userId));
  };
  return tx ? run(tx) : withSystemTx(run);
}
