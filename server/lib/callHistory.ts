/**
 * Call history: every edition of a recurring call, oldest first, with what
 * changed from one edition to the next.
 *
 * Editions come from two places:
 *   - other grants in the same series (same funder or source, same title
 *     once years, fiscal years and round numbers are stripped; see
 *     grants.series_key);
 *   - grant_revisions: earlier content of a call whose funder reused the
 *     same page for a new cycle.
 * Listings with the same title and deadline are one edition published
 * twice; they are folded together.
 */
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';

import type { Tx } from '../db/index.ts';
import { funders, grantRevisions, grants, type GrantSnapshot } from '../db/schema.ts';
import { grantRowColumns, inCatalogue, type GrantLifecycle, type GrantRow } from './grantQueries.ts';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Edition = {
  key: string;
  grantId: string;
  kind: 'listing' | 'revision';
  title: string;
  funderName: string | null;
  description: string;
  objectives: string | null;
  requiredOutcomes: string | null;
  scope: string | null;
  category: string | null;
  amount: number | null;
  currency: string;
  deadline: string | null;
  eligibleRegions: string[];
  eligibleOrgTypes: string[];
  keywords: string[];
  /** A revision is a version the funder has since replaced. */
  lifecycle: GrantLifecycle | 'superseded';
  url: string;
  /** Funder reference numbers, e.g. GR-RCE-26-001. */
  referenceCodes: string[];
  /** When a revision was captured; when a listing was first seen. */
  seenAt: string | null;
  isCurrent: boolean;
  /** Other listings of this same edition (same title and deadline). */
  duplicateIds: string[];
};

export type EditionDto = Omit<Edition, 'description' | 'objectives' | 'requiredOutcomes' | 'scope' | 'keywords'>;

export type FieldChange =
  | { field: string; label: string; kind: 'value'; before: string | null; after: string | null }
  | { field: string; label: string; kind: 'list'; added: string[]; removed: string[] }
  | {
      field: string;
      label: string;
      kind: 'text';
      similarity: number;
      before: string | null;
      after: string | null;
      addedTerms: string[];
      removedTerms: string[];
    };

export type Comparison = { from: string; to: string; highlights: string[]; changes: FieldChange[] };

export type CallHistory = {
  current: string;
  editions: EditionDto[];
  comparisons: Comparison[];
};

/* ------------------------------------------------------------------ */
/* Reference codes                                                     */
/* ------------------------------------------------------------------ */

/** Funder reference numbers ride along in keywords: upper-case, with a digit and a hyphen. */
export const isReferenceCode = (k: string) => /\d/.test(k) && /-/.test(k) && k === k.toUpperCase() && /[A-Z]/.test(k);

/** A code with its numbers blanked: GR-RCE-25-001 and GR-RCE-26-001 share GR-RCE-#-#. */
const codeFamily = (code: string) => code.toUpperCase().replace(/\s+/g, '').replace(/\d+/g, '#');
const familyLetters = (family: string) => family.replace(/[^A-Z]/g, '').length;

const splitKeywords = (keywords: string[]) => ({
  codes: keywords.filter(isReferenceCode),
  topics: keywords.filter((k) => !isReferenceCode(k)),
});

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

// A title shorter than this after normalisation ("research grant") is too
// generic to join a series on.
const MIN_SERIES_TITLE = 12;

function fromListing(g: GrantRow, currentId: string): Edition {
  return {
    key: g.id,
    grantId: g.id,
    kind: 'listing',
    title: g.title,
    funderName: g.funderName,
    description: g.description,
    objectives: g.objectives,
    requiredOutcomes: g.requiredOutcomes,
    scope: g.scope,
    category: g.category,
    amount: g.amount,
    currency: g.currency,
    deadline: g.deadline,
    eligibleRegions: g.eligibleRegions,
    eligibleOrgTypes: g.eligibleOrgTypes,
    keywords: g.keywords,
    lifecycle: g.lifecycle,
    url: g.url,
    referenceCodes: splitKeywords(g.keywords).codes,
    seenAt: g.createdAt.toISOString(),
    isCurrent: g.id === currentId,
    duplicateIds: [],
  };
}

