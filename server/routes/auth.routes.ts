import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { z } from 'zod';

import { env } from '../config/env.ts';
import { withSystemTx, withUserTx, type Tx } from '../db/index.ts';
import {
  notifications,
  organizations,
  PERSONAS,
  refreshTokens,
  ROLE_LEVEL,
  users,
  type User,
} from '../db/schema.ts';
import { isBreachedPassword } from '../lib/breachedPasswords.ts';
import { normalizeInviteCode } from '../lib/inviteCodes.ts';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/httpError.ts';
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from '../lib/passwords.ts';
import { exchangeGoogleCode, findOrCreateGoogleUser, googleConfigured, verifyGoogleIdToken } from '../lib/googleAuth.ts';
import { loadAccessPolicy } from '../lib/accessPolicy.ts';
import { checkResetToken, requestPasswordReset, resetPassword, RESET_TTL_MS } from '../lib/passwordReset.ts';
import { refreshProfile } from '../lib/profileService.ts';
import { loadUserDto } from '../lib/userQueries.ts';
import {
  issueRefreshToken,
  revokeAllSessions,
  revokeRefreshFamily,
  rotateRefreshToken,
  signAccessToken,
  type IssuedRefreshToken,
} from '../lib/tokens.ts';
import { recordAudit, skipAudit } from '../middleware/auditLogger.ts';
import {
  clearRefreshCookie,
  clientMeta,
  readRefreshCookie,
  requireAuth,
  requireCsrfHeader,
  setRefreshCookie,
} from '../middleware/auth.ts';
import { forgotPasswordLimiter, loginLimiter, refreshLimiter, registerLimiter, resetPasswordLimiter } from '../middleware/rateLimit.ts';
import { handle, zEmail, zUuid } from '../middleware/validation.ts';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;

const INVALID_CREDENTIALS = () => unauthorized('invalid_credentials', 'Invalid email or password');

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const zPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);

const RegisterBody = z.object({
  email: zEmail,
  password: zPassword,
  name: z.string().trim().min(1).max(120),
  persona: z.enum(PERSONAS).default('academic'),
  // Applying as a person or as an organisation: the first eligibility gate.
  applicantType: z.enum(['individual', 'organisation']).optional(),
  // Either join an existing org by invite code, or name a new one, which
  // starts `pending` until a super admin activates it.
  inviteCode: z
    .string()
    .max(64)
    .transform((v, ctx) => {
      const code = normalizeInviteCode(v);
      if (!code) ctx.addIssue({ code: 'custom', message: 'That does not look like an invite code' });
      return code ?? z.NEVER;
    })
    .optional(),
  organization: z.string().trim().min(2).max(200).optional(),
  region: z.string().trim().max(120).optional(),
  researchInterests: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  qualifications: z.string().trim().max(500).optional(),
  fundingNeedsMin: z.number().nonnegative().max(1e12).optional(),
  /** "Keep me signed in" */
  remember: z.boolean().default(true),
});

