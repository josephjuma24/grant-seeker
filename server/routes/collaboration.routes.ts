import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { withUserTx, type Tx } from '../db/index.ts';
import {
  funders,
  grants,
  teamGrants,
  teamGrantStatusEnum,
  teamMembers,
  teamMessages,
  teams,
  users,
} from '../db/schema.ts';
import { grantRowColumns } from '../lib/grantQueries.ts';
import { conflict, forbidden, notFound } from '../lib/httpError.ts';
import { toGrantDto } from '../lib/serializers.ts';
import { recordAudit, skipAudit } from '../middleware/auditLogger.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';
import { handle, zUuid } from '../middleware/validation.ts';

// Paths match the prototype's /api/collaboration/* so the SPA's calls are
// unchanged. What changed is who may do what:
//   - the directory lists only people who opted into a public profile, and
//     never their email;
//   - private teams are invisible to outsiders; public teams show a member
//     count, not member identities;
//   - only a team's owner adds people (and only people they can see);
//     anyone may join a public team; nobody may join a private one uninvited;
//   - an owner who leaves hands the team to the longest-standing member.
// RLS enforces the same rules (schema.ts, team_* policies).

export const collaborationRouter = Router();
collaborationRouter.use(requireAuth, requireRole('researcher'));

const meId = (req: Request) => req.user!.id;
const identity = (req: Request) => req.identity!;
const TeamParams = z.object({ teamId: zUuid });
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const MESSAGE_PAGE = 200;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Teams as the prototype's Consortium shape, from the caller's point of view. */
async function loadTeams(tx: Tx, userId: string, where?: SQL) {
  const rows = await tx
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      ownerId: teams.ownerId,
      creatorName: sql<string | null>`app.display_name(${teams.ownerId})`,
      isPrivate: teams.isPrivate,
      createdAt: teams.createdAt,
      memberCount: sql<number>`app.team_member_count(${teams.id})`.mapWith(Number),
    })
    .from(teams)
    .where(where)
    .orderBy(desc(teams.createdAt));
  if (rows.length === 0) return [];

  // Member ids and shared grants only for teams the caller belongs to (RLS
  // returns nothing for the others anyway).
  const ids = rows.map((r) => r.id);
  const memberships = await tx
    .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, ids));
  const shared = await tx
    .select({ teamId: teamGrants.teamId, grantId: teamGrants.grantId })
    .from(teamGrants)
    .where(inArray(teamGrants.teamId, ids));

  return rows.map((r) => {
    const memberIds = memberships.filter((m) => m.teamId === r.id).map((m) => m.userId);
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      creatorId: r.ownerId,
      creatorName: r.creatorName ?? '',
      memberIds: memberIds.includes(userId) ? memberIds : [],
      memberCount: r.memberCount,
      grantIds: shared.filter((g) => g.teamId === r.id).map((g) => g.grantId),
      isPrivate: r.isPrivate,
      isOwner: r.ownerId === userId,
      createdAt: r.createdAt,
    };
  });
}

async function loadTeam(tx: Tx, userId: string, teamId: string) {
  const [team] = await loadTeams(tx, userId, eq(teams.id, teamId));
  if (!team) throw notFound('Team not found');
  return team;
}

async function requireMember(tx: Tx, userId: string, teamId: string) {
  const team = await loadTeam(tx, userId, teamId);
  if (!team.memberIds.includes(userId)) throw forbidden('not_a_member', 'You are not a member of this team');
  return team;
}

/* ------------------------------------------------------------------ */
/* Directory                                                           */
/* ------------------------------------------------------------------ */

