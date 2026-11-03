import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from 'express';
import { eq } from 'drizzle-orm';

import { env, isProduction } from '../config/env.ts';
import { withSystemTx } from '../db/index.ts';
import { ROLE_LEVEL, users } from '../db/schema.ts';
import { verifyAccessToken, type AccessTokenError, type ClientMeta } from '../lib/tokens.ts';
import type { AuthUser } from '../types/express.d.ts';

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

type AuthErrorCode = 'missing_token' | 'token_expired' | 'invalid_token' | 'session_revoked';

function unauthorized(res: Response, code: AuthErrorCode, message: string) {
  // RFC 6750 §3: tells clients whether to refresh (expired) or re-login.
  const error = code === 'missing_token' ? '' : ', error="invalid_token"';
  res.setHeader('WWW-Authenticate', `Bearer realm="grantseeker"${error}`);
  return res.status(401).json({ error: { code, message } });
}

const TOKEN_ERRORS: Record<AccessTokenError, [AuthErrorCode, string]> = {
  expired: ['token_expired', 'Access token expired; refresh and retry'],
  invalid: ['invalid_token', 'Access token is invalid'],
};

/* ------------------------------------------------------------------ */
/* Access-token guards                                                 */
/* ------------------------------------------------------------------ */

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

type Resolved =
  | { ok: true; user: AuthUser }
  | { ok: false; code: AuthErrorCode; message: string };

async function resolveUser(token: string): Promise<Resolved> {
  const verified = await verifyAccessToken(token);
  if (!verified.ok) {
    const [code, message] = TOKEN_ERRORS[verified.error];
    return { ok: false, code, message };
  }
  const { claims } = verified;

  // One indexed primary-key lookup per request. It makes logout-all,
  // suspension and role changes take effect immediately instead of when
  // the 15-minute token runs out.
  const [row] = await withSystemTx((tx) =>
    tx
      .select({
        id: users.id,
        role: users.role,
        orgId: users.orgId,
        tokenVersion: users.tokenVersion,
        emailVerifiedAt: users.emailVerifiedAt,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(eq(users.id, claims.sub)),
  );

  if (!row || row.suspendedAt || row.tokenVersion !== claims.tv) {
    return { ok: false, code: 'session_revoked', message: 'Session is no longer valid; log in again' };
  }

  const emailVerified = row.emailVerifiedAt !== null;
  const effectiveRole = emailVerified ? row.role : 'guest';
  return {
    ok: true,
    user: {
      id: row.id,
      role: row.role,
      effectiveRole,
      level: ROLE_LEVEL[effectiveRole],
      orgId: row.orgId,
      emailVerified,
    },
  };
}

function attach(req: Request, user: AuthUser) {
  req.user = user;
  req.identity = { userId: user.id, orgId: user.orgId, level: user.level };
}

/** 401 unless a valid, unrevoked access token is presented. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = readBearer(req);
  if (!token) return unauthorized(res, 'missing_token', 'Authentication required');
  try {
    const result = await resolveUser(token);
    if (!result.ok) return unauthorized(res, result.code, result.message);
    attach(req, result.user);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * For routes that serve everyone but personalise for signed-in users
 * (grant search). No header → anonymous. A bad header is still a 401, so
 * clients notice an expired token instead of silently losing their data.
 */
export const optionalAuth: RequestHandler = async (req, res, next) => {
  const token = readBearer(req);
  if (!token) {
    req.identity = null;
    return next();
  }
  try {
    const result = await resolveUser(token);
    if (!result.ok) return unauthorized(res, result.code, result.message);
    attach(req, result.user);
    next();
  } catch (err) {
    next(err);
  }
};

/* ------------------------------------------------------------------ */
/* Refresh cookie                                                      */
/* ------------------------------------------------------------------ */

// __Secure- makes browsers refuse the cookie unless it was set over HTTPS
// with Secure. (__Host- would also force Path=/, sending it on every API
// call; scoping it to /api/auth matters more.) Plain name in local dev,
// where the app runs over http.
export const REFRESH_COOKIE = isProduction ? '__Secure-gs_rt' : 'gs_rt';
const REFRESH_COOKIE_PATH = '/api/auth';

function refreshCookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires,
  };
}

/** A persistent session gets a dated cookie; otherwise it ends when the browser closes. */
export function setRefreshCookie(res: Response, token: string, expiresAt: Date, persistent = true) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(persistent ? expiresAt : undefined));
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

/** Requires cookie-parser to be mounted. */
export function readRefreshCookie(req: Request): string | null {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/* ------------------------------------------------------------------ */
/* CSRF guard for cookie-authenticated endpoints                       */
/* ------------------------------------------------------------------ */

export const CSRF_HEADER = 'x-grantseeker-csrf';
const allowedOrigins = new Set(env.CORS_ORIGIN.split(',').map((o) => o.trim()));

/**
 * /refresh and /logout authenticate by cookie alone, so they are the only
 * CSRF-exposed routes. SameSite=Strict is the first wall; this is the
 * second: a custom header cannot be sent cross-origin without a CORS
 * preflight we refuse, and a present Origin must be one we allow.
 */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (req.get(CSRF_HEADER) !== '1' || (origin && !allowedOrigins.has(origin))) {
    return res.status(403).json({
      error: { code: 'csrf_rejected', message: 'Missing or invalid CSRF header' },
    });
  }
  next();
}

/* ------------------------------------------------------------------ */

export function clientMeta(req: Request): ClientMeta {
  return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
}