const LoginBody = z.object({
  email: zEmail,
  // No length rules on login: they would tell an attacker the policy and
  // lock out users whose password predates it.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  /** "Keep me signed in" */
  remember: z.boolean().default(true),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Sets the refresh cookie and returns the body every token endpoint sends. */
async function sessionResponse(res: Response, user: User, refresh: IssuedRefreshToken) {
  const access = await signAccessToken(user);
  setRefreshCookie(res, refresh.token, refresh.expiresAt, refresh.persistent);
  res.setHeader('Cache-Control', 'no-store');
  return { token: access.token, tokenType: 'Bearer', expiresIn: access.expiresIn };
}

const actorOf = (user: Pick<User, 'id' | 'role' | 'orgId'>) => ({
  id: user.id,
  level: ROLE_LEVEL[user.role],
  orgId: user.orgId,
});

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export const authRouter = Router();

authRouter.post(
  '/register',
  registerLimiter,
  handle({ body: RegisterBody }, async (req, res, { body }) => {
    if (await isBreachedPassword(body.password)) {
      throw badRequest(
        'password_breached',
        'This password has appeared in a data breach. Choose a different one.',
      );
    }
    const passwordHash = await hashPassword(body.password);

    const { user, refresh } = await withSystemTx(async (tx) => {
      const policy = await loadAccessPolicy(tx);
      if (policy.registrationMode === 'invite_only' && !body.inviteCode) {
        throw forbidden('invite_only', 'Registration is by invitation. Ask your research office for an invite code.');
      }
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, body.email));
      if (taken) throw conflict('email_taken', 'An account with this email already exists');

      let orgId: string | null = null;
      if (body.inviteCode) {
        const [org] = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(and(eq(organizations.inviteCode, body.inviteCode), eq(organizations.status, 'active')));
        if (!org) throw badRequest('invalid_invite', 'Invite code is invalid or expired');
        orgId = org.id;
      } else if (body.organization) {
        const [org] = await tx
          .insert(organizations)
          .values({ name: body.organization, region: body.region ?? null, status: 'pending' })
          .returning({ id: organizations.id });
        orgId = org?.id ?? null;
      }

      const [user] = await tx
        .insert(users)
        .values({
          email: body.email,
          passwordHash,
          name: body.name,
          persona: body.persona,
          // Least privilege: every account starts at the lowest stored role.
          role: 'researcher',
          orgId,
          region: body.region ?? null,
          researchInterests: body.researchInterests,
          qualifications: body.qualifications ?? null,
          fundingNeedsMin: body.fundingNeedsMin ?? null,
          emailVerifiedAt: env.AUTH_REQUIRE_EMAIL_VERIFICATION ? null : new Date(),
          lastLoginAt: new Date(),
        })
        .returning();
      if (!user) throw new Error('user insert returned no row');
      // The structured profile starts from the form; documents come later.
      // Matches are scored on the first visit to the match list.
      await refreshProfile(tx, user.id, { applicantType: body.applicantType ?? null, rescore: false });

      await tx.insert(notifications).values({
        userId: user.id,
        type: 'system',
        title: 'Welcome to GrantSeeker',
        message: 'Your profile is active. Matching against open grant calls starts with the next harvest.',
      });

      const refresh = await issueRefreshToken(user.id, clientMeta(req), tx, { persistent: body.remember });
      await recordAudit(tx, req, {
        action: 'user.register',
        entity: 'user',
        entityId: user.id,
        actor: actorOf(user),
        diff: { orgId, viaInvite: Boolean(body.inviteCode) },
      });
      return { user, refresh };
    });

    const session = await sessionResponse(res, user, refresh);
    const dto = await withUserTx(
      { userId: user.id, orgId: user.orgId, level: ROLE_LEVEL[user.role] },
      (tx) => loadUserDto(tx, user.id),
    );
    res.status(201).json({ ...session, user: dto });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  handle({ body: LoginBody }, async (req, res, { body }) => {
    const [user] = await withSystemTx((tx) =>
      tx.select().from(users).where(eq(users.email, body.email)),
    );

    const now = new Date();
    const locked = user?.lockedUntil != null && user.lockedUntil > now;
    // Always verify, even for unknown or locked accounts, so timing does not
    // reveal which emails are registered.
    const { valid, needsRehash } = await verifyPassword(user?.passwordHash, body.password);

    if (!user || locked || !valid) {
      if (user && !locked) {
        const failures = user.failedLogins + 1;
        const lockNow = failures >= MAX_FAILED_LOGINS;
        await withSystemTx(async (tx) => {
          await tx
            .update(users)
            .set({
              failedLogins: lockNow ? 0 : failures,
              lockedUntil: lockNow ? new Date(now.getTime() + LOCKOUT_MS) : user.lockedUntil,
            })
            .where(eq(users.id, user.id));
          await recordAudit(tx, req, {
            action: lockNow ? 'auth.lockout' : 'auth.login_failed',
            entity: 'user',
            entityId: user.id,
            actor: null,
          });
        });
      }
      throw INVALID_CREDENTIALS();
    }

    if (user.suspendedAt) {
      // The password was right, so saying why is safe.
      throw new HttpError(403, 'account_suspended', 'This account is suspended');
    }

    const refresh = await withSystemTx(async (tx) => {
      await tx
        .update(users)
        .set({
          failedLogins: 0,
          lockedUntil: null,
          lastLoginAt: now,
          ...(needsRehash ? { passwordHash: await hashPassword(body.password) } : {}),
        })
        .where(eq(users.id, user.id));
      const refresh = await issueRefreshToken(user.id, clientMeta(req), tx, { persistent: body.remember });
      await recordAudit(tx, req, {
        action: 'user.login',
        entity: 'user',
        entityId: user.id,
        actor: actorOf(user),
        diff: { remember: body.remember },
      });
      return refresh;
    });

    const session = await sessionResponse(res, user, refresh);
    const dto = await withUserTx(
      { userId: user.id, orgId: user.orgId, level: ROLE_LEVEL[user.role] },
      (tx) => loadUserDto(tx, user.id),
    );
    res.json({ ...session, user: dto });
  }),
);

/* Password reset ---------------------------------------------------- */

const ResetToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This reset link is incomplete. Open it again from the email.');

authRouter.post(
  '/password/forgot',
  forgotPasswordLimiter,
  handle({ body: z.object({ email: zEmail }) }, async (req, res, { body }) => {
    await requestPasswordReset(req, body.email);
    // The same answer whether or not the address has an account.
    res.status(202).json({
      ok: true,
      message: `If an account uses ${body.email}, a reset link is on its way. It expires in ${RESET_TTL_MS / 60_000} minutes.`,
    });
  }),
);

authRouter.post(
  '/password/reset/check',
  resetPasswordLimiter,
  handle({ body: z.object({ token: ResetToken }) }, async (_req, res, { body }) => {
    const found = await checkResetToken(body.token);
    res.json(found ? { valid: true, email: found.email } : { valid: false });
  }),
);

authRouter.post(
  '/password/reset',
  resetPasswordLimiter,
  handle({ body: z.object({ token: ResetToken, password: zPassword }) }, async (req, res, { body }) => {
    const { email } = await resetPassword(req, body.token, body.password);
    // Every session was ended; the user signs in again with the new password.
    clearRefreshCookie(res);
    res.json({ ok: true, email });
  }),
);

/** Which sign-in methods the page may offer. The client id is public by design. */
authRouter.get(
  '/providers',
  handle({}, async (_req, res) => {
    const { registrationMode } = await withSystemTx(loadAccessPolicy);
    res.json({ password: true, google: googleConfigured() ? { clientId: env.GOOGLE_CLIENT_ID } : null, registration: registrationMode });
  }),
);

const GoogleBody = z.object({
  code: z.string().min(10).max(2_048),
  remember: z.boolean().default(true),
});

authRouter.post(
  '/google',
  loginLimiter,
  handle({ body: GoogleBody }, async (req, res, { body }) => {
    if (!googleConfigured()) throw new HttpError(503, 'google_unavailable', 'Google sign-in is not set up on this server.');
    const identity = await verifyGoogleIdToken(await exchangeGoogleCode(body.code));

    const { user, created, refresh } = await withSystemTx(async (tx) => {
      const found = await findOrCreateGoogleUser(tx, identity);
      if (found.user.suspendedAt) throw new HttpError(403, 'account_suspended', 'This account is suspended');
      await tx.update(users).set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(users.id, found.user.id));
      const refresh = await issueRefreshToken(found.user.id, clientMeta(req), tx, { persistent: body.remember });
      await recordAudit(tx, req, {
        action: found.created ? 'user.register' : 'user.login',
        entity: 'user',
        entityId: found.user.id,
        actor: actorOf(found.user),
        diff: { method: 'google', linked: found.linked, remember: body.remember },
      });
      return { ...found, refresh };
    });

    const session = await sessionResponse(res, user, refresh);
    const dto = await withUserTx(
      { userId: user.id, orgId: user.orgId, level: ROLE_LEVEL[user.role] },
      (tx) => loadUserDto(tx, user.id),
    );
    res.status(created ? 201 : 200).json({ ...session, user: dto, created });
  }),
);

authRouter.post(
  '/refresh',
  refreshLimiter,
  requireCsrfHeader,
  handle({}, async (req, res) => {
    const raw = readRefreshCookie(req);
    if (!raw) throw unauthorized('missing_refresh', 'No refresh token');

    const result = await rotateRefreshToken(raw, clientMeta(req));
    switch (result.kind) {
      case 'ok': {
        const [user] = await withSystemTx((tx) =>
          tx.select().from(users).where(eq(users.id, result.user.id)),
        );
        if (!user) throw unauthorized('invalid_refresh', 'Session is no longer valid');
        // Every tab does this every 15 minutes; reuse is what gets audited.
        skipAudit(req);
        const session = await sessionResponse(res, user, result.refresh);
        return res.json(session);
      }
      case 'stale':
        // Another tab rotated a moment ago; the browser already has the new
        // cookie, so the client should simply retry.
        return res.status(409).json({
          error: { code: 'refresh_race', message: 'Token was just rotated; retry' },
        });
      case 'reused':
        await withSystemTx((tx) =>
          recordAudit(tx, req, {
            action: 'auth.token_reuse',
            entity: 'refresh_family',
            entityId: result.familyId,
            actor: null,
            diff: { userId: result.userId },
          }),
        );
        clearRefreshCookie(res);
        throw unauthorized('refresh_reused', 'Session ended for security reasons; log in again');
      case 'invalid':
        clearRefreshCookie(res);
        throw unauthorized('invalid_refresh', 'Session expired; log in again');
    }
  }),
);

authRouter.post(
  '/logout',
  requireCsrfHeader,
  handle({}, async (req, res) => {
    const raw = readRefreshCookie(req);
    if (raw) {
      const revoked = await revokeRefreshFamily(raw);
      if (revoked) {
        await withSystemTx((tx) =>
          recordAudit(tx, req, {
            action: 'user.logout',
            entity: 'user',
            entityId: revoked.userId,
            actor: null,
          }),
        );
      }
    }
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  handle({}, async (req, res) => {
    const user = req.user!;
    await withSystemTx(async (tx) => {
      await revokeAllSessions(user.id, tx);
      await recordAudit(tx, req, { action: 'user.logout_all', entity: 'user', entityId: user.id });
    });
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  handle({}, async (req, res) => {
    const user = await withUserTx(req.identity!, (tx) => loadUserDto(tx, req.user!.id));
    res.json({ user });
  }),
);

/** Active sessions (one per refresh family), for a "signed-in devices" screen. */
authRouter.get(
  '/sessions',
  requireAuth,
  handle({}, async (req, res) => {
    const rows = await withSystemTx((tx) =>
      tx
        .selectDistinctOn([refreshTokens.familyId], {
          familyId: refreshTokens.familyId,
          userAgent: refreshTokens.userAgent,
          ip: refreshTokens.ip,
          lastUsedAt: refreshTokens.createdAt,
          expiresAt: refreshTokens.expiresAt,
        })
        .from(refreshTokens)
        .where(
          and(
            eq(refreshTokens.userId, req.user!.id),
            isNull(refreshTokens.revokedAt),
            isNull(refreshTokens.usedAt),
            gt(refreshTokens.expiresAt, sql`now()`),
          ),
        )
        .orderBy(refreshTokens.familyId, desc(refreshTokens.createdAt)),
    );
    res.json({ sessions: rows });
  }),
);

authRouter.delete(
  '/sessions/:familyId',
  requireAuth,
  handle({ params: z.object({ familyId: zUuid }) }, async (req, res, { params }) => {
    const revoked = await withSystemTx(async (tx) => {
      const rows = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.familyId, params.familyId),
            eq(refreshTokens.userId, req.user!.id),
            isNull(refreshTokens.revokedAt),
          ),
        )
        .returning({ id: refreshTokens.id });
      if (rows.length > 0) {
        await recordAudit(tx, req, {
          action: 'user.session_revoke',
          entity: 'refresh_family',
          entityId: params.familyId,
        });
      }
      return rows.length;
    });
    if (revoked === 0) throw notFound('Session not found');
    res.status(204).end();
  }),
);
