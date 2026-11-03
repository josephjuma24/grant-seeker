import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { withSystemTx, withUserTx } from '../db/index.ts';
import {
  auditLog,
  notifications,
  organizations,
  PERSONAS,
  ROLE_LEVEL,
  USER_ROLES,
  users,
} from '../db/schema.ts';
import { loadAccessPolicy } from '../lib/accessPolicy.ts';
import { badRequest, forbidden, notFound } from '../lib/httpError.ts';
import { generateInviteCode } from '../lib/inviteCodes.ts';
import { refreshProfile } from '../lib/profileService.ts';
import { loadUserDto } from '../lib/userQueries.ts';
import { recordAudit, skipAudit } from '../middleware/auditLogger.ts';
import { requireAuth } from '../middleware/auth.ts';
import { canAssignRole, hasRole, requireOrg, requireRole } from '../middleware/rbac.ts';
import { handle, zPagination, zUuid } from '../middleware/validation.ts';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const me = (req: Request) => req.user!;
const identity = (req: Request) => req.identity!;

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

const text = (max: number) => z.string().trim().max(max);
const tags = z.array(z.string().trim().min(1).max(80)).max(30);

const ProfileBody = z
  .object({
    name: text(120).min(1),
    persona: z.enum(PERSONAS),
    // The prototype sent the persona as `role`. Accepted for the current
    // SPA; it never touches the access role.
    role: z.enum(PERSONAS),
    region: text(120),
    researchInterests: tags,
    collaborationInterests: tags,
    qualifications: text(2_000),
    fundingNeedsMin: z.number().nonnegative().max(1e12),
    pastProjects: text(10_000),
    pastPublications: text(10_000),
    projectDescriptions: text(10_000),
    teamMembers: text(5_000),
    isPublicProfile: z.boolean(),
  })
  .partial()
  .transform(({ role, persona, ...rest }) => ({ ...rest, persona: persona ?? role }))
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Provide at least one field');

// Changing any of these invalidates the profile embedding and the
// algorithmic match scores, as the prototype did on profile save.
const MATCH_INPUTS = [
  'persona',
  'region',
  'researchInterests',
  'qualifications',
  'fundingNeedsMin',
  'pastProjects',
  'pastPublications',
  'projectDescriptions',
] as const;

usersRouter.get(
  '/me',
  handle({}, async (req, res) => {
    res.json({ user: await withUserTx(identity(req), (tx) => loadUserDto(tx, me(req).id)) });
  }),
);

const updateProfile = handle({ body: ProfileBody }, async (req, res, { body }) => {
  const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  const rematch = MATCH_INPUTS.some((k) => k in changes);

  const user = await withUserTx(identity(req), async (tx) => {
    await tx
      .update(users)
      .set({ ...changes, ...(rematch ? { profileEmbedding: null } : {}) })
      .where(eq(users.id, me(req).id));
    // The structured profile reads the form too: read it again and rescore.
    // Feedback on matches is kept.
    if (rematch) await refreshProfile(tx, me(req).id);
    await recordAudit(tx, req, {
      action: 'user.profile_update',
      entity: 'user',
      entityId: me(req).id,
      diff: { fields: Object.keys(changes), rematch },
    });
    return loadUserDto(tx, me(req).id);
  });
  res.json({ user });
});

usersRouter.patch('/me', updateProfile);
/** @deprecated prototype path; use PATCH /api/users/me */
usersRouter.put('/profile', updateProfile);

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

usersRouter.get(
  '/me/notifications',
  handle(
    { query: zPagination.extend({ unread: z.enum(['true', 'false']).optional() }) },
    async (req, res, { query }) => {
      const rows = await withUserTx(identity(req), (tx) =>
        tx
          .select()
          .from(notifications)
          .where(and(eq(notifications.userId, me(req).id), query.unread === 'true' ? isNull(notifications.readAt) : undefined))
          .orderBy(desc(notifications.createdAt))
          .limit(query.limit)
          .offset(query.offset),
      );
      res.json({
        notifications: rows.map((n) => ({
          id: n.id,
          userId: n.userId,
          title: n.title,
          message: n.message,
          type: n.type,
          grantId: n.grantId,
          link: n.link,
          date: n.createdAt,
          read: n.readAt !== null,
        })),
      });
    },
  ),
);

usersRouter.post(
  '/me/notifications/read-all',
  handle({}, async (req, res) => {
    const updated = await withUserTx(identity(req), (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, me(req).id), isNull(notifications.readAt)))
        .returning({ id: notifications.id }),
    );
    skipAudit(req); // read receipts are not security events
    res.json({ success: true, updated: updated.length });
  }),
);

usersRouter.post(
  '/me/notifications/:id/read',
  handle({ params: z.object({ id: zUuid }) }, async (req, res, { params }) => {
    const updated = await withUserTx(identity(req), (tx) =>
      tx
        .update(notifications)
        .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
        .where(and(eq(notifications.id, params.id), eq(notifications.userId, me(req).id)))
        .returning({ id: notifications.id }),
    );
    if (updated.length === 0) throw notFound('Notification not found');
    skipAudit(req);
    res.json({ success: true });
  }),
);

/* ------------------------------------------------------------------ */
/* My activity (audit rows where I am the actor)                       */
/* ------------------------------------------------------------------ */

usersRouter.get(
  '/me/activity',
  handle({ query: zPagination }, async (req, res, { query }) => {
    const rows = await withUserTx(identity(req), (tx) =>
      tx
        .select({
          id: auditLog.id,
          at: auditLog.at,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          ip: auditLog.ip,
        })
        .from(auditLog)
        .where(eq(auditLog.actorId, me(req).id))
        .orderBy(desc(auditLog.id))
        .limit(query.limit)
        .offset(query.offset),
    );
    res.json({ activity: rows });
  }),
);

