import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { withUserTx, type Tx } from '../db/index.ts';
import { bookmarks, funders, grantMatches, grants } from '../db/schema.ts';
import { FIT_VERSION } from '../lib/fitScoring.ts';
import { embedText } from '../lib/gemini.ts';
import {
  GRANT_LIFECYCLES,
  grantRowColumns,
  isArchived,
  isExpired,
  isLive,
  lifecycleFilter,
  vectorLiteral,
  type GrantRow,
} from '../lib/grantQueries.ts';
import { conflict, notFound } from '../lib/httpError.ts';
import { rankedMatches, scoreUserMatches } from '../lib/matchService.ts';
import { toGrantDto, toMatchDto } from '../lib/serializers.ts';
import { recordAudit } from '../middleware/auditLogger.ts';
import { optionalAuth, requireAuth } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';
import { handle, zPagination, zUuid } from '../middleware/validation.ts';

export const grantsRouter = Router();

const identity = (req: Request) => req.identity ?? null;
const meId = (req: Request) => req.user!.id;
const GrantParams = z.object({ id: zUuid });

// The most matches the feed returns in one page.
const FEED_CANDIDATES = 300;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function loadGrant(tx: Tx, id: string): Promise<GrantRow> {
  const [row] = await tx
    .select(grantRowColumns)
    .from(grants)
    .leftJoin(funders, eq(funders.id, grants.funderId))
    .where(eq(grants.id, id));
  if (!row) throw notFound('Grant not found');
  return row;
}

async function loadMatch(tx: Tx, userId: string, grantId: string) {
  const [row] = await tx
    .select()
    .from(grantMatches)
    .where(and(eq(grantMatches.userId, userId), eq(grantMatches.grantId, grantId)));
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Catalogue (public)                                                  */
/* ------------------------------------------------------------------ */

const ListQuery = zPagination.extend({
  q: z.string().trim().min(1).max(200).optional(),
  // The prototype's name for q.
  search: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(80).optional(),
  funder: zUuid.optional(),
  region: z.string().trim().max(120).optional(),
  orgType: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'closed']).optional(),
  // active: open calls; expired: closed or past deadline; archived: filed away.
  lifecycle: z.enum([...GRANT_LIFECYCLES, 'all']).default('all'),
  deadlineFrom: z.iso.date().optional(),
  deadlineTo: z.iso.date().optional(),
  minAmount: z.coerce.number().nonnegative().optional(),
  maxAmount: z.coerce.number().nonnegative().optional(),
  sort: z.enum(['relevance', 'deadline', 'amount', 'newest']).default('relevance'),
});