function fromRevision(
  r: { id: string; grantId: string; capturedAt: Date; snapshot: GrantSnapshot },
  parent: GrantRow,
): Edition {
  const s = r.snapshot;
  return {
    key: `rev:${r.id}`,
    grantId: r.grantId,
    kind: 'revision',
    title: s.title,
    funderName: parent.funderName,
    description: s.description ?? '',
    objectives: s.objectives ?? null,
    requiredOutcomes: s.requiredOutcomes ?? null,
    scope: s.scope ?? null,
    category: s.category ?? null,
    amount: s.amount == null ? null : Number(s.amount),
    currency: s.currency ?? parent.currency,
    deadline: s.deadline ?? null,
    eligibleRegions: s.eligibleRegions ?? [],
    eligibleOrgTypes: s.eligibleOrgTypes ?? [],
    keywords: s.keywords ?? [],
    lifecycle: 'superseded',
    url: parent.url,
    referenceCodes: splitKeywords(s.keywords ?? []).codes,
    seenAt: r.capturedAt.toISOString(),
    isCurrent: false,
    duplicateIds: [],
  };
}

/** The cycle an edition belongs to, for ordering: deadline, else a year in the title, else when it was seen. */
function cycleKey(e: Edition): string {
  if (e.deadline) return e.deadline;
  const year = e.title.match(/\b(19|20)\d{2}\b/g)?.pop();
  if (year) return `${year}-12-31`;
  return (e.seenAt ?? '').slice(0, 10);
}