/* ------------------------------------------------------------------ */
/* Organisation provisioning                                           */
/* ------------------------------------------------------------------ */

usersRouter.get(
  '/org',
  requireOrg,
  handle({}, async (req, res) => {
    const result = await withUserTx(identity(req), async (tx) => {
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, me(req).orgId!));
      if (!org) return null;
      const [members] = await tx.select({ n: count() }).from(users).where(eq(users.orgId, org.id));
      return { org, memberCount: members?.n ?? 0 };
    });
    if (!result) throw notFound('Organisation not found');
    const { org, memberCount } = result;
    res.json({
      organization: {
        id: org.id,
        name: org.name,
        type: org.type,
        region: org.region,
        status: org.status,
        // Members only see their own count unless they run the org.
        memberCount: hasRole(me(req), 'grant_officer') ? memberCount : undefined,
        inviteCode: hasRole(me(req), 'institution_admin') ? org.inviteCode : undefined,
      },
    });
  }),
);

usersRouter.get(
  '/org/members',
  requireOrg,
  requireRole('grant_officer'),
  handle({ query: zPagination }, async (req, res, { query }) => {
    const rows = await withUserTx(identity(req), (tx) =>
      tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          accessRole: users.role,
          persona: users.persona,
          emailVerifiedAt: users.emailVerifiedAt,
          suspendedAt: users.suspendedAt,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.orgId, me(req).orgId!))
        .orderBy(users.name)
        .limit(query.limit)
        .offset(query.offset),
    );
    res.json({
      members: rows.map(({ emailVerifiedAt, suspendedAt, ...m }) => ({
        ...m,
        emailVerified: emailVerifiedAt !== null,
        suspended: suspendedAt !== null,
      })),
    });
  }),
);

usersRouter.post(
  '/org/invite-code',
  requireOrg,
  requireRole('institution_admin'),
  handle({}, async (req, res) => {
    const inviteCode = generateInviteCode();
    await withUserTx(identity(req), async (tx) => {
      const [org] = await tx
        .update(organizations)
        .set({ inviteCode })
        .where(and(eq(organizations.id, me(req).orgId!), eq(organizations.status, 'active')))
        .returning({ id: organizations.id });
      if (!org) throw badRequest('org_not_active', 'Invites open once the organisation is activated');
      await recordAudit(tx, req, { action: 'org.invite_rotate', entity: 'organization', entityId: org.id });
    });
    res.status(201).json({ inviteCode });
  }),
);

/** Loads an org member for an admin action, enforcing the tier rules. */
async function loadManagedMember(req: Request, memberId: string) {
  if (memberId === me(req).id) throw forbidden('self_management', 'You cannot change your own membership');
  return withUserTx(identity(req), async (tx) => {
    const [target] = await tx
      .select({ id: users.id, role: users.role, orgId: users.orgId })
      .from(users)
      .where(eq(users.id, memberId));
    if (!target || (target.orgId !== me(req).orgId && !hasRole(me(req), 'super_admin'))) {
      throw notFound('Member not found');
    }
    if (!canAssignRole(me(req), target.role)) {
      throw forbidden('insufficient_role', `Only a super admin can manage a ${target.role}`);
    }
    return target;
  });
}

usersRouter.patch(
  '/org/members/:id/role',
  requireOrg,
  requireRole('institution_admin'),
  handle(
    { params: z.object({ id: zUuid }), body: z.object({ role: z.enum(USER_ROLES) }) },
    async (req, res, { params, body }) => {
      const target = await loadManagedMember(req, params.id);
      if (!canAssignRole(me(req), body.role)) {
        throw forbidden('insufficient_role', `You cannot grant ${body.role}`);
      }
      // The access policy may cap institution admins lower still.
      if (!hasRole(me(req), 'super_admin')) {
        const policy = await withSystemTx(loadAccessPolicy);
        if (ROLE_LEVEL[body.role] > ROLE_LEVEL[policy.institutionAdminMaxRole]) {
          throw forbidden('policy_role_cap', `The access policy lets institution admins grant up to ${policy.institutionAdminMaxRole.replace('_', ' ')}`);
        }
      }
      await withUserTx(identity(req), async (tx) => {
        await tx.update(users).set({ role: body.role }).where(eq(users.id, target.id));
        await recordAudit(tx, req, {
          action: 'org.member_role',
          entity: 'user',
          entityId: target.id,
          diff: { from: target.role, to: body.role },
        });
      });
      // No token revocation needed: requireAuth reads the role from the
      // database on every request.
      res.json({ id: target.id, accessRole: body.role });
    },
  ),
);

usersRouter.delete(
  '/org/members/:id',
  requireOrg,
  requireRole('institution_admin'),
  handle({ params: z.object({ id: zUuid }) }, async (req, res, { params }) => {
    const target = await loadManagedMember(req, params.id);
    await withUserTx(identity(req), async (tx) => {
      // A plain UPDATE fails RLS here: see app.remove_org_member().
      const { rows } = await tx.execute<{ removed: boolean }>(sql`select app.remove_org_member(${target.id}) as removed`);
      if (!rows[0]?.removed) throw notFound('Member not found');
      await recordAudit(tx, req, {
        action: 'org.member_remove',
        entity: 'user',
        entityId: target.id,
        diff: { orgId: target.orgId, role: target.role },
      });
    });
    res.status(204).end();
  }),
);
