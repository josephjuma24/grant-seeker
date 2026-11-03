import {
  bandFor,
  type ComponentResult,
  type Eligibility,
  type Evidence,
  type FitResult,
  type GateResult,
  type StructuredProfile,
} from '../../shared/profile.ts';
import type { RelevanceBreakdown } from '../db/schema.ts';
import { evaluateGates, grantSnippet, grantText, type CriteriaGrant } from './grantCriteria.ts';
import { funderIn, sameFunder, THEMES, themesIn, toUsd } from './taxonomy.ts';

// Weighted fit score for one profile and one grant. Pure and deterministic:
// the same profile and grant always give the same score, and every point
// is tied to the profile evidence and grant text it came from.

export const FIT_VERSION = 'fit-v1';

export const WEIGHTS = {
  thematic: 0.35,
  trackRecord: 0.25,
  capacity: 0.15,
  partnership: 0.1,
  deadline: 0.1,
  funderHistory: 0.05,
} as const;

export interface FitGrant extends CriteriaGrant {
  amount: number | null;
  currency: string;
  deadline: string | null;
  keywords: string[];
  funderName: string | null;
}

export interface FitOptions {
  /** Cosine similarity of the profile and grant embeddings, when both exist. */
  similarity?: number | null;
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

function component(
  key: ComponentResult['key'],
  label: string,
  score: number,
  detail: string,
  evidence: Evidence[],
  grantEvidence: string | null,
): ComponentResult {
  const s = clamp(score);
  return { key, label, weight: WEIGHTS[key], score: s, points: Math.round(WEIGHTS[key] * s * 10) / 10, detail, evidence: evidence.slice(0, 3), grantEvidence };
}

/* Thematic alignment (35%) ----------------------------------------- */

function thematic(p: StructuredProfile, g: FitGrant, text: string, similarity: number | null | undefined) {
  const grantThemes = themesIn(`${text}\n${g.keywords.join(' ')}`).map((t) => t.label);
  const shared = p.themes.value.filter((t) => grantThemes.includes(t));
  const themeScore = grantThemes.length ? shared.length / Math.min(grantThemes.length, 3) : 0;

  const lower = `${text}\n${g.keywords.join(' ')}`.toLowerCase();
  const kws = p.keywords.value.filter((k) => k.length >= 3);
  const hits = kws.filter((k) => new RegExp(`\\b${esc(k.toLowerCase())}`).test(lower));
  const kwScore = kws.length ? hits.length / Math.min(kws.length, 5) : 0;

  const lexical = 100 * Math.min(1, 0.6 * Math.min(1, themeScore) + 0.4 * Math.min(1, kwScore));
  // Gemini embeddings put unrelated texts near 0.45 and close ones above 0.8.
  const semantic = similarity == null ? null : clamp(((similarity - 0.45) / 0.35) * 100);
  const score = semantic == null ? lexical : 0.6 * semantic + 0.4 * lexical;

  const themeEvidence = shared.flatMap((t) => {
    const re = THEMES.find((x) => x.label === t)!.pattern;
    return p.themes.evidence.filter((e) => re.test(e.quote)).slice(0, 1);
  });
  const kwEvidence = hits.flatMap((k) => p.keywords.evidence.filter((e) => e.quote.toLowerCase().includes(k.toLowerCase())).slice(0, 1));
  const firstHit = hits[0] ?? shared[0];
  const grantEvidence = firstHit
    ? grantSnippet(text, hits[0] ? new RegExp(`\\b${esc(hits[0])}`, 'i') : THEMES.find((x) => x.label === shared[0])!.pattern)
    : null;

  const parts: string[] = [];
  if (shared.length) parts.push(`shared themes: ${list(shared)}`);
  if (hits.length) parts.push(`your keywords ${list(hits.slice(0, 4).map((h) => `"${h}"`))} appear in the call`);
  if (!parts.length) parts.push(`no shared themes or keywords${grantThemes.length ? ` (the call is about ${list(grantThemes.slice(0, 3))})` : ''}`);
  if (semantic != null) parts.push(`text similarity ${Math.round(similarity! * 100)}%`);
  const detail = `${parts.join('; ')}.`;
  return { result: component('thematic', 'Thematic alignment', score, detail[0]!.toUpperCase() + detail.slice(1), [...themeEvidence, ...kwEvidence], grantEvidence), shared, hits, grantThemes };
}

/* Track record (25%) ------------------------------------------------ */

function trackRecord(p: StructuredProfile, grantThemes: string[]) {
  const grants = p.pastGrants.value;
  const pubs = p.publications.value;
  const patterns = THEMES.filter((t) => grantThemes.includes(t.label)).map((t) => t.pattern);
  const relevantGrant = grants.find((x) => patterns.some((re) => re.test(x.evidence.quote)));
  const relevantPub = pubs.find((x) => patterns.some((re) => re.test(x.title)));
  const org = p.applicantType.value === 'organisation';
  const score =
    Math.min(1, grants.length / 3) * (org ? 65 : 50) +
    Math.min(1, pubs.length / 10) * (org ? 15 : 30) +
    (relevantGrant || relevantPub ? 20 : 0);
  const parts = [
    grants.length ? `${grants.length} past grant${grants.length === 1 ? '' : 's'}` : 'no past grants found',
    pubs.length ? `${pubs.length} publication${pubs.length === 1 ? '' : 's'}` : 'no publications found',
  ];
  const evidence = [relevantGrant?.evidence, relevantPub?.evidence, grants[0]?.evidence, pubs[0]?.evidence].filter((e): e is Evidence => !!e);
  const detail = `${parts.join(', ')}${relevantGrant || relevantPub ? ', including work in this call\'s field' : ''}.`;
  return component('trackRecord', 'Track record', score, detail[0]!.toUpperCase() + detail.slice(1), [...new Set(evidence)], null);
}

/* Capacity vs grant size (15%) -------------------------------------- */

function capacity(p: StructuredProfile, g: FitGrant) {
  if (!g.amount) return component('capacity', 'Capacity vs. grant size', 70, 'The call does not state an award size.', [], null);
  const award = toUsd(g.amount, g.currency);
  const sized = p.pastGrants.value.filter((x) => x.amount).map((x) => ({ usd: toUsd(x.amount!, x.currency), x }));
  const largest = sized.sort((a, b) => b.usd - a.usd)[0];
  const budget = p.annualBudget.value;
  let reference: number;
  let evidence: Evidence[];
  let basis: string;
  if (largest) {
    reference = largest.usd;
    evidence = [largest.x.evidence];
    basis = `your largest past award (${money(reference)})`;
  } else if (budget) {
    reference = toUsd(budget.amount, budget.currency) * 0.5;
    evidence = p.annualBudget.evidence;
    basis = `half your annual budget (${money(reference)})`;
  } else {
    return component('capacity', 'Capacity vs. grant size', 50, `Award of ${money(award)}; no past award sizes or budget to compare with.`, [], null);
  }
  const ratio = award / reference;
  const [score, verdict] =
    ratio < 0.05 ? [60, 'much smaller than you usually manage']
    : ratio <= 1.5 ? [100, 'within what you have managed']
    : ratio <= 3 ? [80, 'a step up you can plausibly manage']
    : ratio <= 6 ? [55, 'a large step up']
    : ratio <= 12 ? [30, 'far above what you have managed']
    : [10, 'well beyond your track record'];
  return component('capacity', 'Capacity vs. grant size', score, `Award of ${money(award)} is ${verdict}, compared with ${basis}.`, evidence, null);
}

/* Partnership fit (10%) --------------------------------------------- */

const PARTNER_REQUIRED = /consorti(um|a)|partnership (is|are) (required|mandatory)|in partnership with|must (include|involve|partner)|multi-?(institutional|country|partner)|joint (application|proposal)s?|collaborat(ive|ion) (with|between|among)/i;

function partnership(p: StructuredProfile, text: string) {
  const said = grantSnippet(text, PARTNER_REQUIRED);
  const partners = p.partnerships.value;
  const evidence = p.partnerships.evidence;
  if (said) {
    return partners.length
      ? component('partnership', 'Partnership fit', 100, `The call expects partners; you list ${list(partners.slice(0, 3))}.`, evidence, said)
      : component('partnership', 'Partnership fit', 20, 'The call expects partners or a consortium, and your profile names none.', [], said);
  }
  return partners.length
    ? component('partnership', 'Partnership fit', 100, `No partnership requirement; you bring partners such as ${list(partners.slice(0, 2))}.`, evidence, null)
    : component('partnership', 'Partnership fit', 70, 'No partnership requirement.', [], null);
}

/* Deadline feasibility (10%) ---------------------------------------- */

function deadline(g: FitGrant, now: Date) {
  if (!g.deadline) return component('deadline', 'Deadline feasibility', 60, 'No deadline stated (rolling or to be confirmed).', [], null);
  const days = Math.ceil((new Date(`${g.deadline}T23:59:59Z`).getTime() - now.getTime()) / DAY_MS);
  const [score, detail] =
    days <= 0 ? [0, 'The deadline has passed.']
    : days < 7 ? [25, `${days} day${days === 1 ? '' : 's'} left: very tight for a full application.`]
    : days < 14 ? [50, `${days} days left: tight.`]
    : days < 30 ? [80, `${days} days left.`]
    : days <= 120 ? [100, `${days} days left: comfortable time to prepare.`]
    : [90, `${days} days left.`];
  return component('deadline', 'Deadline feasibility', score, detail, [], `Deadline ${g.deadline}`);
}

/* Funder history (5%) ----------------------------------------------- */

function funderHistory(p: StructuredProfile, g: FitGrant, text: string) {
  const funder = g.funderName ?? funderIn(text);
  if (!funder) return component('funderHistory', 'Funder history', 40, 'Funder not identified.', [], null);
  const prior = p.pastGrants.value.filter((x) => sameFunder(x.funder, funder));
  return prior.length
    ? component('funderHistory', 'Funder history', 100, `You have been funded by ${funder} before (${prior.length}×).`, prior.map((x) => x.evidence), funder)
    : component('funderHistory', 'Funder history', 40, `No previous grant from ${funder} found.`, [], funder);
}

/* ------------------------------------------------------------------ */

function eligibilityOf(gates: GateResult[]): Eligibility {
  if (gates.some((x) => x.status === 'fail')) return 'ineligible';
  if (gates.some((x) => x.status === 'unknown')) return 'check';
  return 'eligible';
}

/** The source to cite: an uploaded document beats the form. */
const sourceOf = (e: Evidence[] | undefined) => {
  const best = e?.find((x) => x.docId) ?? e?.[0];
  return best ? ` (${best.source})` : '';
};

function explain(p: StructuredProfile, c: Record<ComponentResult['key'], ComponentResult>, shared: string[], hits: string[], gates: GateResult[], eligibility: Eligibility): string {
  const s: string[] = [];
  if (shared.length || hits.length) {
    // A keyword that only repeats a theme name adds nothing.
    const specific = hits.filter((h) => !shared.some((t) => t.toLowerCase().includes(h.toLowerCase())));
    const on = specific.length ? ` on ${list(specific.slice(0, 2).map((h) => `"${h}"`))}` : '';
    const what = shared.length ? `${list(shared.slice(0, 2))} work${on}` : `work${on}`;
    s.push(`Your ${what}${sourceOf(c.thematic.evidence)} matches this call's focus.`);
  } else {
    s.push("Little overlap between your profile's themes and this call.");
  }
  const strengths = (['funderHistory', 'trackRecord', 'capacity', 'partnership'] as const).filter((k) => c[k].score >= 80 && c[k].evidence.length);
  if (strengths.length) {
    const k = strengths[0]!;
    s.push(`${c[k].detail.replace(/\.$/, '')}${sourceOf(c[k].evidence)}.`);
  } else if (p.pastGrants.value.length === 0 && p.publications.value.length === 0) {
    s.push('No grants or publications are on your profile yet, which lowers the track-record score.');
  }
  const failed = gates.filter((x) => x.status === 'fail');
  const unknown = gates.filter((x) => x.status === 'unknown');
  if (eligibility === 'ineligible') s.push(`Not eligible: ${failed[0]!.detail}`);
  else if (eligibility === 'check') s.push(`Check eligibility: ${list(unknown.map((x) => x.label.toLowerCase()))} could not be confirmed.`);
  else s.push('You meet all hard eligibility requirements.');
  return s.slice(0, 3).join(' ');
}

function gapsOf(p: StructuredProfile, gates: GateResult[], c: Record<ComponentResult['key'], ComponentResult>): string[] {
  const gaps = gates.filter((x) => x.status !== 'pass').map((x) => `${x.label}: ${x.detail}`);
  if (c.thematic.score < 50) {
    const overlap = /shared themes|your keywords/.test(c.thematic.detail);
    gaps.push(`${overlap ? `Partial thematic fit (${c.thematic.score}/100)` : 'Thematic fit is weak'}: ${c.thematic.detail[0]!.toLowerCase()}${c.thematic.detail.slice(1)}`);
  }
  if (c.trackRecord.score < 50) {
    gaps.push(
      p.pastGrants.value.length || p.publications.value.length
        ? `Thin track record for this call: ${c.trackRecord.detail[0]!.toLowerCase()}${c.trackRecord.detail.slice(1)}`
        : 'Add past grants and publications (upload a CV or publications list) to strengthen your track record.',
    );
  }
  if (c.capacity.score < 50) gaps.push(c.capacity.detail);
  if (c.partnership.score < 50) gaps.push('The call expects partners: add partner organisations or a consortium to your profile.');
  if (c.deadline.score < 50) gaps.push(c.deadline.detail);
  return gaps;
}

export function scoreFit(p: StructuredProfile, g: FitGrant, opts: FitOptions = {}): FitResult {
  const now = opts.now ?? new Date();
  const text = grantText(g);
  const gates = evaluateGates(p, g);
  const t = thematic(p, g, text, opts.similarity);
  const c = {
    thematic: t.result,
    trackRecord: trackRecord(p, t.grantThemes),
    capacity: capacity(p, g),
    partnership: partnership(p, text),
    deadline: deadline(g, now),
    funderHistory: funderHistory(p, g, text),
  };
  const components = Object.values(c);
  const score = clamp(components.reduce((sum, x) => sum + x.weight * x.score, 0));
  const eligibility = eligibilityOf(gates);
  return {
    version: FIT_VERSION,
    score,
    band: bandFor(score),
    eligibility,
    gates,
    components,
    explanation: explain(p, c, t.shared, t.hits, gates, eligibility),
    gaps: gapsOf(p, gates, c),
  };
}

/** The old four-part breakdown, kept for screens and exports that still read it. */
export function legacyBreakdown(fit: FitResult): RelevanceBreakdown {
  const by = (k: ComponentResult['key']) => fit.components.find((x) => x.key === k)?.score ?? 0;
  return {
    subject: Math.round(by('thematic') * 0.4),
    eligibility: fit.eligibility === 'eligible' ? 30 : fit.eligibility === 'check' ? 20 : 0,
    amount: Math.round(by('capacity') * 0.15),
    urgency: Math.round(by('deadline') * 0.15),
  };
}