export async function loadCallHistory(tx: Tx, grantId: string): Promise<CallHistory | null> {
  const [current] = await tx
    .select(grantRowColumns)
    .from(grants)
    .leftJoin(funders, eq(funders.id, grants.funderId))
    .where(eq(grants.id, grantId));
  if (!current) return null;

  const seriesTitle = (current.seriesKey ?? '').split('|').slice(1).join('|');
  const members =
    current.seriesKey && seriesTitle.length >= MIN_SERIES_TITLE
      ? await tx
          .select(grantRowColumns)
          .from(grants)
          .leftJoin(funders, eq(funders.id, grants.funderId))
          // Screened-out listings stay out of the trail; the one being viewed stays in.
          .where(and(eq(grants.seriesKey, current.seriesKey), or(inCatalogue, eq(grants.id, current.id))))
      : [current];

  // A renamed call can still carry the same reference-number pattern.
  // Same funder (or source), same code family, and a broadly similar title.
  const families = new Set(
    splitKeywords(current.keywords).codes.map(codeFamily).filter((f) => familyLetters(f) >= 4),
  );
  if (families.size > 0) {
    const seen = new Set(members.map((m) => m.id));
    const sameFunder = current.funderId
      ? eq(grants.funderId, current.funderId)
      : current.source
        ? eq(grants.source, current.source)
        : sql`false`;
    const candidates = await tx
      .select(grantRowColumns)
      .from(grants)
      .leftJoin(funders, eq(funders.id, grants.funderId))
      .where(and(sameFunder, ne(grants.id, current.id), inCatalogue))
      .limit(1000);
    for (const c of candidates) {
      if (seen.has(c.id)) continue;
      const shared = splitKeywords(c.keywords).codes.some((k) => families.has(codeFamily(k)));
      if (shared && wordSimilarity(c.title, current.title) >= 0.5) {
        members.push(c);
        seen.add(c.id);
      }
    }
  }

  const revisions = await tx
    .select()
    .from(grantRevisions)
    .where(inArray(grantRevisions.grantId, members.map((m) => m.id)))
    .orderBy(asc(grantRevisions.capturedAt));

  // One edition per (title, deadline); the current listing wins, else the newest.
  const byEdition = new Map<string, Edition>();
  const ordered = [...members].sort((a, b) =>
    a.id === grantId ? -1 : b.id === grantId ? 1 : b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  for (const g of ordered) {
    const k = `${g.title.trim().toLowerCase()}|${g.deadline ?? ''}`;
    const kept = byEdition.get(k);
    if (kept) kept.duplicateIds.push(g.id);
    else byEdition.set(k, fromListing(g, grantId));
  }
  const parents = new Map(members.map((m) => [m.id, m]));
  const editions = [
    ...byEdition.values(),
    // Same title and deadline as a listing means an amendment within the cycle: still history.
    ...revisions.map((r) => fromRevision(r, parents.get(r.grantId)!)),
  ].sort((a, b) => {
    const c = cycleKey(a).localeCompare(cycleKey(b));
    if (c !== 0) return c;
    // Same cycle: a superseded version came before the listing that replaced it.
    if (a.kind !== b.kind) return a.kind === 'revision' ? -1 : 1;
    return (a.seenAt ?? '').localeCompare(b.seenAt ?? '');
  });

  const comparisons: Comparison[] = [];
  for (let i = 1; i < editions.length; i++) comparisons.push(compareEditions(editions[i - 1]!, editions[i]!));

  return {
    current: grantId,
    editions: editions.map(({ description: _d, objectives: _o, requiredOutcomes: _r, scope: _s, keywords: _k, ...dto }) => dto),
    comparisons,
  };
}

/* ------------------------------------------------------------------ */
/* Comparing two editions                                              */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set(
  ('about above after again against among applicants application applications around based because before being below ' +
    'between could during each either eligible every funding further grant grants other their there these those through ' +
    'under until where which while within without would research project projects proposal proposals program programs ' +
    'programme should shall must including include support supports'
  ).split(' '),
);

const words = (text: string | null) =>
  (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Dice similarity of word bigrams, 0–1. Order-aware, cheap, good enough to tell an edit from a rewrite. */
function textSimilarity(a: string | null, b: string | null): number {
  const bigrams = (t: string | null) => {
    const w = words(t);
    const out = new Map<string, number>();
    for (let i = 0; i < w.length - 1; i++) {
      const k = `${w[i]} ${w[i + 1]}`;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    if (w.length === 1) out.set(w[0]!, 1);
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  const size = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);
  const total = size(A) + size(B);
  if (total === 0) return 1;
  let shared = 0;
  for (const [k, n] of A) shared += Math.min(n, B.get(k) ?? 0);
  return (2 * shared) / total;
}

/** Dice similarity of the two texts' word sets, 0–1. */
function wordSimilarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (A.size + B.size === 0) return 1;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** Content words one text uses and the other does not, most frequent first. */
function termDelta(before: string | null, after: string | null, limit = 8) {
  const counts = (t: string | null) => {
    const m = new Map<string, number>();
    for (const w of words(t)) if (w.length >= 5 && !STOPWORDS.has(w) && !/^\d+$/.test(w)) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const A = counts(before);
  const B = counts(after);
  const only = (x: Map<string, number>, y: Map<string, number>) =>
    [...x.entries()]
      .filter(([w]) => !y.has(w))
      .sort((p, q) => q[1] - p[1])
      .slice(0, limit)
      .map(([w]) => w);
  return { addedTerms: only(B, A), removedTerms: only(A, B) };
}

function listDelta(before: string[], after: string[]) {
  const norm = (s: string) => s.trim().toLowerCase();
  const was = new Set(before.map(norm));
  const now = new Set(after.map(norm));
  return {
    added: after.filter((x) => !was.has(norm(x))),
    removed: before.filter((x) => !now.has(norm(x))),
  };
}

const money = (amount: number | null, currency: string) =>
  amount == null || amount === 0 ? null : `${currency} ${Math.round(amount).toLocaleString('en-US')}`;

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Days between two dates' positions in the year, -182..182 (positive: later in the year). */
function seasonalShift(before: string, after: string) {
  const dayOfYear = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000);
  };
  let diff = dayOfYear(after) - dayOfYear(before);
  if (diff > 182) diff -= 365;
  if (diff < -182) diff += 365;
  return diff;
}

const joinList = (xs: string[], max = 4) =>
  xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;

const TEXT_FIELDS = [
  { field: 'objectives', label: 'Objectives' },
  { field: 'requiredOutcomes', label: 'Required outcomes' },
  { field: 'scope', label: 'Scope' },
  { field: 'description', label: 'Call description' },
] as const;

export function compareEditions(prev: Edition, next: Edition): Comparison {
  const changes: FieldChange[] = [];
  const highlights: string[] = [];

  // Funding
  const before = money(prev.amount, prev.currency);
  const after = money(next.amount, next.currency);
  if (before !== after) {
    changes.push({ field: 'amount', label: 'Award amount', kind: 'value', before, after });
    if (before && after && prev.currency === next.currency && prev.amount && next.amount) {
      const pct = Math.round(((next.amount - prev.amount) / prev.amount) * 100);
      highlights.push(
        pct === 0
          ? `Award amount adjusted (${before} → ${after})`
          : `Award amount ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% (${before} → ${after})`,
      );
    } else if (!before && after) highlights.push(`Award amount now stated: ${after}`);
    else if (before && !after) highlights.push(`Award amount no longer stated (was ${before})`);
    else highlights.push(`Award amount changed (${before} → ${after})`);
  }

  // Deadline
  if (prev.deadline !== next.deadline) {
    changes.push({
      field: 'deadline',
      label: 'Deadline',
      kind: 'value',
      before: prev.deadline ? longDate(prev.deadline) : null,
      after: next.deadline ? longDate(next.deadline) : null,
    });
    if (prev.deadline && next.deadline) {
      const shift = seasonalShift(prev.deadline, next.deadline);
      const when =
        Math.abs(shift) <= 7
          ? 'about the same time of year'
          : `${Math.round(Math.abs(shift) / 7)} week${Math.round(Math.abs(shift) / 7) === 1 ? '' : 's'} ${shift > 0 ? 'later' : 'earlier'} in the year`;
      highlights.push(`Deadline ${longDate(next.deadline)} (was ${longDate(prev.deadline)}): ${when}`);
    } else if (next.deadline) highlights.push(`Deadline now set: ${longDate(next.deadline)}`);
    else highlights.push('No fixed deadline in this edition (rolling or not yet announced)');
  }

  // Eligibility
  const regions = listDelta(prev.eligibleRegions, next.eligibleRegions);
  if (regions.added.length || regions.removed.length) {
    changes.push({ field: 'eligibleRegions', label: 'Eligible regions', kind: 'list', ...regions });
    if (regions.added.length) highlights.push(`Now open to applicants from ${joinList(regions.added)}`);
    if (regions.removed.length) highlights.push(`No longer open to applicants from ${joinList(regions.removed)}`);
  }
  const orgs = listDelta(prev.eligibleOrgTypes, next.eligibleOrgTypes);
  if (orgs.added.length || orgs.removed.length) {
    changes.push({ field: 'eligibleOrgTypes', label: 'Eligible organisations', kind: 'list', ...orgs });
    if (orgs.added.length) highlights.push(`Newly eligible: ${joinList(orgs.added)}`);
    if (orgs.removed.length) highlights.push(`No longer eligible: ${joinList(orgs.removed)}`);
  }

  // Focus
  if ((prev.category ?? '') !== (next.category ?? '')) {
    changes.push({ field: 'category', label: 'Category', kind: 'value', before: prev.category, after: next.category });
    highlights.push(`Recategorised from ${prev.category ?? 'uncategorised'} to ${next.category ?? 'uncategorised'}`);
  }
  const prevKw = splitKeywords(prev.keywords);
  const nextKw = splitKeywords(next.keywords);
  const codes = listDelta(prevKw.codes, nextKw.codes);
  if (codes.added.length || codes.removed.length) {
    changes.push({
      field: 'referenceCodes',
      label: 'Reference number',
      kind: 'value',
      before: prevKw.codes.join(', ') || null,
      after: nextKw.codes.join(', ') || null,
    });
    highlights.unshift(
      prevKw.codes.length && nextKw.codes.length
        ? `Reference number ${joinList(prevKw.codes, 2)} → ${joinList(nextKw.codes, 2)}`
        : nextKw.codes.length
          ? `Reference number now ${joinList(nextKw.codes, 2)}`
          : `Reference number ${joinList(prevKw.codes, 2)} withdrawn`,
    );
  }
  const focus = listDelta(prevKw.topics, nextKw.topics);
  if (focus.added.length || focus.removed.length) {
    changes.push({ field: 'keywords', label: 'Focus areas', kind: 'list', ...focus });
    if (focus.added.length) highlights.push(`New focus areas: ${joinList(focus.added)}`);
    if (focus.removed.length) highlights.push(`Dropped focus areas: ${joinList(focus.removed)}`);
  }

  // Title
  if (prev.title.trim() !== next.title.trim()) {
    changes.push({ field: 'title', label: 'Title', kind: 'value', before: prev.title, after: next.title });
  }

  // Specification text
  for (const { field, label } of TEXT_FIELDS) {
    const a = prev[field];
    const b = next[field];
    if ((a ?? '').trim() === (b ?? '').trim()) continue;
    const similarity = textSimilarity(a, b);
    changes.push({ field, label, kind: 'text', similarity: Math.round(similarity * 100), before: a, after: b, ...termDelta(a, b) });
    if (!a?.trim()) highlights.push(`${label} added in this edition`);
    else if (!b?.trim()) highlights.push(`${label} no longer published`);
    else if (similarity < 0.6) highlights.push(`${label} substantially rewritten (${Math.round(similarity * 100)}% similar to before)`);
    else if (similarity < 0.95) highlights.push(`${label} revised (${Math.round(similarity * 100)}% similar to before)`);
  }

  if (highlights.length === 0) {
    highlights.push(
      changes.length ? 'Only minor wording changes' : 'Republished with no substantive changes',
    );
  }
  return { from: prev.key, to: next.key, highlights, changes };
}
