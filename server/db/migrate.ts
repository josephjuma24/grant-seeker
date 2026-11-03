/**
 * Schema migrations + one-off import of the prototype's server-db.json.
 *
 *   npm run db:migrate                         schema only
 *   npm run db:migrate -- --import-json        schema, then ./server-db.json
 *   npm run db:migrate -- --import-json path/to/file.json --dry-run
 *
 * Connects as the table-owning role (MIGRATION_DATABASE_URL). The owner is
 * not subject to RLS (policies are not FORCEd), which the import relies on.
 * The import runs in one transaction and is idempotent: rows already
 * present (by legacy id, email, slug or url) are skipped. --dry-run does
 * all the work, prints the counts, and rolls back.
 */
import 'dotenv/config';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { z } from 'zod';

import * as schema from './schema.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv: string[]) {
  const args = { importJson: null as string | null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--import-json') {
      const next = argv[i + 1];
      args.importJson = next && !next.startsWith('--') ? (i++, next) : 'server-db.json';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const databaseUrl = z
  .string({ message: 'Set MIGRATION_DATABASE_URL (table owner) or DATABASE_URL' })
  .url()
  .parse(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

async function runSqlFile(client: pg.PoolClient, file: string) {
  // Simple-query protocol: the file may hold many statements and DO blocks.
  await client.query(readFileSync(path.join(here, 'sql', file), 'utf8'));
  console.log(`  applied sql/${file}`);
}

async function migrateSchema(pool: pg.Pool) {
  console.log('Migrating schema');
  const client = await pool.connect();
  try {
    await runSqlFile(client, '000_bootstrap.sql');
  } finally {
    client.release();
  }
  await migrate(drizzle(pool), { migrationsFolder: path.join(here, 'migrations') });
  console.log('  applied drizzle migrations');
  const client2 = await pool.connect();
  try {
    await runSqlFile(client2, '900_hardening.sql');
  } finally {
    client2.release();
  }
}

/* ------------------------------------------------------------------ */
/* Legacy JSON shapes (only the fields we carry over)                  */
/* ------------------------------------------------------------------ */

const str = z.string().catch('');
const optStr = z.string().optional().catch(undefined);
const num = z.coerce.number().catch(0);
const strArr = z.array(z.string()).catch([]);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);
const timestampStr = z.string().optional().catch(undefined);

const Legacy = z.object({
  users: z
    .array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: str,
        role: z.enum(schema.PERSONAS).catch('academic'),
        organization: optStr,
        institution: optStr,
        region: optStr,
        researchInterests: strArr,
        collaborationInterests: strArr,
        qualifications: optStr,
        fundingNeedsMin: z.coerce.number().optional().catch(undefined),
        pastProjects: optStr,
        teamMembers: optStr,
        pastPublications: optStr,
        projectDescriptions: optStr,
        isPublicProfile: z.boolean().catch(false),
      }),
    )
    .default([]),
  funders: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(['government', 'foundation', 'corporate', 'international']).catch('foundation'),
        website: optStr,
      }),
    )
    .default([]),
  grants: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        subject: optStr,
        fundingAmount: z.coerce.number().optional().catch(undefined),
        deadline: isoDate,
        eligibleRegions: strArr,
        eligibleOrgTypes: strArr,
        description: str,
        category: optStr,
        source: optStr,
        url: str,
        status: z.enum(['active', 'closed']).catch('active'),
        funderId: optStr,
        extractedKeywords: strArr,
        objectives: optStr,
        requiredOutcomes: optStr,
        scope: optStr,
      }),
    )
    .default([]),
  matches: z
    .array(
      z.object({
        grantId: z.string(),
        userId: z.string(),
        matchScore: num,
        rationale: optStr,
        isGemini: z.boolean().catch(false),
        relevanceBreakdown: z
          .object({ subject: num, eligibility: num, amount: num, urgency: num })
          .optional()
          .catch(undefined),
        feedback: z.enum(['relevant', 'not_relevant']).nullable().optional().catch(null),
      }),
    )
    .default([]),
  notifications: z
    .array(
      z.object({
        id: z.string(),
        userId: z.string(),
        title: str,
        message: str,
        date: timestampStr,
        read: z.boolean().catch(false),
        type: z.enum(['deadline', 'new_grant', 'match_alert']).catch('new_grant'),
        grantId: optStr,
      }),
    )
    .default([]),
  applications: z
    .array(
      z.object({
        id: z.string(),
        userId: z.string(),
        grantId: optStr,
        grantTitle: str,
        amount: z.coerce.number().optional().catch(undefined),
        deadline: isoDate,
        status: z.enum(['draft', 'submitted', 'awarded', 'rejected']).catch('draft'),
        submittedDate: isoDate,
        notes: optStr,
        history: z
          .array(
            z.object({
              status: z.enum(['draft', 'submitted', 'awarded', 'rejected']).catch('draft'),
              timestamp: timestampStr,
              notes: optStr,
            }),
          )
          .catch([]),
      }),
    )
    .default([]),
  scraperLogs: z
    .array(
      z.object({
        timestamp: timestampStr,
        source: optStr,
        status: z.enum(['success', 'failed']).catch('failed'),
        itemsExtracted: num,
        message: optStr,
      }),
    )
    .default([]),
  consortia: z
    .array(
      z.object({
        id: z.string(),
        name: str,
        description: optStr,
        creatorId: z.string(),
        memberIds: strArr,
        grantIds: strArr,
        isPrivate: z.boolean().catch(true),
      }),
    )
    .default([]),
  teamMessages: z
    .array(
      z.object({
        teamId: z.string(),
        senderId: z.string(),
        content: str,
        timestamp: timestampStr,
      }),
    )
    .default([]),
  teamSharedGrants: z
    .array(
      z.object({
        teamId: z.string(),
        grantId: z.string(),
        sharedById: optStr,
        notes: optStr,
        status: z.enum(['planning', 'draft', 'submitted', 'awarded', 'rejected']).catch('planning'),
      }),
    )
    .default([]),
});
type LegacyDb = z.infer<typeof Legacy>;

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