collaborationRouter.get(
  '/users',
  handle(
    {
      query: z.object({
        search: z.string().trim().max(120).optional(),
        expertise: z.string().trim().max(120).optional(),
        institution: z.string().trim().max(120).optional(),
      }),
    },
    async (req, res, { query }) => {
      const orgName = sql<string | null>`app.org_display_name(${users.orgId})`;
      const tagMatch = (col: typeof users.researchInterests | typeof users.collaborationInterests, term: string) =>
        sql`exists (select 1 from unnest(${col}) x where x ilike ${`%${escapeLike(term)}%`})`;

      const filters: (SQL | undefined)[] = [
        eq(users.isPublicProfile, true),
        ne(users.id, meId(req)),
        sql`${users.suspendedAt} is null`,
      ];
      if (query.search) {
        const like = `%${escapeLike(query.search)}%`;
        filters.push(
          or(
            ilike(users.name, like),
            ilike(users.qualifications, like),
            ilike(users.pastProjects, like),
            sql`${orgName} ilike ${like}`,
            tagMatch(users.researchInterests, query.search),
            tagMatch(users.collaborationInterests, query.search),
          ),
        );
      }
      if (query.expertise) {
        filters.push(
          or(tagMatch(users.researchInterests, query.expertise), tagMatch(users.collaborationInterests, query.expertise)),
        );
      }
      if (query.institution) filters.push(sql`${orgName} ilike ${`%${escapeLike(query.institution)}%`}`);

      const rows = await withUserTx(identity(req), (tx) =>
        tx
          .select({
            id: users.id,
            name: users.name,
            persona: users.persona,
            organization: orgName,
            region: users.region,
            researchInterests: users.researchInterests,
            collaborationInterests: users.collaborationInterests,
            qualifications: users.qualifications,
          })
          .from(users)
          .where(and(...filters))
          .orderBy(asc(users.name))
          .limit(50),
      );
      res.json({
        users: rows.map((u) => ({
          ...u,
          role: u.persona, // the prototype's field name
          organization: u.organization ?? '',
          institution: u.organization ?? '',
          region: u.region ?? '',
          qualifications: u.qualifications ?? '',
        })),
      });
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

collaborationRouter.get(
  '/teams',
  handle({}, async (req, res) => {
    // RLS: public teams plus the private ones the caller belongs to.
    const list = await withUserTx(identity(req), (tx) => loadTeams(tx, meId(req)));
    res.json({ teams: list });
  }),
);

collaborationRouter.post(
  '/teams',
  handle(
    {
      body: z.object({
        name: z.string().trim().min(2).max(120),
        description: z.string().trim().max(2_000).optional(),
        isPrivate: z.boolean().default(false),
      }),
    },
    async (req, res, { body }) => {
      const team = await withUserTx(identity(req), async (tx) => {
        const [created] = await tx
          .insert(teams)
          .values({ name: body.name, description: body.description ?? null, isPrivate: body.isPrivate, ownerId: meId(req) })
          .returning({ id: teams.id });
        await tx.insert(teamMembers).values({ teamId: created!.id, userId: meId(req), role: 'lead' });
        await recordAudit(tx, req, {
          action: 'team.create',
          entity: 'team',
          entityId: created!.id,
          diff: { isPrivate: body.isPrivate },
        });
        return loadTeam(tx, meId(req), created!.id);
      });
      res.status(201).json({ team });
    },
  ),
);

collaborationRouter.post(
  '/teams/:teamId/join',
  handle({ params: TeamParams }, async (req, res, { params }) => {
    const team = await withUserTx(identity(req), async (tx) => {
      const before = await loadTeam(tx, meId(req), params.teamId); // 404 for private teams
      if (before.memberIds.includes(meId(req))) throw conflict('already_member', 'You are already a member of this team');
      if (before.isPrivate) throw forbidden('private_team', 'Private teams are joined by invitation');
      await tx.insert(teamMembers).values({ teamId: params.teamId, userId: meId(req) });
      await recordAudit(tx, req, { action: 'team.join', entity: 'team', entityId: params.teamId });
      return loadTeam(tx, meId(req), params.teamId);
    });
    res.json({ team });
  }),
);

collaborationRouter.post(
  '/teams/:teamId/leave',
  handle({ params: TeamParams }, async (req, res, { params }) => {
    const outcome = await withUserTx(identity(req), async (tx) => {
      const team = await requireMember(tx, meId(req), params.teamId);
      const others = await tx
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, team.id), ne(teamMembers.userId, meId(req))))
        .orderBy(asc(teamMembers.joinedAt))
        .limit(1);

      if (team.isOwner && others.length === 0) {
        // Last one out: the team, its chat and shared grants go with it.
        await tx.delete(teams).where(eq(teams.id, team.id));
        await recordAudit(tx, req, { action: 'team.delete', entity: 'team', entityId: team.id, diff: { reason: 'last_member_left' } });
        return 'deleted' as const;
      }
      if (team.isOwner) {
        const heir = others[0]!.userId;
        // Promote first: once ownership moves, this session is no longer
        // the owner and RLS would silently skip the membership update.
        await tx
          .update(teamMembers)
          .set({ role: 'lead' })
          .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, heir)));
        await tx.update(teams).set({ ownerId: heir }).where(eq(teams.id, team.id));
        await recordAudit(tx, req, { action: 'team.transfer', entity: 'team', entityId: team.id, diff: { to: heir } });
      }
      await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, meId(req))));
      await recordAudit(tx, req, { action: 'team.leave', entity: 'team', entityId: team.id });
      return 'left' as const;
    });
    res.json({ message: outcome === 'deleted' ? 'Left team; it had no other members and was removed' : 'Left team successfully' });
  }),
);

