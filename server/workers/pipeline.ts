import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import * as schema from '../db/schema.ts';
import type { StructuredProfile } from '../../shared/profile.ts';
import { applicantProfiles, auditLog, funders, grants, notifications, scraperRuns, users } from '../db/schema.ts';
import { scoreUserMatches } from '../lib/matchService.ts';
import {
  funderSource,
  HarvestedGrantSchema,
  listSource,
  sha256,
  type AdapterContext,
  type Listing,
  type Source,
} from './sources.ts';

// One harvest run, steps 02–10 of the blueprint. Every outside effect
// (database, embeddings, AI scoring, HTTP) comes in through PipelineDeps,
// so tests can run it against fixtures and deterministic fake vectors.

export type WorkerDb = NodePgDatabase<typeof schema>;

export interface PipelineSettings {
  /** Notify when a new, not-ineligible match scores at least this. */
  notifyThreshold: number;
  maxNotificationsPerUser: number;
  /** Detail fetches running at once, per source. */
  loadConcurrency: number;
}

export const DEFAULT_SETTINGS: PipelineSettings = {
  notifyThreshold: 80,
  maxNotificationsPerUser: 5,
  loadConcurrency: 4,
};

export interface PipelineDeps {
  db: WorkerDb;
  /** A dedicated connection holds the run lock for the whole run. */
  pool: pg.Pool;
  sources: Source[];
  adapter: AdapterContext;
  /** null: embeddings are not configured; thematic fit uses themes and keywords only. */
  embedDocuments: (texts: string[]) => Promise<number[][] | null>;
  embedProfiles: (texts: string[]) => Promise<number[][] | null>;
  settings: PipelineSettings;
  log: (msg: string) => void;
}

export interface RunRequest {
  trigger: 'cron' | 'manual';
  /** Source id or part of its label; all sources when absent. */
  source?: string | null;
  requestedBy?: string | null;
}

export interface RunResult {
  runId: string;
  status: 'ok' | 'partial' | 'failed';
  sources: number;
  itemsFound: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsInvalid: number;
  grantsEmbedded: number;
  profilesEmbedded: number;
  matchesScored: number;
  notificationsSent: number;
  errors: string[];
}

/** Session-level advisory lock: one harvest at a time across all replicas. */
const LOCK_SQL = "select pg_try_advisory_lock(hashtext('grantseeker.harvest')) as locked";
const UNLOCK_SQL = "select pg_advisory_unlock(hashtext('grantseeker.harvest'))";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * A short, safe description of an error for logs and the run record.
 * Drizzle's query errors embed every bound parameter (vectors, profile
 * text); only the database's own message is kept.
 */