grantsRouter.get(
  '/',
  optionalAuth,
  handle({ query: ListQuery }, async (req, res, { query }) => {
    const term = query.q ?? query.search;
    const tsQuery = term ? sql`websearch_to_tsquery('english', ${term})` : null;
    const all = (v?: string) => (v && v.toLowerCase() !== 'all' ? v : undefined);
    const category = all(query.category);
    const region = all(query.region);
    const orgType = all(query.orgType);

    const filters: (SQL | undefined)[] = [
      term && tsQuery
        ? or(
            sql`${grants.search} @@ ${tsQuery}`,
            ilike(grants.title, `%${escapeLike(term)}%`),
            sql`exists (select 1 from unnest(${grants.keywords}) k where k ilike ${`%${escapeLike(term)}%`})`,
          )
        : undefined,
      category ? sql`lower(${grants.category}) = lower(${category})` : undefined,
      query.funder ? eq(grants.funderId, query.funder) : undefined,
      region ? sql`exists (select 1 from unnest(${grants.eligibleRegions}) r where r ilike ${`%${escapeLike(region)}%`})` : undefined,
      orgType ? sql`exists (select 1 from unnest(${grants.eligibleOrgTypes}) o where o ilike ${`%${escapeLike(orgType)}%`})` : undefined,
      query.status ? eq(grants.status, query.status) : undefined,
      query.lifecycle !== 'all' ? lifecycleFilter[query.lifecycle] : undefined,
      query.deadlineFrom ? gte(grants.deadline, query.deadlineFrom) : undefined,
      query.deadlineTo ? lte(grants.deadline, query.deadlineTo) : undefined,
      query.minAmount !== undefined ? gte(grants.amount, query.minAmount) : undefined,
      query.maxAmount !== undefined ? lte(grants.amount, query.maxAmount) : undefined,
    ];

    const order: SQL[] =
      query.sort === 'deadline'
        ? [sql`${grants.deadline} asc nulls last`]
        : query.sort === 'amount'
          ? [sql`${grants.amount} desc nulls last`]
          : query.sort === 'newest' || !tsQuery
            ? [desc(grants.createdAt)]
            : [sql`ts_rank(${grants.search}, ${tsQuery}) desc`, desc(grants.createdAt)];

    const userId = req.user?.id;
    const rows = await withUserTx(identity(req), (tx) =>
      tx
        .select({
          ...grantRowColumns,
          total: sql<number>`count(*) over ()`.mapWith(Number),
          // Signed-in callers also get their own score and bookmark (RLS
          // limits both joins to their rows anyway).
          myScore: grantMatches.score,
          bookmarked: sql<boolean>`${bookmarks.grantId} is not null`,
        })
        .from(grants)
        .leftJoin(funders, eq(funders.id, grants.funderId))
        .leftJoin(
          grantMatches,
          userId ? and(eq(grantMatches.grantId, grants.id), eq(grantMatches.userId, userId)) : sql`false`,
        )
        .leftJoin(bookmarks, userId ? and(eq(bookmarks.grantId, grants.id), eq(bookmarks.userId, userId)) : sql`false`)
        .where(and(...filters))
        .orderBy(...order)
        .limit(query.limit)
        .offset(query.offset),
    );

    res.json({
      grants: rows.map(({ total: _t, myScore, bookmarked, ...g }) => ({
        ...toGrantDto(g),
        ...(userId ? { matchScore: myScore, bookmarked } : {}),
      })),
      total: rows[0]?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
    });
  }),
);

grantsRouter.get(
  '/funders',
  handle({}, async (_req, res) => {
    const rows = await withUserTx(null, (tx) =>
      tx
        .select({ id: funders.id, slug: funders.slug, name: funders.name, type: funders.type, website: funders.website })
        .from(funders)
        .orderBy(asc(funders.name)),
    );
    res.json({ funders: rows });
  }),
);

/* ------------------------------------------------------------------ */
/* Dashboard statistics (the prototype's /api/analytics/dashboard)     */
/* ------------------------------------------------------------------ */

const UPCOMING_DAYS = 45;
const RECENT_EXPIRY_DAYS = 30;
const STRONG_MATCH = 70;

