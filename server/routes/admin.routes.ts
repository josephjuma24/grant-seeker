import { and, count, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import cron from 'node-cron';
import { z } from 'zod';

import { sharedEnv } from '../config/base.ts';
import { pingDb, pool, withUserTx } from '../db/index.ts';
import {
  auditLog,
  funders,
  grants,
  organizations,
  orgStatusEnum,
  ROLE_LEVEL,
  scraperRuns,
  USER_ROLES,
  users,
} from '../db/schema.ts';
import { geminiAvailable } from '../lib/gemini.ts';
import { AccessPolicySchema, loadAccessPolicy, saveAccessPolicy } from '../lib/accessPolicy.ts';
import { badRequest, forbidden, notFound } from '../lib/httpError.ts';
import { revokeAllSessions } from '../lib/tokens.ts';
import { recordAudit } from '../middleware/auditLogger.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';
import { handle, zEmail, zPagination, zUuid } from '../middleware/validation.ts';
import { DEFAULT_SOURCES, funderSource, SCRAPER_CHANNEL } from '../workers/sources.ts';

export const adminRouter = Router();
adminRouter.use(requireAuth);

const identity = (req: Request) => req.identity!;
const IdParams = z.object({ id: zUuid });


/* ------------------------------------------------------------------ */
/* Audit log: org-scoped for officers, everything for super admins     */
/* ------------------------------------------------------------------ */

// Mounted before the super-admin gate: RLS narrows what each tier sees
// (grant officers and institution admins: their organisation's rows).
adminRouter.get(
  '/audit',
  requireRole('grant_officer'),
  handle(
    {
      query: zPagination.extend({
        actorId: zUuid.optional(),
        action: z.string().trim().max(80).optional(),
        entity: z.string().trim().max(80).optional(),
        entityId: z.string().trim().max(120).optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
      }),
    },
    async (req, res, { query }) => {
      const rows = await withUserTx(identity(req), (tx) =>
        tx
          .select({
            id: auditLog.id,
            at: auditLog.at,
            actorId: auditLog.actorId,
            actorName: users.name,
            actorLevel: auditLog.actorLevel,
            orgId: auditLog.orgId,
            action: auditLog.action,
            entity: auditLog.entity,
            entityId: auditLog.entityId,
            requestId: auditLog.requestId,
            ip: auditLog.ip,
            diff: auditLog.diff,
          })
          .from(auditLog)
          .leftJoin(users, eq(users.id, auditLog.actorId))
          .where(
            and(
              query.actorId ? eq(auditLog.actorId, query.actorId) : undefined,
              // `proposal.` matches every proposal action.
              query.action ? ilike(auditLog.action, `${query.action.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
              query.entity ? eq(auditLog.entity, query.entity) : undefined,
              query.entityId ? eq(auditLog.entityId, query.entityId) : undefined,
              query.from ? gte(auditLog.at, new Date(query.from)) : undefined,
              query.to ? lte(auditLog.at, new Date(query.to)) : undefined,
            ),
          )
          .orderBy(desc(auditLog.id))
          .limit(query.limit)
          .offset(query.offset),
      );
      res.json({ entries: rows });
    },
  ),
);

// Everything below: platform staff only.
adminRouter.use(requireRole('super_admin'));

/**
 * Walks the whole chain and recomputes every hash with the same SQL
 * function the insert trigger used. A row edited in place fails its own
 * hash; a row deleted or inserted out of band breaks the prev_hash link.
 */
adminRouter.get(
  '/audit/verify',
  handle({}, async (req, res) => {
    const result = await withUserTx(identity(req), async (tx) => {
      const { rows } = await tx.execute<{ checked: number; problems: { id: number; problem: string }[] | null }>(sql`
        with chain as (
          select a.id,
                 a.hash,
                 a.prev_hash,
                 app.audit_row_hash(a.prev_hash, a) as expected,
                 lag(a.hash) over (order by a.id) as prev_actual,
                 row_number() over (order by a.id) as n
          from audit_log a
        )
        select count(*)::int as checked,
               jsonb_agg(jsonb_build_object(
                 'id', id,
                 'problem', case when hash is distinct from expected then 'row_modified' else 'chain_broken' end
               ) order by id) filter (
                 where hash is distinct from expected
                    or (n > 1 and prev_hash is distinct from prev_actual)
                    or (n = 1 and prev_hash is not null)
               ) as problems
        from chain`);
      return rows[0]!;
    });
    const problems = result.problems ?? [];
    res.json({ ok: problems.length === 0, checked: result.checked, problems: problems.slice(0, 100) });
  }),
);

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

adminRouter.get(
  '/health',
  handle({}, async (req, res) => {
    const database = await pingDb();
    const stats = await withUserTx(identity(req), async (tx) => {
      const [u] = await tx
        .select({
          total: count(),
          suspended: sql<number>`count(*) filter (where ${users.suspendedAt} is not null)`.mapWith(Number),
          unverified: sql<number>`count(*) filter (where ${users.emailVerifiedAt} is null)`.mapWith(Number),
        })
        .from(users);
      const [g] = await tx
        .select({
          total: count(),
          active: sql<number>`count(*) filter (where ${grants.status} = 'active')`.mapWith(Number),
          unembedded: sql<number>`count(*) filter (where ${grants.embedding} is null)`.mapWith(Number),
        })
        .from(grants);
      const [pendingOrgs] = await tx.select({ n: count() }).from(organizations).where(eq(organizations.status, 'pending'));
      const [lastRun] = await tx.select().from(scraperRuns).orderBy(desc(scraperRuns.startedAt)).limit(1);
      return { users: u, grants: g, pendingOrganizations: pendingOrgs?.n ?? 0, lastScraperRun: lastRun ?? null };
    });
    const mem = process.memoryUsage();
    res.status(database.ok ? 200 : 503).json({
      status: database.ok ? 'ok' : 'degraded',
      database: { ...database, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } },
      gemini: { configured: geminiAvailable() },
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        rssMb: Math.round(mem.rss / 1_048_576),
        heapUsedMb: Math.round(mem.heapUsed / 1_048_576),
      },
      ...stats,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* Scraper orchestration                                               */
/* ------------------------------------------------------------------ */

adminRouter.get(
  '/scraper/runs',
  handle(
    { query: zPagination.extend({ status: z.enum(scraperRuns.status.enumValues).optional() }) },
    async (req, res, { query }) => {
      const rows = await withUserTx(identity(req), (tx) =>
        tx
          .select()
          .from(scraperRuns)
          .where(query.status ? eq(scraperRuns.status, query.status) : undefined)
          .orderBy(desc(scraperRuns.startedAt))
          .limit(query.limit)
          .offset(query.offset),
      );
      res.json({ runs: rows });
    },
  ),
);

/** "0 6,12 * * *" → "Every day at 06:00 and 12:00"; anything else is shown as written. */
export function describeSchedule(expr: string): string {
  const m = expr.trim().match(/^(\d{1,2}) ([\d,]+) \* \* \*$/);
  if (!m) return `Cron schedule "${expr}"`;
  const minute = m[1]!.padStart(2, '0');
  const times = m[2]!.split(',').map((h) => `${h.padStart(2, '0')}:${minute}`);
  const list = times.length > 1 ? `${times.slice(0, -1).join(', ')} and ${times.at(-1)}` : times[0];
  return `Every day at ${list}`;
}

/**
 * The automatic scan schedule, as the worker runs it (both read the same
 * settings), the next scan times, and whether a worker is connected to
 * carry them out.
 */
adminRouter.get(
  '/scraper/schedule',
  handle({}, async (req, res) => {
    const { SCRAPE_CRON: expr, CRON_TIMEZONE: timezone } = sharedEnv;
    // An unstarted task only computes dates; it never fires here.
    const task = cron.createTask(expr, () => {}, { timezone });
    const nextRuns = task.getNextRuns(2).map((d) => d.toISOString());
    await task.destroy();

    const status = await withUserTx(identity(req), async (tx) => {
      const { rows } = await tx.execute<{ online: boolean }>(
        sql`select exists (select 1 from pg_stat_activity where application_name = 'grantseeker-worker-listen') as online`,
      );
      const [lastAutomatic] = await tx
        .select({
          id: scraperRuns.id,
          status: scraperRuns.status,
          startedAt: scraperRuns.startedAt,
          finishedAt: scraperRuns.finishedAt,
          itemsFound: scraperRuns.itemsFound,
          itemsNew: scraperRuns.itemsNew,
        })
        .from(scraperRuns)
        .where(eq(scraperRuns.trigger, 'cron'))
        .orderBy(desc(scraperRuns.startedAt))
        .limit(1);
      return { workerOnline: rows[0]?.online ?? false, lastAutomatic: lastAutomatic ?? null };
    });

    res.json({ cron: expr, timezone, description: describeSchedule(expr), nextRuns, ...status });
  }),
);

/** What the harvester reads: built-in sources plus funders with a scrape_config. */
adminRouter.get(
  '/scraper/sources',
  handle({}, async (req, res) => {
    const rows = await withUserTx(identity(req), (tx) =>
      tx
        .select({ id: funders.id, slug: funders.slug, name: funders.name, scrapeConfig: funders.scrapeConfig })
        .from(funders)
        .where(sql`${funders.scrapeConfig} is not null`),
    );
    const sources = [...DEFAULT_SOURCES, ...rows.map(funderSource).filter((x) => x !== null)];
    res.json({
      sources: sources.map((x) => ({ id: x.id, label: x.label, adapter: x.config.adapter })),
      note: 'Built-in sources can be turned off on the worker with HARVEST_DEFAULT_SOURCES=false.',
    });
  }),
);

adminRouter.get(
  '/scraper/runs/:id',
  handle({ params: IdParams }, async (req, res, { params }) => {
    const [run] = await withUserTx(identity(req), (tx) => tx.select().from(scraperRuns).where(eq(scraperRuns.id, params.id)));
    if (!run) throw notFound('Run not found');
    res.json({ run });
  }),
);

/**
 * Asks the worker for a run now. The worker takes the same advisory lock
 * as its cron tick, so a request during a running harvest is a no-op, and
 * it records the run in scraper_runs itself. The NOTIFY is delivered at
 * commit, together with the audit row.
 */
adminRouter.post(
  '/scraper/run',
  handle(
    { body: z.object({ source: z.string().trim().max(200).optional() }).default({}) },
    async (req, res, { body }) => {
      const payload = JSON.stringify({ source: body.source ?? null, requestedBy: req.user!.id, requestId: req.requestId });
      await withUserTx(identity(req), async (tx) => {
        await tx.execute(sql`select pg_notify(${SCRAPER_CHANNEL}, ${payload})`);
        await recordAudit(tx, req, { action: 'scraper.run_requested', entity: 'scraper', diff: { source: body.source ?? null } });
      });
      res.status(202).json({
        queued: true,
        source: body.source ?? null,
        note: 'Picked up by the scraper worker; follow progress at GET /api/admin/scraper/runs.',
      });
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Users & organisations                                               */
/* ------------------------------------------------------------------ */

adminRouter.get(
  '/users',
  handle(
    {
      query: zPagination.extend({
        q: z.string().trim().min(1).max(120).optional(),
        role: z.enum(USER_ROLES).optional(),
        orgId: zUuid.optional(),
        suspended: z.enum(['true', 'false']).optional(),
      }),
    },
    async (req, res, { query }) => {
      const like = query.q ? `%${query.q.replace(/[\\%_]/g, '\\$&')}%` : undefined;
      const rows = await withUserTx(identity(req), (tx) =>
        tx
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            accessRole: users.role,
            persona: users.persona,
            orgId: users.orgId,
            organization: organizations.name,
            emailVerifiedAt: users.emailVerifiedAt,
            suspendedAt: users.suspendedAt,
            lockedUntil: users.lockedUntil,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
            total: sql<number>`count(*) over ()`.mapWith(Number),
          })
          .from(users)
          .leftJoin(organizations, eq(organizations.id, users.orgId))
          .where(
            and(
              like ? or(ilike(users.email, like), ilike(users.name, like)) : undefined,
              query.role ? eq(users.role, query.role) : undefined,
              query.orgId ? eq(users.orgId, query.orgId) : undefined,
              query.suspended === 'true' ? isNotNull(users.suspendedAt) : query.suspended === 'false' ? isNull(users.suspendedAt) : undefined,
            ),
          )
          .orderBy(desc(users.createdAt))
          .limit(query.limit)
          .offset(query.offset),
      );
      res.json({ users: rows.map(({ total: _t, ...u }) => u), total: rows[0]?.total ?? 0 });
    },
  ),
);

adminRouter.patch(
  '/users/:id',
  handle(
    {
      params: IdParams,
      body: z
        .object({
          role: z.enum(USER_ROLES),
          orgId: zUuid.nullable(),
          /** Why the change is needed; required to raise a role when the access policy says so. */
          reason: z.string().trim().min(5).max(500),
        })
        .partial()
        .refine((b) => b.role !== undefined || b.orgId !== undefined, 'Provide role or orgId'),
    },
    async (req, res, { params, body }) => {
      if (params.id === req.user!.id) throw forbidden('self_management', 'You cannot change your own role or organisation');
      const user = await withUserTx(identity(req), async (tx) => {
        const [before] = await tx.select({ role: users.role, orgId: users.orgId }).from(users).where(eq(users.id, params.id));
        if (!before) throw notFound('User not found');
        if (body.role) {
          const raising = ROLE_LEVEL[body.role] > ROLE_LEVEL[before.role];
          if (raising && !body.reason && (await loadAccessPolicy(tx)).requireReasonToElevate) {
            throw badRequest('reason_required', 'Say why this person needs the higher role. It is recorded in the audit log.');
          }
        }
        // No "last super admin" check is needed: only a super admin can get
        // here and nobody can change their own role, so one always remains.
        if (body.orgId) {
          const [org] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, body.orgId));
          if (!org) throw notFound('Organisation not found');
        }
        const [after] = await tx
          .update(users)
          .set({ ...(body.role ? { role: body.role } : {}), ...(body.orgId !== undefined ? { orgId: body.orgId } : {}) })
          .where(eq(users.id, params.id))
          .returning({ id: users.id, role: users.role, orgId: users.orgId });
        await recordAudit(tx, req, { action: 'admin.user_update', entity: 'user', entityId: params.id, diff: { before, after, reason: body.reason ?? null } });
        return after!;
      });
      res.json({ user: { id: user.id, accessRole: user.role, orgId: user.orgId } });
    },
  ),
);

adminRouter.post(
  '/users/:id/suspend',
  handle(
    { params: IdParams, body: z.object({ reason: z.string().trim().min(3).max(500) }) },
    async (req, res, { params, body }) => {
      if (params.id === req.user!.id) throw forbidden('self_management', 'You cannot suspend yourself');
      await withUserTx(identity(req), async (tx) => {
        const [u] = await tx
          .update(users)
          .set({ suspendedAt: new Date(), tokenVersion: sql`${users.tokenVersion} + 1` })
          .where(and(eq(users.id, params.id), isNull(users.suspendedAt)))
          .returning({ id: users.id });
        if (!u) throw notFound('User not found or already suspended');
        await recordAudit(tx, req, { action: 'admin.user_suspend', entity: 'user', entityId: params.id, diff: { reason: body.reason } });
      });
      // Refresh tokens live behind the system tier; bumping token_version
      // above already killed every access token.
      await revokeAllSessions(params.id);
      res.status(204).end();
    },
  ),
);

adminRouter.post(
  '/users/:id/unsuspend',
  handle({ params: IdParams }, async (req, res, { params }) => {
    await withUserTx(identity(req), async (tx) => {
      const [u] = await tx
        .update(users)
        .set({ suspendedAt: null })
        .where(and(eq(users.id, params.id), isNotNull(users.suspendedAt)))
        .returning({ id: users.id });
      if (!u) throw notFound('User not found or not suspended');
      await recordAudit(tx, req, { action: 'admin.user_unsuspend', entity: 'user', entityId: params.id });
    });
    res.status(204).end();
  }),
);

adminRouter.get(
  '/orgs',
  handle(
    { query: zPagination.extend({ status: z.enum(orgStatusEnum.enumValues).optional() }) },
    async (req, res, { query }) => {
      const rows = await withUserTx(identity(req), (tx) =>
        tx
          .select({
            id: organizations.id,
            name: organizations.name,
            type: organizations.type,
            region: organizations.region,
            status: organizations.status,
            createdAt: organizations.createdAt,
            members: sql<number>`(select count(*) from ${users} where ${users.orgId} = ${organizations.id})`.mapWith(Number),
          })
          .from(organizations)
          .where(query.status ? eq(organizations.status, query.status) : undefined)
          .orderBy(desc(organizations.createdAt))
          .limit(query.limit)
          .offset(query.offset),
      );
      res.json({ organizations: rows });
    },
  ),
);

adminRouter.patch(
  '/orgs/:id',
  handle(
    {
      params: IdParams,
      body: z.object({
        status: z.enum(orgStatusEnum.enumValues),
        // Activating a new org usually means naming its first admin.
        adminEmail: zEmail.optional(),
      }),
    },
    async (req, res, { params, body }) => {
      const out = await withUserTx(identity(req), async (tx) => {
        const [org] = await tx
          .update(organizations)
          .set({ status: body.status })
          .where(eq(organizations.id, params.id))
          .returning({ id: organizations.id, status: organizations.status });
        if (!org) throw notFound('Organisation not found');

        let adminId: string | null = null;
        if (body.adminEmail) {
          const [admin] = await tx
            .update(users)
            .set({ role: 'institution_admin' })
            .where(and(eq(users.email, body.adminEmail), eq(users.orgId, params.id)))
            .returning({ id: users.id });
          if (!admin) throw notFound('No member of this organisation has that email');
          adminId = admin.id;
        }
        await recordAudit(tx, req, {
          action: 'admin.org_update',
          entity: 'organization',
          entityId: params.id,
          diff: { status: body.status, adminId },
        });
        return { ...org, adminId };
      });
      res.json({ organization: out });
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Access policy and access review (least privilege)                   */
/* ------------------------------------------------------------------ */

adminRouter.get(
  '/access-policy',
  handle({}, async (req, res) => {
    res.json({ policy: await withUserTx(identity(req), loadAccessPolicy) });
  }),
);

adminRouter.put(
  '/access-policy',
  handle({ body: AccessPolicySchema.strict() }, async (req, res, { body }) => {
    const policy = await withUserTx(identity(req), async (tx) => {
      const before = await loadAccessPolicy(tx);
      await saveAccessPolicy(tx, body, req.user!.id);
      const { updatedAt: _a, updatedBy: _b, ...prev } = before;
      await recordAudit(tx, req, { action: 'admin.access_policy', entity: 'system', entityId: 'access_policy', diff: { before: prev, after: body } });
      return loadAccessPolicy(tx);
    });
    res.json({ policy });
  }),
);

/**
 * Everyone above researcher, with how recently they signed in. Privileged
 * accounts unused for the policy's dormancy window are flagged: under
 * least privilege, access nobody uses should be lowered or suspended.
 */
adminRouter.get(
  '/access-review',
  handle({}, async (req, res) => {
    const out = await withUserTx(identity(req), async (tx) => {
      const policy = await loadAccessPolicy(tx);
      const rows = await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          accessRole: users.role,
          organization: organizations.name,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          suspendedAt: users.suspendedAt,
          dormant: sql<boolean>`coalesce(${users.lastLoginAt}, ${users.createdAt}) < now() - make_interval(days => ${policy.dormantAfterDays})`,
        })
        .from(users)
        .leftJoin(organizations, eq(organizations.id, users.orgId))
        .where(sql`${users.role} <> 'researcher'`)
        .orderBy(sql`case ${users.role} when 'super_admin' then 0 when 'institution_admin' then 1 else 2 end`, users.name);
      const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(users);
      return { policy, rows, total };
    });
    res.json({
      dormantAfterDays: out.policy.dormantAfterDays,
      totalUsers: out.total,
      privileged: out.rows,
      counts: {
        super_admin: out.rows.filter((r) => r.accessRole === 'super_admin' && !r.suspendedAt).length,
        institution_admin: out.rows.filter((r) => r.accessRole === 'institution_admin' && !r.suspendedAt).length,
        grant_officer: out.rows.filter((r) => r.accessRole === 'grant_officer' && !r.suspendedAt).length,
        dormant: out.rows.filter((r) => r.dormant && !r.suspendedAt).length,
      },
    });
  }),
);