type Counts = Record<string, { read: number; inserted: number }>;

const toDate = (s: string | undefined) => {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

class DryRunRollback extends Error {}

async function importJson(pool: pg.Pool, file: string, dryRun: boolean) {
  const data: LegacyDb = Legacy.parse(JSON.parse(readFileSync(file, 'utf8')));
  const db = drizzle(pool, { schema });
  const counts: Counts = {};
  const count = (table: string, read: number, inserted: number) => {
    const c = (counts[table] ??= { read: 0, inserted: 0 });
    c.read += read;
    c.inserted += inserted;
  };

  console.log(`Importing ${file}${dryRun ? ' (dry run)' : ''}`);

  try {
    await db.transaction(async (tx) => {
      const s = schema;

      /* organisations, from the free-text organization field */
      const orgNames = [
        ...new Set(data.users.map((u) => (u.organization ?? u.institution)?.trim()).filter(Boolean)),
      ] as string[];
      const orgIdByName = new Map<string, string>();
      if (orgNames.length) {
        const existing = await tx
          .select({ id: s.organizations.id, name: s.organizations.name })
          .from(s.organizations)
          .where(inArray(s.organizations.name, orgNames));
        existing.forEach((o) => orgIdByName.set(o.name, o.id));
        const missing = orgNames.filter((n) => !orgIdByName.has(n));
        if (missing.length) {
          const rows = await tx
            .insert(s.organizations)
            .values(missing.map((name) => ({ name, status: 'active' as const })))
            .returning({ id: s.organizations.id, name: s.organizations.name });
          rows.forEach((o) => orgIdByName.set(o.name, o.id));
        }
        count('organizations', orgNames.length, missing.length);
      }

      /* users: no password hash, so each must use password reset */
      if (data.users.length) {
        const inserted = await tx
          .insert(s.users)
          .values(
            data.users.map((u) => ({
              legacyId: u.id,
              email: u.email.trim().toLowerCase(),
              name: u.name || u.email.split('@')[0] || 'User',
              persona: u.role,
              role: 'researcher' as const,
              orgId: orgIdByName.get((u.organization ?? u.institution ?? '').trim()) ?? null,
              region: u.region ?? null,
              researchInterests: u.researchInterests,
              collaborationInterests: u.collaborationInterests,
              qualifications: u.qualifications ?? null,
              fundingNeedsMin: u.fundingNeedsMin ?? null,
              pastProjects: u.pastProjects ?? null,
              teamMembers: u.teamMembers ?? null,
              pastPublications: u.pastPublications ?? null,
              projectDescriptions: u.projectDescriptions ?? null,
              isPublicProfile: u.isPublicProfile,
              passwordHash: null,
              emailVerifiedAt: new Date(),
            })),
          )
          .onConflictDoNothing()
          .returning({ id: s.users.id });
        count('users', data.users.length, inserted.length);
      }
      const userIds = new Map(
        (
          await tx
            .select({ id: s.users.id, legacyId: s.users.legacyId, orgId: s.users.orgId })
            .from(s.users)
        )
          .filter((u) => u.legacyId)
          .map((u) => [u.legacyId!, u]),
      );

      /* funders */
      if (data.funders.length) {
        const inserted = await tx
          .insert(s.funders)
          .values(
            data.funders.map((f) => ({ slug: f.id, name: f.name, type: f.type, website: f.website ?? null })),
          )
          .onConflictDoNothing()
          .returning({ id: s.funders.id });
        count('funders', data.funders.length, inserted.length);
      }
      const funderIds = new Map(
        (await tx.select({ id: s.funders.id, slug: s.funders.slug }).from(s.funders)).map((f) => [f.slug, f.id]),
      );

      /* grants: url must be unique, so duplicates and blanks get a stable stand-in */
      const seenUrls = new Set<string>();
      const grantValues = data.grants.map((g) => {
        let url = g.url.trim() || `urn:grantseeker:legacy:${g.id}`;
        if (seenUrls.has(url)) url = `${url}#legacy-${g.id}`;
        seenUrls.add(url);
        return {
          legacyId: g.id,
          funderId: (g.funderId && funderIds.get(g.funderId)) || null,
          title: g.title,
          subject: g.subject ?? null,
          category: g.category ?? null,
          description: g.description,
          objectives: g.objectives ?? null,
          requiredOutcomes: g.requiredOutcomes ?? null,
          scope: g.scope ?? null,
          amount: g.fundingAmount ?? null,
          deadline: g.deadline ?? null,
          eligibleRegions: g.eligibleRegions,
          eligibleOrgTypes: g.eligibleOrgTypes,
          status: g.status,
          source: g.source ?? null,
          url,
          keywords: g.extractedKeywords,
        };
      });
      if (grantValues.length) {
        const inserted = await tx
          .insert(s.grants)
          .values(grantValues)
          .onConflictDoNothing()
          .returning({ id: s.grants.id });
        count('grants', grantValues.length, inserted.length);
      }
      const grantIds = new Map(
        (await tx.select({ id: s.grants.id, legacyId: s.grants.legacyId }).from(s.grants))
          .filter((g) => g.legacyId)
          .map((g) => [g.legacyId!, g.id]),
      );

      /* matches */
      const matchValues = data.matches.flatMap((m) => {
        const userId = userIds.get(m.userId)?.id;
        const grantId = grantIds.get(m.grantId);
        if (!userId || !grantId) return [];
        return [
          {
            userId,
            grantId,
            score: Math.max(0, Math.min(100, Math.round(m.matchScore))),
            rationale: m.rationale ?? null,
            breakdown: m.relevanceBreakdown ?? null,
            model: m.isGemini ? 'gemini (legacy import)' : null,
            feedback: m.feedback ?? null,
          },
        ];
      });
      if (data.matches.length) {
        const inserted = matchValues.length
          ? await tx.insert(s.grantMatches).values(matchValues).onConflictDoNothing().returning({ userId: s.grantMatches.userId })
          : [];
        count('grant_matches', data.matches.length, inserted.length);
      }

      /* notifications: no natural key, so only for users created just now
         would re-running double them; skip users that already had any */
      const notifValues = data.notifications.flatMap((n) => {
        const userId = userIds.get(n.userId)?.id;
        if (!userId) return [];
        return [
          {
            userId,
            type: n.type,
            title: n.title,
            message: n.message,
            grantId: (n.grantId && grantIds.get(n.grantId)) || null,
            readAt: n.read ? new Date() : null,
            createdAt: toDate(n.date) ?? new Date(),
          },
        ];
      });
      if (notifValues.length) {
        const already = new Set(
          (
            await tx
              .select({ userId: s.notifications.userId })
              .from(s.notifications)
              .where(inArray(s.notifications.userId, [...new Set(notifValues.map((n) => n.userId))]))
          ).map((r) => r.userId),
        );
        const fresh = notifValues.filter((n) => !already.has(n.userId));
        if (fresh.length) await tx.insert(s.notifications).values(fresh);
        count('notifications', data.notifications.length, fresh.length);
      }

      /* applications -> proposals (+ events, + one-line budget) */
      for (const a of data.applications) {
        const owner = userIds.get(a.userId);
        if (!owner) {
          count('proposals', 1, 0);
          continue;
        }
        const [proposal] = await tx
          .insert(s.proposals)
          .values({
            legacyId: a.id,
            ownerId: owner.id,
            orgId: owner.orgId,
            grantId: (a.grantId && grantIds.get(a.grantId)) || null,
            title: a.grantTitle || 'Untitled proposal',
            status: a.status,
            notes: a.notes ?? null,
            requestedAmount: a.amount ?? null,
            deadline: a.deadline ?? null,
            submittedAt: toDate(a.submittedDate) ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: s.proposals.id });
        count('proposals', 1, proposal ? 1 : 0);
        if (!proposal) continue; // imported on an earlier run

        let from: (typeof a.history)[number]['status'] | null = null;
        for (const h of a.history) {
          await tx.insert(s.proposalEvents).values({
            proposalId: proposal.id,
            actorId: owner.id,
            fromStatus: from,
            toStatus: h.status,
            comment: h.notes ?? null,
            createdAt: toDate(h.timestamp) ?? new Date(),
          });
          from = h.status;
        }
        count('proposal_events', a.history.length, a.history.length);

        if (a.amount) {
          const [budget] = await tx
            .insert(s.budgets)
            .values({ proposalId: proposal.id, orgId: owner.orgId })
            .returning({ id: s.budgets.id });
          await tx.insert(s.budgetLines).values({
            budgetId: budget!.id,
            category: 'other',
            description: 'Total requested (imported)',
            amount: a.amount,
          });
          count('budgets', 1, 1);
        }
      }

      /* scraper logs -> runs, keyed by (source, started_at) */
      for (const l of data.scraperLogs) {
        const startedAt = toDate(l.timestamp) ?? new Date();
        const source = l.source ?? null;
        const [existing] = await tx
          .select({ id: s.scraperRuns.id })
          .from(s.scraperRuns)
          .where(and(eq(s.scraperRuns.startedAt, startedAt), source ? eq(s.scraperRuns.source, source) : undefined));
        if (!existing) {
          await tx.insert(s.scraperRuns).values({
            trigger: 'manual',
            source,
            status: l.status === 'success' ? 'ok' : 'failed',
            itemsFound: Math.round(l.itemsExtracted),
            itemsNew: Math.round(l.itemsExtracted),
            error: l.status === 'failed' ? (l.message ?? null) : null,
            startedAt,
            finishedAt: startedAt,
          });
        }
        count('scraper_runs', 1, existing ? 0 : 1);
      }

      /* consortia -> teams, members, messages, shared grants */
      const teamIds = new Map<string, string>();
      for (const c of data.consortia) {
        const owner = userIds.get(c.creatorId);
        if (!owner) {
          count('teams', 1, 0);
          continue;
        }
        const [team] = await tx
          .insert(s.teams)
          .values({
            legacyId: c.id,
            name: c.name || 'Team',
            description: c.description ?? null,
            ownerId: owner.id,
            isPrivate: c.isPrivate,
          })
          .onConflictDoNothing()
          .returning({ id: s.teams.id });
        count('teams', 1, team ? 1 : 0);
        if (!team) continue;
        teamIds.set(c.id, team.id);

        const memberIds = [...new Set([c.creatorId, ...c.memberIds])]
          .map((id) => userIds.get(id)?.id)
          .filter((id): id is string => Boolean(id));
        await tx
          .insert(s.teamMembers)
          .values(
            memberIds.map((userId) => ({
              teamId: team.id,
              userId,
              role: userId === owner.id ? ('lead' as const) : ('member' as const),
            })),
          )
          .onConflictDoNothing();
        count('team_members', memberIds.length, memberIds.length);
      }
      const messages = data.teamMessages.flatMap((m) => {
        const teamId = teamIds.get(m.teamId);
        if (!teamId) return [];
        return [
          {
            teamId,
            authorId: userIds.get(m.senderId)?.id ?? null,
            body: m.content,
            createdAt: toDate(m.timestamp) ?? new Date(),
          },
        ];
      });
      if (messages.length) await tx.insert(s.teamMessages).values(messages);
      if (data.teamMessages.length) count('team_messages', data.teamMessages.length, messages.length);

      const shared = data.teamSharedGrants.flatMap((g) => {
        const teamId = teamIds.get(g.teamId);
        const grantId = grantIds.get(g.grantId);
        if (!teamId || !grantId) return [];
        return [
          {
            teamId,
            grantId,
            sharedBy: (g.sharedById && userIds.get(g.sharedById)?.id) || null,
            notes: g.notes ?? null,
            status: g.status,
          },
        ];
      });
      if (shared.length) await tx.insert(s.teamGrants).values(shared).onConflictDoNothing();
      if (data.teamSharedGrants.length) count('team_grants', data.teamSharedGrants.length, shared.length);

      await tx.insert(s.auditLog).values({
        action: 'system.import_json',
        entity: 'file',
        entityId: path.basename(file),
        diff: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.inserted])),
      });

      if (dryRun) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  console.table(counts);
  if (dryRun) console.log('Dry run: rolled back, nothing written.');
  if (data.users.length) {
    console.log(
      'Imported users have no password. They must use password reset before they can log in.',
    );
  }
}

/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await migrateSchema(pool);
    if (args.importJson) await importJson(pool, path.resolve(args.importJson), args.dryRun);
    console.log('Done.');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