grantsRouter.get(
  '/stats',
  optionalAuth,
  handle({}, async (req, res) => {
    const userId = req.user?.id;
    const stats = await withUserTx(identity(req), async (tx) => {
      // Past-deadline calls drop out at once, not only after housekeeping.
      const active = isLive;
      const [totals] = await tx
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
          funding: sql<number>`coalesce(sum(${grants.amount}), 0)`.mapWith(Number),
          average: sql<number>`coalesce(avg(${grants.amount}), 0)`.mapWith(Number),
          upcoming: sql<number>`count(*) filter (where ${grants.deadline} between current_date and current_date + ${UPCOMING_DAYS}::int)`.mapWith(Number),
        })
        .from(grants)
        .where(active);

      // "National Science Foundation (NSF)" → "National Science Foundation"
      const [lapsed] = await tx
        .select({
          expired: sql<number>`count(*) filter (where ${isExpired})`.mapWith(Number),
          expiredFunding: sql<number>`coalesce(sum(${grants.amount}) filter (where ${isExpired}), 0)`.mapWith(Number),
          expiredRecent: sql<number>`count(*) filter (where ${isExpired} and ${grants.deadline} >= current_date - ${RECENT_EXPIRY_DAYS}::int)`.mapWith(Number),
          archived: sql<number>`count(*) filter (where ${isArchived})`.mapWith(Number),
        })
        .from(grants);

      const funderName = sql<string>`coalesce(split_part(${funders.name}, ' (', 1), 'Unknown')`;
      const funderDistribution = await tx
        .select({ name: funderName, value: sql<number>`coalesce(sum(${grants.amount}), 0)`.mapWith(Number) })
        .from(grants)
        .leftJoin(funders, eq(funders.id, grants.funderId))
        .where(active)
        .groupBy(funderName)
        .orderBy(sql`coalesce(sum(${grants.amount}), 0) desc`)
        .limit(5);

      const category = sql<string>`coalesce(${grants.category}, 'Other')`;
      const categoryDistribution = await tx
        .select({ name: category, value: sql<number>`count(*)`.mapWith(Number) })
        .from(grants)
        .where(active)
        .groupBy(category)
        .orderBy(category);

      const month = sql<string>`to_char(${grants.deadline}, 'YYYY-MM')`;
      const timelineData = await tx
        .select({
          date: month,
          count: sql<number>`count(*)`.mapWith(Number),
          amount: sql<number>`coalesce(sum(${grants.amount}), 0)`.mapWith(Number),
        })
        .from(grants)
        .where(and(active, isNotNull(grants.deadline)))
        .groupBy(month)
        .orderBy(month);

      let successRate: number | null = null;
      let matchedGrantsCount = 0;
      if (userId) {
        const [mine] = await tx.execute<{ awarded: number; closed: number }>(sql`
          select count(*) filter (where status = 'awarded')::int as awarded,
                 count(*) filter (where status in ('awarded', 'rejected'))::int as closed
          from proposals where owner_id = ${userId}`).then((r) => r.rows);
        // No made-up baseline: without a decided proposal there is no rate.
        successRate = mine && mine.closed > 0 ? Math.round((mine.awarded / mine.closed) * 100) : null;
        const [strong] = await tx
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(grantMatches)
          .where(and(eq(grantMatches.userId, userId), gte(grantMatches.score, STRONG_MATCH)));
        matchedGrantsCount = strong?.n ?? 0;
      }

      return {
        totalActiveGrants: totals?.count ?? 0,
        totalFundingAvailable: totals?.funding ?? 0,
        averageGrantAmount: totals?.average ?? 0,
        upcomingDeadlinesCount: totals?.upcoming ?? 0,
        expiredGrantsCount: lapsed?.expired ?? 0,
        expiredFunding: lapsed?.expiredFunding ?? 0,
        expiredRecentCount: lapsed?.expiredRecent ?? 0,
        archivedGrantsCount: lapsed?.archived ?? 0,
        matchedGrantsCount,
        successRate,
        funderDistribution,
        categoryDistribution,
        timelineData,
      };
    });
    res.json(stats);
  }),
);

/* ------------------------------------------------------------------ */
/* Archive: file expired calls away from the expired list              */
/* ------------------------------------------------------------------ */

// Grant rows are catalogue data: only super admins may write them (RLS
// grants_write_app enforces the same).

grantsRouter.post(
  '/archive-expired',
  requireAuth,
  requireRole('super_admin'),
  handle(
    // olderThanDays: only calls whose deadline passed at least this long ago.
    { body: z.object({ olderThanDays: z.number().int().min(0).max(3650).default(0) }).default({ olderThanDays: 0 }) },
    async (req, res, { body }) => {
      const archived = await withUserTx(identity(req), async (tx) => {
        const rows = await tx
          .update(grants)
          .set({ archivedAt: sql`now()`, archivedBy: meId(req), status: 'closed' })
          .where(
            and(
              isExpired,
              body.olderThanDays > 0
                ? sql`coalesce(${grants.deadline}, ${grants.updatedAt}::date) < current_date - ${body.olderThanDays}::int`
                : undefined,
            ),
          )
          .returning({ id: grants.id });
        await recordAudit(tx, req, {
          action: 'grant.archive_expired',
          entity: 'grant',
          diff: { archived: rows.length, olderThanDays: body.olderThanDays },
        });
        return rows.length;
      });
      res.json({ archived });
    },
  ),
);