/* Members ------------------------------------------------------------ */

collaborationRouter.get(
  '/teams/:teamId/members',
  handle({ params: TeamParams }, async (req, res, { params }) => {
    const members = await withUserTx(identity(req), async (tx) => {
      await requireMember(tx, meId(req), params.teamId);
      // Profile fields come through users RLS (visible when public or same
      // org); the name through app.display_name, which covers teammates.
      return tx
        .select({
          id: teamMembers.userId,
          name: sql<string | null>`app.display_name(${teamMembers.userId})`,
          teamRole: teamMembers.role,
          joinedAt: teamMembers.joinedAt,
          persona: users.persona,
          organization: sql<string | null>`app.org_display_name(${users.orgId})`,
          researchInterests: users.researchInterests,
        })
        .from(teamMembers)
        .leftJoin(users, eq(users.id, teamMembers.userId))
        .where(eq(teamMembers.teamId, params.teamId))
        .orderBy(asc(teamMembers.joinedAt));
    });
    res.json({
      members: members.map((m) => ({
        ...m,
        name: m.name ?? 'Team member',
        role: m.persona ?? m.teamRole, // the prototype showed the persona here
        organization: m.organization ?? '',
        institution: m.organization ?? '',
        researchInterests: m.researchInterests ?? [],
      })),
    });
  }),
);

collaborationRouter.post(
  '/teams/:teamId/members',
  handle({ params: TeamParams, body: z.object({ memberId: zUuid }) }, async (req, res, { params, body }) => {
    const team = await withUserTx(identity(req), async (tx) => {
      const current = await loadTeam(tx, meId(req), params.teamId);
      if (!current.isOwner) throw forbidden('not_team_owner', 'Only the team owner can add members');
      // RLS on users: only someone the owner can see (public profile, same
      // organisation) is found, so nobody is added by guessing an id.
      const [target] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, body.memberId), sql`${users.suspendedAt} is null`));
      if (!target) throw notFound('No collaborator with that id');
      await tx.insert(teamMembers).values({ teamId: params.teamId, userId: target.id }).onConflictDoNothing();
      await recordAudit(tx, req, { action: 'team.member_add', entity: 'team', entityId: params.teamId, diff: { userId: target.id } });
      return loadTeam(tx, meId(req), params.teamId);
    });
    res.json({ team });
  }),
);

collaborationRouter.delete(
  '/teams/:teamId/members/:memberId',
  handle({ params: TeamParams.extend({ memberId: zUuid }) }, async (req, res, { params }) => {
    if (params.memberId === meId(req)) throw forbidden('use_leave', 'Use leave to remove yourself');
    await withUserTx(identity(req), async (tx) => {
      const current = await loadTeam(tx, meId(req), params.teamId);
      if (!current.isOwner) throw forbidden('not_team_owner', 'Only the team owner can remove members');
      const removed = await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, params.teamId), eq(teamMembers.userId, params.memberId)))
        .returning({ userId: teamMembers.userId });
      if (removed.length === 0) throw notFound('Member not found');
      await recordAudit(tx, req, { action: 'team.member_remove', entity: 'team', entityId: params.teamId, diff: { userId: params.memberId } });
    });
    res.status(204).end();
  }),
);

/* Messages ----------------------------------------------------------- */

collaborationRouter.get(
  '/teams/:teamId/messages',
  handle(
    { params: TeamParams, query: z.object({ after: z.iso.datetime().optional() }) },
    async (req, res, { params, query }) => {
      const rows = await withUserTx(identity(req), async (tx) => {
        await requireMember(tx, meId(req), params.teamId);
        const newest = await tx
          .select({
            id: teamMessages.id,
            teamId: teamMessages.teamId,
            senderId: teamMessages.authorId,
            senderName: sql<string | null>`app.display_name(${teamMessages.authorId})`,
            content: teamMessages.body,
            timestamp: teamMessages.createdAt,
          })
          .from(teamMessages)
          .where(
            and(
              eq(teamMessages.teamId, params.teamId),
              // Polling clients ask only for what is new. created_at has
              // microseconds but JSON carries milliseconds, so "after" means
              // from the next millisecond on; otherwise the newest message
              // would come back on every poll.
              query.after ? gte(teamMessages.createdAt, new Date(new Date(query.after).getTime() + 1)) : undefined,
            ),
          )
          .orderBy(desc(teamMessages.createdAt))
          .limit(MESSAGE_PAGE);
        return newest.reverse();
      });
      res.json({ messages: rows.map((m) => ({ ...m, senderName: m.senderName ?? 'Former member' })) });
    },
  ),
);

