import { and, desc, eq, gte, inArray, ne, or, isNull, sql } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import type { ApplicantType, Eligibility, FitResult, StructuredProfile } from '../../shared/profile.ts';
import * as schema from '../db/schema.ts';
import { applicantProfiles, funders, grantMatches, grants, users } from '../db/schema.ts';
import { FIT_VERSION, legacyBreakdown, scoreFit } from './fitScoring.ts';
import { extractProfile, type FormInputs } from './profileExtraction.ts';

// Scores one user's profile against active grants and stores the result in
// grant_matches. Shared by the API (on upload, edit, rescore) and the
// harvest worker (new grants), so both always rank the same way.

/** The API's transactions and the worker's pool both fit. */
export type AnyDb = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/** Grants scored in one full rescore: scoring is cheap, but bounded. */
export const MAX_SCORED_GRANTS = 1_000;
const UPSERT_CHUNK = 200;

type FormRow = Pick<
  typeof users.$inferSelect,
  'persona' | 'region' | 'researchInterests' | 'qualifications' | 'pastProjects' | 'pastPublications' | 'projectDescriptions'
>;

export const formInputsOf = (u: FormRow, organization: string | null, applicantType: ApplicantType | null): FormInputs => ({
  applicantType,
  persona: u.persona,
  region: u.region,
  organization,
  researchInterests: u.researchInterests,
  qualifications: u.qualifications,
  pastProjects: u.pastProjects,
  pastPublications: u.pastPublications,
  projectDescriptions: u.projectDescriptions,
});

/**
 * The stored structured profile, or for users who never opened the
 * profile page, one read from their sign-up form alone.
 */
export async function loadStructuredProfile(db: AnyDb, userId: string): Promise<StructuredProfile | null> {
  const [stored] = await db.select({ data: applicantProfiles.data }).from(applicantProfiles).where(eq(applicantProfiles.userId, userId));
  if (stored) return stored.data;
  const [u] = await db
    .select({
      persona: users.persona,
      region: users.region,
      researchInterests: users.researchInterests,
      qualifications: users.qualifications,
      pastProjects: users.pastProjects,
      pastPublications: users.pastPublications,
      projectDescriptions: users.projectDescriptions,
    })
    .from(users)
    .where(eq(users.id, userId));
  return u ? extractProfile(formInputsOf(u, null, null), []) : null;
}

export interface ScoredMatch {
  grantId: string;
  title: string;
  funderName: string | null;
  deadline: string | null;
  fit: FitResult;
  /** No match row existed before this run. */
  isNew: boolean;
}

/**
 * Scores the user against active grants (all of them, nearest first, or
 * just `grantIds`) and upserts the matches. Feedback stays: it is never in
 * the update set.
 */
export async function scoreUserMatches(
  db: AnyDb,
  userId: string,
  opts: { grantIds?: string[]; profile?: StructuredProfile; now?: Date } = {},
): Promise<ScoredMatch[]> {
  if (opts.grantIds && opts.grantIds.length === 0) return [];
  const profile = opts.profile ?? (await loadStructuredProfile(db, userId));
  if (!profile) return [];

  const similarity = sql<number | null>`1 - (${grants.embedding} <=> (select ${users.profileEmbedding} from ${users} where ${users.id} = ${userId}))`;
  const candidates = await db
    .select({
      id: grants.id,
      title: grants.title,
      description: grants.description,
      objectives: grants.objectives,
      scope: grants.scope,
      amount: grants.amount,
      currency: grants.currency,
      deadline: grants.deadline,
      eligibleRegions: grants.eligibleRegions,
      eligibleOrgTypes: grants.eligibleOrgTypes,
      keywords: grants.keywords,
      funderName: funders.name,
      similarity,
    })
    .from(grants)
    .leftJoin(funders, eq(funders.id, grants.funderId))
    .where(and(eq(grants.status, 'active'), opts.grantIds ? inArray(grants.id, opts.grantIds) : undefined))
    .orderBy(sql`${similarity} desc nulls last`, sql`${grants.deadline} asc nulls last`)
    .limit(MAX_SCORED_GRANTS);
  if (candidates.length === 0) return [];

  const prior = await db
    .select({ grantId: grantMatches.grantId })
    .from(grantMatches)
    .where(and(eq(grantMatches.userId, userId), inArray(grantMatches.grantId, candidates.map((c) => c.id))));
  const had = new Set(prior.map((p) => p.grantId));

  const now = opts.now ?? new Date();
  const scored = candidates.map((g) => ({ g, fit: scoreFit(profile, g, { similarity: g.similarity, now }) }));

  for (let i = 0; i < scored.length; i += UPSERT_CHUNK) {
    const chunk = scored.slice(i, i + UPSERT_CHUNK);
    await db
      .insert(grantMatches)
      .values(
        chunk.map(({ g, fit }) => ({
          userId,
          grantId: g.id,
          score: fit.score,
          rationale: fit.explanation,
          breakdown: legacyBreakdown(fit),
          fit,
          eligibility: fit.eligibility,
          similarity: g.similarity,
          model: FIT_VERSION,
          computedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [grantMatches.userId, grantMatches.grantId],
        set: {
          score: sql`excluded.score`,
          rationale: sql`excluded.rationale`,
          breakdown: sql`excluded.breakdown`,
          fit: sql`excluded.fit`,
          eligibility: sql`excluded.eligibility`,
          similarity: sql`excluded.similarity`,
          model: sql`excluded.model`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }

  return scored.map(({ g, fit }) => ({ grantId: g.id, title: g.title, funderName: g.funderName, deadline: g.deadline, fit, isNew: !had.has(g.id) }));
}

/**
 * Brings the user's matches up to date (grants never scored, or scored by
 * an older version of the scorer) and returns them ranked, highest first.
 */
export async function rankedMatches(
  db: AnyDb,
  userId: string,
  opts: { limit: number; minScore?: number; includeIneligible?: boolean },
) {
  const stale = await db
    .select({ id: grants.id })
    .from(grants)
    .leftJoin(grantMatches, and(eq(grantMatches.grantId, grants.id), eq(grantMatches.userId, userId)))
    .where(and(eq(grants.status, 'active'), or(isNull(grantMatches.grantId), isNull(grantMatches.model), ne(grantMatches.model, FIT_VERSION))))
    .limit(MAX_SCORED_GRANTS);
  if (stale.length) await scoreUserMatches(db, userId, { grantIds: stale.map((s) => s.id) });

  return db
    .select({ match: grantMatches, grantId: grants.id })
    .from(grantMatches)
    .innerJoin(grants, eq(grants.id, grantMatches.grantId))
    .where(
      and(
        eq(grantMatches.userId, userId),
        eq(grants.status, 'active'),
        gte(grantMatches.score, opts.minScore ?? 0),
        opts.includeIneligible ? undefined : ne(grantMatches.eligibility, 'ineligible' satisfies Eligibility),
      ),
    )
    .orderBy(
      // Best fit first; ineligible ones, when shown, after all the others.
      sql`(${grantMatches.eligibility} = 'ineligible') asc`,
      desc(grantMatches.score),
    )
    .limit(opts.limit);
}
