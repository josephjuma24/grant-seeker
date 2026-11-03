import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';

import { env } from '../config/env.ts';
import { withSystemTx } from '../db/index.ts';
import { passwordResetTokens, users } from '../db/schema.ts';
import { recordAudit } from '../middleware/auditLogger.ts';
import { isBreachedPassword } from './breachedPasswords.ts';
import { badRequest, HttpError } from './httpError.ts';
import { escapeHtml, sendMail } from './mailer.ts';
import { hashPassword } from './passwords.ts';
import { revokeAllSessions } from './tokens.ts';

// "Forgot password": a single-use link, valid for RESET_TTL_MS, emailed
// to the account's address. Only the token's SHA-256 is stored. Using it
// sets the new password and signs the account out everywhere.

export const RESET_TTL_MS = 30 * 60 * 1000;

const hashToken = (raw: string) => createHash('sha256').update(raw, 'utf8').digest();

/** The link in the email. The token sits in the fragment, which browsers never send to a server. */
export const resetLink = (token: string) => `${env.APP_URL}/#reset-password=${token}`;

const invalidLink = () =>
  new HttpError(400, 'reset_link_invalid', 'This reset link is invalid or has expired. Request a new one.');

function resetEmail(name: string, link: string) {
  const minutes = RESET_TTL_MS / 60_000;
  const text = [
    `Hello ${name},`,
    '',
    'Someone (hopefully you) asked to reset the password for your GrantSeeker account.',
    `Open this link within ${minutes} minutes to choose a new password:`,
    '',
    link,
    '',
    'The link works once. If you did not ask for this, ignore this email: your password stays as it is.',
    '',
    '— GrantSeeker Intelligence',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F9FAFB;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<div style="max-width:480px;margin:32px auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:32px">
<p style="margin:0 0 4px;font-weight:800;color:#2563EB">GrantSeeker</p>
<h1 style="font-size:20px;margin:0 0 16px">Reset your password</h1>
<p style="font-size:14px;line-height:1.6">Hello ${escapeHtml(name)}, someone (hopefully you) asked to reset the password for your GrantSeeker account.</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px">Choose a new password</a></p>
<p style="font-size:13px;line-height:1.6;color:#4B5563">The link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email: your password stays as it is.</p>
<p style="font-size:12px;color:#6B7280;word-break:break-all">If the button does not work, paste this into your browser:<br>${escapeHtml(link)}</p>
</div></body></html>`;
  return { subject: 'Reset your GrantSeeker password', text, html };
}

/**
 * Starts a reset for this email if an account has it. Always resolves the
 * same way, so the response never reveals whether an address is registered.
 * The email is sent after the transaction commits, without the caller
 * waiting for SMTP (which would also leak existence through timing).
 */
export async function requestPasswordReset(req: Request, email: string): Promise<void> {
  const issued = await withSystemTx(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, name: users.name, email: users.email, suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.email, email));
    if (!user || user.suspendedAt) return null;

    // A new link replaces any earlier unused one.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    const token = randomBytes(32).toString('base64url');
    await tx.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(token),
      // The database clock both sets and checks expiry, so app/DB clock skew cannot stretch or cut a link's life.
      expiresAt: sql`now() + make_interval(secs => ${RESET_TTL_MS / 1000})`,
      requestedIp: req.ip ?? null,
    });
    await recordAudit(tx, req, { action: 'auth.password_reset_requested', entity: 'user', entityId: user.id, actor: null });
    return { user, token };
  });
  if (!issued) return;

  const mail = resetEmail(issued.user.name, resetLink(issued.token));
  void sendMail({ to: issued.user.email, ...mail }).catch((err: Error) =>
    console.error(`[mail] password reset email failed: ${err.message}`),
  );
}

/** A live link: unused, unexpired, account not suspended. */
async function liveToken(tx: Parameters<Parameters<typeof withSystemTx>[0]>[0], token: string, lock = false) {
  const q = tx
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId, email: users.email })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, sql`now()`),
        isNull(users.suspendedAt),
      ),
    );
  const [row] = await (lock ? q.for('update', { of: passwordResetTokens }) : q);
  return row ?? null;
}

/** For the reset form: is the link still good, and for which address? */
export function checkResetToken(token: string): Promise<{ email: string } | null> {
  return withSystemTx(async (tx) => {
    const row = await liveToken(tx, token);
    return row ? { email: row.email } : null;
  });
}

/** Sets the new password, burns the link and ends every session of the account. */
export async function resetPassword(req: Request, token: string, password: string): Promise<{ email: string }> {
  if (await isBreachedPassword(password)) {
    throw badRequest('password_breached', 'This password has appeared in a data breach. Choose a different one.');
  }
  const passwordHash = await hashPassword(password);
  return withSystemTx(async (tx) => {
    const row = await liveToken(tx, token, true);
    if (!row) throw invalidLink();
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.userId, row.userId));
    // A reset also clears any lockout: the owner just proved control of the inbox.
    await tx.update(users).set({ passwordHash, failedLogins: 0, lockedUntil: null }).where(eq(users.id, row.userId));
    await revokeAllSessions(row.userId, tx);
    await recordAudit(tx, req, { action: 'auth.password_reset', entity: 'user', entityId: row.userId, actor: null });
    return { email: row.email };
  });
}
