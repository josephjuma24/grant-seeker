import type { SessionIdentity } from '../db/index.ts';
import type { RoleOrGuest, UserRole } from '../db/schema.ts';

export interface AuthUser {
  id: string;
  role: UserRole;
  /** The tier RLS and requireRole() enforce: guest (10) until email is verified. */
  effectiveRole: RoleOrGuest;
  level: number;
  orgId: string | null;
  emailVerified: boolean;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth, and by optionalAuth when a token is presented. */
      user?: AuthUser;
      /** Pass to withUserTx(). null for anonymous requests. */
      identity?: SessionIdentity | null;
      /** Correlates log lines and audit rows for one request. */
      requestId?: string;
    }
  }
}

export {};