collaborationRouter.post(
  '/teams/:teamId/messages',
  handle(
    { params: TeamParams, body: z.object({ content: z.string().trim().min(1).max(4_000) }) },
    async (req, res, { params, body }) => {
      const { message, senderName } = await withUserTx(identity(req), async (tx) => {
        await requireMember(tx, meId(req), params.teamId);
        const [m] = await tx
          .insert(teamMessages)
          .values({ teamId: params.teamId, authorId: meId(req), body: body.content })
          .returning();
        const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, meId(req)));
        return { message: m!, senderName: me?.name ?? null };
      });
      // The message row itself records author and time; an audit row per
      // chat line would only add noise.
      skipAudit(req);
      res.status(201).json({
        message: {
          id: message.id,
          teamId: message.teamId,
          senderId: message.authorId,
          senderName,
          content: message.body,
          timestamp: message.createdAt,
        },
      });
    },
  ),
);

/* Shared grants ------------------------------------------------------ */

collaborationRouter.get(
  '/teams/:teamId/grants',
  handle({ params: TeamParams }, async (req, res, { params }) => {
    const rows = await withUserTx(identity(req), async (tx) => {
      await requireMember(tx, meId(req), params.teamId);
      return tx
        .select({
          shared: teamGrants,
          sharedByName: sql<string | null>`app.display_name(${teamGrants.sharedBy})`,
          grant: grantRowColumns,
        })
        .from(teamGrants)
        .innerJoin(grants, eq(grants.id, teamGrants.grantId))
        .leftJoin(funders, eq(funders.id, grants.funderId))
        .where(eq(teamGrants.teamId, params.teamId))
        .orderBy(desc(teamGrants.updatedAt));
    });
    res.json({
      sharedGrants: rows.map((r) => ({
        id: r.shared.id,
        teamId: r.shared.teamId,
        grantId: r.shared.grantId,
        sharedById: r.shared.sharedBy,
        sharedByName: r.sharedByName ?? 'Former member',
        notes: r.shared.notes ?? '',
        status: r.shared.status,
        timestamp: r.shared.updatedAt,
        grant: toGrantDto(r.grant),
      })),
    });
  }),
);

collaborationRouter.post(
  '/teams/:teamId/grants',
  handle(
    { params: TeamParams, body: z.object({ grantId: zUuid, notes: z.string().trim().max(2_000).optional() }) },
    async (req, res, { params, body }) => {
      const shared = await withUserTx(identity(req), async (tx) => {
        await requireMember(tx, meId(req), params.teamId);
        const [grant] = await tx.select({ id: grants.id }).from(grants).where(eq(grants.id, body.grantId));
        if (!grant) throw notFound('Grant not found');
        const [row] = await tx
          .insert(teamGrants)
          .values({ teamId: params.teamId, grantId: grant.id, sharedBy: meId(req), notes: body.notes ?? null })
          .onConflictDoUpdate({
            target: [teamGrants.teamId, teamGrants.grantId],
            // Re-sharing updates the note, as in the prototype.
            set: body.notes ? { notes: body.notes } : { updatedAt: new Date() },
          })
          .returning();
        await recordAudit(tx, req, { action: 'team.grant_share', entity: 'team', entityId: params.teamId, diff: { grantId: grant.id } });
        return row!;
      });
      res.status(201).json({ sharedGrant: shared });
    },
  ),
);

collaborationRouter.put(
  '/teams/:teamId/grants/:grantId/status',
  handle(
    {
      params: TeamParams.extend({ grantId: zUuid }),
      body: z.object({ status: z.enum(teamGrantStatusEnum.enumValues) }),
    },
    async (req, res, { params, body }) => {
      const shared = await withUserTx(identity(req), async (tx) => {
        await requireMember(tx, meId(req), params.teamId);
        const [row] = await tx
          .update(teamGrants)
          .set({ status: body.status })
          .where(and(eq(teamGrants.teamId, params.teamId), eq(teamGrants.grantId, params.grantId)))
          .returning();
        if (!row) throw notFound('This grant is not shared with the team');
        await recordAudit(tx, req, {
          action: 'team.grant_status',
          entity: 'team',
          entityId: params.teamId,
          diff: { grantId: params.grantId, status: body.status },
        });
        return row;
      });
      res.json({ sharedGrant: shared });
    },
  ),
);