grantsRouter.post(
  '/:id/archive',
  requireAuth,
  requireRole('super_admin'),
  handle({ params: GrantParams }, async (req, res, { params }) => {
    const grant = await withUserTx(identity(req), async (tx) => {
      const current = await loadGrant(tx, params.id);
      if (current.lifecycle === 'active') {
        throw conflict('grant_not_expired', 'Only expired calls can be archived');
      }
      if (current.lifecycle === 'expired') {
        await tx
          .update(grants)
          .set({ archivedAt: sql`now()`, archivedBy: meId(req), status: 'closed' })
          .where(eq(grants.id, params.id));
        await recordAudit(tx, req, { action: 'grant.archive', entity: 'grant', entityId: params.id });
      }
      return loadGrant(tx, params.id);
    });
    res.json({ grant: toGrantDto(grant) });
  }),
);

grantsRouter.post(
  '/:id/restore',
  requireAuth,
  requireRole('super_admin'),
  handle({ params: GrantParams }, async (req, res, { params }) => {
    const grant = await withUserTx(identity(req), async (tx) => {
      await loadGrant(tx, params.id);
      // Back to the expired list; it stays closed.
      await tx.update(grants).set({ archivedAt: null, archivedBy: null }).where(eq(grants.id, params.id));
      await recordAudit(tx, req, { action: 'grant.restore', entity: 'grant', entityId: params.id });
      return loadGrant(tx, params.id);
    });
    res.json({ grant: toGrantDto(grant) });
  }),
);

/* ------------------------------------------------------------------ */
/* Semantic search                                                     */
/* ------------------------------------------------------------------ */

