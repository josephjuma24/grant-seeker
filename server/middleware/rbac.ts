import type { RequestHandler } from 'express';

import { ROLE_LEVEL, type RoleOrGuest, type UserRole } from '../db/schema.ts';
import { forbidden, unauthorized } from '../lib/httpError.ts';
import type { AuthUser } from '../types/express.d.ts';

export function hasRole(user: AuthUser | undefined, min: RoleOrGuest): boolean {
  return (user?.level ?? ROLE_LEVEL.guest) >= ROLE_LEVEL[min];
}

/**
 * Admits users at `min` or any higher tier. Mount after requireAuth.
 * Unverified accounts sit at guest level, so they fail every tier above it.
 *
 * This is the first wall; RLS still filters every row the handler touches,
 * so a missing check here cannot leak another org's data.
 */
export function requireRole(min: RoleOrGuest): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized('missing_token', 'Authentication required'));
    if (!hasRole(req.user, min)) {
      const reason = req.user.emailVerified ? 'insufficient_role' : 'email_unverified';
      return next(
        forbidden(reason, `Requires the ${min} tier or above`, {
          required: min,
          current: req.user.effectiveRole,
        }),
      );
    }
    next();
  };
}

/** For org-scoped admin routes: the caller must belong to an organisation. */
export const requireOrg: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized('missing_token', 'Authentication required'));
  if (!req.user.orgId && !hasRole(req.user, 'super_admin')) {
    return next(forbidden('no_organization', 'Join an organisation first'));
  }
  next();
};

/**
 * Whether `actor` may give someone `target`. Institution admins manage their
 * org up to grant_officer; only a super admin creates admins of either kind.
 */
export function canAssignRole(actor: AuthUser, target: UserRole): boolean {
  if (hasRole(actor, 'super_admin')) return true;
  if (hasRole(actor, 'institution_admin')) return ROLE_LEVEL[target] <= ROLE_LEVEL.grant_officer;
  return false;
}