export function errorText(err: unknown): string {
  const e = err as { cause?: { message?: string }; message?: string; issues?: { path: PropertyKey[]; message: string }[] };
  const issue = e?.issues?.[0];
  const msg = issue ? `${issue.path.join('.')}: ${issue.message}` : e?.cause?.message ?? e?.message ?? String(err);
  return msg.split('\n')[0]!.slice(0, 300);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Compares funder names as agencies write them: "U.S. National Science
 * Foundation" and "National Science Foundation (NSF)" are the same funder.
 */
export const funderKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*(the\s+)?(u\.?\s?s\.?|united states)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const grantEmbeddingText = (g: { title: string; subject: string | null; keywords: string[]; description: string }) =>
  [g.title, g.subject ?? '', g.keywords.join(', '), g.description].filter(Boolean).join('\n').slice(0, 8_000);

export const profileEmbeddingText = (u: {
  persona: string;
  researchInterests: string[];
  qualifications: string | null;
  pastProjects: string | null;
  pastPublications: string | null;
  projectDescriptions: string | null;
  structured?: StructuredProfile | null;
}) =>
  [
    `Applicant type: ${u.structured?.applicantType.value ?? u.persona}`,
    `Research interests: ${u.researchInterests.join(', ')}`,
    // What the documents say: themes, keywords, funded work, publications.
    u.structured?.themes.value.length ? `Themes: ${u.structured.themes.value.join(', ')}` : null,
    u.structured?.keywords.value.length ? `Keywords: ${u.structured.keywords.value.join(', ')}` : null,
    ...(u.structured?.pastGrants.value.slice(0, 10).map((g) => g.evidence.quote) ?? []),
    ...(u.structured?.publications.value.slice(0, 15).map((p) => p.title) ?? []),
    u.qualifications,
    u.projectDescriptions,
    u.pastProjects,
    u.pastPublications,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8_000);

const profileColumns = {
  id: users.id,
  persona: users.persona,
  region: users.region,
  researchInterests: users.researchInterests,
  qualifications: users.qualifications,
  pastProjects: users.pastProjects,
  pastPublications: users.pastPublications,
  projectDescriptions: users.projectDescriptions,
  fundingNeedsMin: users.fundingNeedsMin,
  structured: applicantProfiles.data,
};

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

/** Runs one harvest, or returns null when another run holds the lock. */
export async function runHarvest(deps: PipelineDeps, req: RunRequest): Promise<RunResult | null> {
  const lockClient = await deps.pool.connect();
  try {
    const { rows } = await lockClient.query<{ locked: boolean }>(LOCK_SQL);
    if (!rows[0]?.locked) {
      deps.log('another harvest is running; this request is skipped');
      return null;
    }
    try {
      return await harvest(deps, req);
    } finally {
      await lockClient.query(UNLOCK_SQL).catch(() => {});
    }
  } finally {
    lockClient.release();
  }
}

async function harvest(deps: PipelineDeps, req: RunRequest): Promise<RunResult> {
  const { db, log } = deps;
  const [run] = await db
    .insert(scraperRuns)
    .values({ trigger: req.trigger, source: req.source ?? 'all', status: 'running' })
    .returning({ id: scraperRuns.id });
  const result: RunResult = {
    runId: run!.id,
    status: 'ok',
    sources: 0,
    itemsFound: 0,
    itemsNew: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsInvalid: 0,
    grantsEmbedded: 0,
    profilesEmbedded: 0,
    matchesScored: 0,
    notificationsSent: 0,
    errors: [],
  };
  log(`run ${result.runId} started (${req.trigger}${req.source ? `, source ${req.source}` : ''})`);

  let sourcesOk = 0;
  try {
    /* 03–07. Harvest ------------------------------------------------- */
    const funderRows = await db
      .select({ id: funders.id, slug: funders.slug, name: funders.name, scrapeConfig: funders.scrapeConfig })
      .from(funders);
    const funderIdByName = new Map<string, string>();
    for (const f of funderRows) funderIdByName.set(funderKey(f.name), f.id);

    let sources = [...deps.sources, ...funderRows.map(funderSource).filter((s): s is Source => s !== null)];
    if (req.source) {
      const want = req.source.toLowerCase();
      sources = sources.filter((s) => s.id === want || s.label.toLowerCase().includes(want));
      if (sources.length === 0) throw new Error(`No source matches "${req.source}"`);
    }
    result.sources = sources.length;

    const changedGrantIds = new Set<string>();
    for (const source of sources) {
      try {
        const counts = await harvestSource(deps, source, funderIdByName, changedGrantIds);
        result.itemsFound += counts.found;
        result.itemsNew += counts.created;
        result.itemsUpdated += counts.updated;
        result.itemsUnchanged += counts.unchanged;
        result.itemsInvalid += counts.invalid;
        if (counts.firstInvalid) result.errors.push(`${source.id}: skipped invalid item (${counts.firstInvalid})`);
        sourcesOk++;
        log(`${source.id}: ${counts.found} listed, ${counts.created} new, ${counts.updated} updated, ${counts.unchanged} unchanged`);
      } catch (err) {
        result.errors.push(`${source.id}: ${errorText(err)}`);
        log(`${source.id}: failed: ${errorText(err)}`);
      }
    }

    // Calls whose deadline has passed stop showing as open right away.
    await db
      .update(grants)
      .set({ status: 'closed' })
      .where(and(eq(grants.status, 'active'), sql`${grants.deadline} < current_date`));

    /* 06. Embeddings ------------------------------------------------- */
    let embeddingErrors = 0;
    try {
      result.grantsEmbedded = await embedGrants(deps);
    } catch (err) {
      embeddingErrors++;
      result.errors.push(`grant embeddings: ${errorText(err)}`);
    }
    let reembeddedUsers = new Set<string>();
    try {
      reembeddedUsers = await embedProfiles(deps);
    } catch (err) {
      embeddingErrors++;
      result.errors.push(`profile embeddings: ${errorText(err)}`);
    }
    result.profilesEmbedded = reembeddedUsers.size;

    /* 08–10. Match and notify ---------------------------------------- */
    const m = await matchUsers(deps, [...changedGrantIds], reembeddedUsers);
    result.matchesScored = m.scored;
    result.notificationsSent = m.notified;
    result.errors.push(...m.errors);

    const clean = sourcesOk === sources.length && m.errors.length === 0 && embeddingErrors === 0;
    result.status = clean ? 'ok' : sourcesOk === 0 ? 'failed' : 'partial';
  } catch (err) {
    result.status = 'failed';
    result.errors.push(errorText(err));
    log(`run ${result.runId} failed: ${errorText(err)}`);
  }

  await db
    .update(scraperRuns)
    .set({
      status: result.status,
      itemsFound: result.itemsFound,
      itemsNew: result.itemsNew,
      error: result.errors.length ? result.errors.join('\n').slice(0, 4_000) : null,
      finishedAt: new Date(),
    })
    .where(eq(scraperRuns.id, result.runId));

  const { errors: _errors, runId: _runId, ...summary } = result;
  await db.insert(auditLog).values({
    action: 'scraper.run',
    entity: 'scraper_run',
    entityId: result.runId,
    actorId: req.requestedBy ?? null,
    diff: { ...summary, trigger: req.trigger, source: req.source ?? null, errorCount: result.errors.length },
  });

  log(`run ${result.runId} ${result.status}: ${JSON.stringify(summary)}`);
  return result;
}

/* ------------------------------------------------------------------ */
/* Harvest one source                                                  */
/* ------------------------------------------------------------------ */

async function harvestSource(
  deps: PipelineDeps,
  source: Source,
  funderIdByName: Map<string, string>,
  changed: Set<string>,
) {
  const { db } = deps;
  const listings = dedupeByUrl(await listSource(source, deps.adapter));
  const counts = { found: listings.length, created: 0, updated: 0, unchanged: 0, invalid: 0, firstInvalid: '' };
  if (listings.length === 0) return counts;

  const known = await db
    .select({ url: grants.url, contentHash: grants.contentHash })
    .from(grants)
    .where(inArray(grants.url, listings.map((l) => l.url)));
  const hashByUrl = new Map(known.map((k) => [k.url, k.contentHash]));

  const todo = listings.filter((l) => {
    const prev = hashByUrl.get(l.url);
    if (prev && prev.equals(sha256(l.fingerprint))) {
      counts.unchanged++;
      return false;
    }
    return true;
  });

  await mapLimit(todo, deps.settings.loadConcurrency, async (listing) => {
    let raw: unknown;
    try {
      raw = await listing.load();
    } catch (err) {
      counts.invalid++;
      counts.firstInvalid ||= `${listing.url}: ${errorText(err)}`;
      return;
    }
    const parsed = HarvestedGrantSchema.safeParse({ ...(raw as object), url: listing.url });
    if (!parsed.success) {
      counts.invalid++;
      counts.firstInvalid ||= `${listing.url}: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`;
      return;
    }
    const g = parsed.data;
    const funderId =
      source.funderId ?? (g.funderName ? funderIdByName.get(funderKey(g.funderName)) ?? null : null);
    const values = {
      title: g.title,
      description: g.description,
      // Sources rarely state a subject line; the leading keywords stand in.
      subject: g.keywords.slice(0, 3).join(', ') || null,
      category: g.category,
      amount: g.amount,
      currency: g.currency.toUpperCase(),
      deadline: g.deadline,
      eligibleRegions: g.eligibleRegions,
      eligibleOrgTypes: g.eligibleOrgTypes,
      keywords: g.keywords,
      funderId,
      source: source.label,
      status: g.deadline && g.deadline < today() ? ('closed' as const) : ('active' as const),
      contentHash: sha256(listing.fingerprint),
      scrapedAt: new Date(),
    };
    const [row] = await db
      .insert(grants)
      .values({ url: listing.url, ...values })
      // Changed text: drop the old embedding so step 06 recomputes it.
      .onConflictDoUpdate({ target: grants.url, set: { ...values, embedding: null } })
      .returning({ id: grants.id, inserted: sql<boolean>`(xmax = 0)` });
    if (!row) return;
    changed.add(row.id);
    if (row.inserted) counts.created++;
    else counts.updated++;
  });
  return counts;
}

function dedupeByUrl(listings: Listing[]): Listing[] {
  const seen = new Set<string>();
  return listings.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

/* ------------------------------------------------------------------ */
/* Embeddings                                                          */
/* ------------------------------------------------------------------ */

const EMBED_BATCH = 100;
const EMBED_BATCHES_PER_RUN = 10;

async function embedGrants(deps: PipelineDeps): Promise<number> {
  const { db } = deps;
  let total = 0;
  for (let i = 0; i < EMBED_BATCHES_PER_RUN; i++) {
    const batch = await db
      .select({ id: grants.id, title: grants.title, subject: grants.subject, keywords: grants.keywords, description: grants.description })
      .from(grants)
      .where(and(isNull(grants.embedding), eq(grants.status, 'active')))
      .orderBy(asc(grants.createdAt))
      .limit(EMBED_BATCH);
    if (batch.length === 0) break;
    const vectors = await deps.embedDocuments(batch.map(grantEmbeddingText));
    if (!vectors) break; // not configured
    for (const [j, g] of batch.entries()) {
      await db.update(grants).set({ embedding: vectors[j]! }).where(eq(grants.id, g.id));
    }
    total += batch.length;
    if (batch.length < EMBED_BATCH) break;
  }
  return total;
}

/**
 * Embeds profiles that have none (new users, or cleared by a profile edit).
 * Returns the ids embedded in this run; those users get a full rematch.
 */
async function embedProfiles(deps: PipelineDeps): Promise<Set<string>> {
  const { db } = deps;
  const done = new Set<string>();
  for (let i = 0; i < EMBED_BATCHES_PER_RUN; i++) {
    const batch = await db
      .select(profileColumns)
      .from(users)
      .leftJoin(applicantProfiles, eq(applicantProfiles.userId, users.id))
      .where(and(isNull(users.profileEmbedding), isNull(users.suspendedAt), isNotNull(users.emailVerifiedAt)))
      .limit(EMBED_BATCH);
    const pending = batch.filter((u) => !done.has(u.id));
    if (pending.length === 0) break;
    const vectors = await deps.embedProfiles(pending.map(profileEmbeddingText));
    // Embeddings not configured: such profiles never get a vector, so they
    // would look "changed" on every run. Their matches are kept fresh
    // without a rematch here: a profile edit clears the unrated ones and
    // the API's match feed rescores them on demand.
    if (!vectors) break;
    for (const [j, u] of pending.entries()) {
      await db.execute(sql`update ${users} set profile_embedding = ${JSON.stringify(vectors[j]!)}::vector where ${users.id} = ${u.id}`);
      done.add(u.id);
    }
    if (batch.length < EMBED_BATCH) break;
  }
  return done;
}

/* ------------------------------------------------------------------ */
/* Matching and notifications                                         */
/* ------------------------------------------------------------------ */

/**
 * Scores every active user against the grants that changed in this run,
 * or against all open grants when their profile was just re-embedded.
 * Same scorer as the API (lib/matchService.ts), so a notification and the
 * match list always agree.
 */
async function matchUsers(deps: PipelineDeps, changedGrantIds: string[], rematch: Set<string>) {
  const { db, settings } = deps;
  const out = { scored: 0, notified: 0, errors: [] as string[] };

  const audience = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNull(users.suspendedAt), isNotNull(users.emailVerifiedAt)));

  for (const user of audience) {
    const full = rematch.has(user.id);
    if (!full && changedGrantIds.length === 0) continue;
    try {
      const scored = await scoreUserMatches(db, user.id, full ? {} : { grantIds: changedGrantIds });
      out.scored += scored.length;

      const alerts = scored
        .filter((m) => m.isNew && m.fit.eligibility !== 'ineligible' && m.fit.score >= settings.notifyThreshold)
        .sort((a, b) => b.fit.score - a.fit.score)
        .slice(0, settings.maxNotificationsPerUser);
      for (const m of alerts) {
        await db.insert(notifications).values({
          userId: user.id,
          type: 'match_alert',
          title: `New ${m.fit.score}% match: ${m.funderName ?? 'funding call'}`,
          message: `"${m.title}" matches your profile${m.deadline ? `; deadline ${m.deadline}` : ''}.`,
          grantId: m.grantId,
          link: `/grants/${m.grantId}`,
        });
        out.notified++;
      }
    } catch (err) {
      out.errors.push(`matching for user ${user.id}: ${errorText(err)}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Housekeeping (daily)                                                */
/* ------------------------------------------------------------------ */

export async function housekeeping(deps: Pick<PipelineDeps, 'db' | 'log'>) {
  const closed = await deps.db
    .update(grants)
    .set({ status: 'closed' })
    .where(and(eq(grants.status, 'active'), sql`${grants.deadline} < current_date`))
    .returning({ id: grants.id });
  const { rows } = await deps.db.execute<{ n: number }>(sql`select app.purge_expired_refresh_tokens() as n`);
  const purged = rows[0]?.n ?? 0;
  await deps.db.insert(auditLog).values({
    action: 'system.housekeeping',
    entity: 'system',
    diff: { grantsClosed: closed.length, refreshTokensPurged: purged },
  });
  deps.log(`housekeeping: ${closed.length} grants closed, ${purged} expired refresh tokens purged`);
  return { grantsClosed: closed.length, refreshTokensPurged: purged };
}