grantsRouter.get(
  '/search/semantic',
  requireAuth,
  requireRole('researcher'),
  handle(
    { query: z.object({ q: z.string().trim().min(3).max(500), limit: z.coerce.number().int().min(1).max(50).default(20) }) },
    async (req, res, { query }) => {
      const vec = await embedText(query.q, 'RETRIEVAL_QUERY');
      const result = await withUserTx(identity(req), async (tx) => {
        if (vec) {
          const qv = sql`${vectorLiteral(vec)}::vector`;
          const rows = await tx
            .select({ ...grantRowColumns, similarity: sql<number>`1 - (${grants.embedding} <=> ${qv})` })
            .from(grants)
            .leftJoin(funders, eq(funders.id, grants.funderId))
            .where(and(isLive, isNotNull(grants.embedding)))
            .orderBy(sql`${grants.embedding} <=> ${qv}`)
            .limit(query.limit);
          if (rows.length > 0) return { method: 'vector' as const, rows };
        }
        // No Gemini key, the call failed, or nothing is embedded yet.
        const ts = sql`websearch_to_tsquery('english', ${query.q})`;
        const rows = await tx
          .select({ ...grantRowColumns, similarity: sql<number>`ts_rank(${grants.search}, ${ts})` })
          .from(grants)
          .leftJoin(funders, eq(funders.id, grants.funderId))
          .where(and(isLive, sql`${grants.search} @@ ${ts}`))
          .orderBy(sql`ts_rank(${grants.search}, ${ts}) desc`)
          .limit(query.limit);
        return { method: 'fulltext' as const, rows };
      });
      res.json({
        method: result.method,
        grants: result.rows.map(({ similarity, ...g }) => ({ ...toGrantDto(g), similarity })),
      });
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Match feed                                                          */
/* ------------------------------------------------------------------ */

grantsRouter.get(
  '/matches',
  requireAuth,
  requireRole('researcher'),
  handle(
    {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(FEED_CANDIDATES).default(50),
        minScore: z.coerce.number().int().min(0).max(100).default(0),
      }),
    },
    async (req, res, { query }) => {
      const userId = meId(req);
      const feed = await withUserTx(identity(req), async (tx) => {
        // Same ranking as /api/profile/matches; ineligible calls stay in
        // this older feed, flagged, as the dashboard lists every match.
        const ranked = await rankedMatches(tx, userId, { limit: query.limit, minScore: query.minScore, includeIneligible: true });
        if (ranked.length === 0) return [];
        const rows = await tx
          .select(grantRowColumns)
          .from(grants)
          .leftJoin(funders, eq(funders.id, grants.funderId))
          .where(inArray(grants.id, ranked.map((r) => r.grantId)));
        const byId = new Map(rows.map((g) => [g.id, g]));
        return ranked.map((r) => ({ ...toMatchDto(r.match), grant: toGrantDto(byId.get(r.grantId)!) }));
      });
      res.json({ matches: feed });
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Bookmarks                                                           */
/* ------------------------------------------------------------------ */

grantsRouter.get(
  '/bookmarks',
  requireAuth,
  requireRole('researcher'),
  handle({ query: zPagination }, async (req, res, { query }) => {
    const rows = await withUserTx(identity(req), (tx) =>
      tx
        .select({ ...grantRowColumns, note: bookmarks.note, remindAt: bookmarks.remindAt, bookmarkedAt: bookmarks.createdAt })
        .from(bookmarks)
        .innerJoin(grants, eq(grants.id, bookmarks.grantId))
        .leftJoin(funders, eq(funders.id, grants.funderId))
        .where(eq(bookmarks.userId, meId(req)))
        .orderBy(desc(bookmarks.createdAt))
        .limit(query.limit)
        .offset(query.offset),
    );
    res.json({
      bookmarks: rows.map(({ note, remindAt, bookmarkedAt, ...g }) => ({ grant: toGrantDto(g), note, remindAt, bookmarkedAt })),
    });
  }),
);

grantsRouter.put(
  '/:id/bookmark',
  requireAuth,
  requireRole('researcher'),
  handle(
    {
      params: GrantParams,
      body: z.object({ note: z.string().trim().max(2_000).optional(), remindAt: z.iso.datetime().optional() }).default({}),
    },
    async (req, res, { params, body }) => {
      const userId = meId(req);
      const values = { note: body.note ?? null, remindAt: body.remindAt ? new Date(body.remindAt) : null };
      await withUserTx(identity(req), async (tx) => {
        await loadGrant(tx, params.id);
        await tx
          .insert(bookmarks)
          .values({ userId, grantId: params.id, ...values })
          .onConflictDoUpdate({ target: [bookmarks.userId, bookmarks.grantId], set: values });
        await recordAudit(tx, req, { action: 'grant.bookmark', entity: 'grant', entityId: params.id });
      });
      res.json({ bookmarked: true, ...values });
    },
  ),
);

grantsRouter.delete(
  '/:id/bookmark',
  requireAuth,
  requireRole('researcher'),
  handle({ params: GrantParams }, async (req, res, { params }) => {
    await withUserTx(identity(req), async (tx) => {
      const removed = await tx
        .delete(bookmarks)
        .where(and(eq(bookmarks.userId, meId(req)), eq(bookmarks.grantId, params.id)))
        .returning({ grantId: bookmarks.grantId });
      if (removed.length === 0) throw notFound('Bookmark not found');
      await recordAudit(tx, req, { action: 'grant.unbookmark', entity: 'grant', entityId: params.id });
    });
    res.status(204).end();
  }),
);

/* ------------------------------------------------------------------ */
/* Single grant, similar grants, one match                             */
/* ------------------------------------------------------------------ */

grantsRouter.get(
  '/:id',
  optionalAuth,
  handle({ params: GrantParams }, async (req, res, { params }) => {
    const grant = await withUserTx(identity(req), (tx) => loadGrant(tx, params.id));
    res.json({ grant: toGrantDto(grant) });
  }),
);

grantsRouter.get(
  '/:id/similar',
  handle(
    { params: GrantParams, query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(6) }) },
    async (req, res, { params, query }) => {
      const result = await withUserTx(null, async (tx) => {
        const base = await loadGrant(tx, params.id);
        if (base.hasEmbedding) {
          const target = sql`(select ${grants.embedding} from ${grants} where ${grants.id} = ${params.id})`;
          const rows = await tx
            .select({ ...grantRowColumns, similarity: sql<number>`1 - (${grants.embedding} <=> ${target})` })
            .from(grants)
            .leftJoin(funders, eq(funders.id, grants.funderId))
            .where(and(isLive, isNotNull(grants.embedding), sql`${grants.id} <> ${params.id}`))
            .orderBy(sql`${grants.embedding} <=> ${target}`)
            .limit(query.limit);
          return { method: 'vector' as const, rows };
        }
        // Not embedded yet: same category, most keyword overlap first.
        const overlap = sql<number>`cardinality(array(select unnest(${grants.keywords}) intersect select unnest(g2.keywords) from ${grants} g2 where g2.id = ${params.id}))::real`;
        const rows = await tx
          .select({ ...grantRowColumns, similarity: overlap })
          .from(grants)
          .leftJoin(funders, eq(funders.id, grants.funderId))
          .where(
            and(
              isLive,
              sql`${grants.id} <> ${params.id}`,
              base.category ? eq(grants.category, base.category) : undefined,
            ),
          )
          .orderBy(desc(overlap), asc(grants.deadline))
          .limit(query.limit);
        return { method: 'keywords' as const, rows };
      });
      res.json({
        method: result.method,
        grants: result.rows.map(({ similarity, ...g }) => ({ ...toGrantDto(g), similarity })),
      });
    },
  ),
);

grantsRouter.get(
  '/:id/match',
  requireAuth,
  requireRole('researcher'),
  handle({ params: GrantParams }, async (req, res, { params }) => {
    const userId = meId(req);
    const out = await withUserTx(identity(req), async (tx) => {
      const grant = await loadGrant(tx, params.id);
      let match = await loadMatch(tx, userId, grant.id);
      // Never scored, or scored by an older scorer: score it now. Closed
      // calls are not rescored; their last match is still shown.
      if (grant.status === 'active' && match?.model !== FIT_VERSION) {
        await scoreUserMatches(tx, userId, { grantIds: [grant.id] });
        match = await loadMatch(tx, userId, grant.id);
      }
      if (!match) throw notFound('No match for this grant');
      return { match: toMatchDto(match), grant: toGrantDto(grant) };
    });
    res.json(out);
  }),
);

grantsRouter.post(
  '/:id/match/feedback',
  requireAuth,
  requireRole('researcher'),
  handle(
    { params: GrantParams, body: z.object({ feedback: z.enum(['relevant', 'not_relevant']).nullable() }) },
    async (req, res, { params, body }) => {
      const userId = meId(req);
      const result = await withUserTx(identity(req), async (tx) => {
        const grant = await loadGrant(tx, params.id);
        // Feedback is recorded, not scored: a fit score stays explainable
        // from the profile and the call alone.
        if (!(await loadMatch(tx, userId, grant.id))) await scoreUserMatches(tx, userId, { grantIds: [grant.id] });
        const [match] = await tx
          .update(grantMatches)
          .set({ feedback: body.feedback })
          .where(and(eq(grantMatches.userId, userId), eq(grantMatches.grantId, grant.id)))
          .returning();
        if (!match) throw notFound('No match for this grant');
        await recordAudit(tx, req, { action: 'match.feedback', entity: 'grant', entityId: grant.id, diff: { feedback: body.feedback } });
        return { match };
      });
      res.json({ success: true, rescored: 0, match: toMatchDto(result.match) });
    },
  ),
);
