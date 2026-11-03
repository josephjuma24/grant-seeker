import { and, eq } from 'drizzle-orm';

import type { FitResult, StructuredProfile } from '../../shared/profile.ts';
import { CAREER_STAGE_LABEL } from '../../shared/profile.ts';
import type { Tx } from '../db/index.ts';
import { funders, grantMatches, grants, proposals } from '../db/schema.ts';
import { FIT_VERSION } from './fitScoring.ts';
import { grantRowColumns, type GrantRow } from './grantQueries.ts';
import { notFound } from './httpError.ts';
import { loadStructuredProfile, scoreUserMatches } from './matchService.ts';

// What the AI Proposal Assistant knows when you apply from a match: the
// call, your structured profile, the fit assessment (gates, gaps, evidence)
// and the application you already started for it, if any.

export interface ApplicationContext {
  grant: GrantRow;
  profile: StructuredProfile | null;
  fit: FitResult | null;
  proposal: { id: string; status: string; title: string; body: Record<string, unknown> | null } | null;
}

export async function loadApplicationContext(tx: Tx, userId: string, grantId: string): Promise<ApplicationContext> {
  const [grant] = await tx
    .select(grantRowColumns)
    .from(grants)
    .leftJoin(funders, eq(funders.id, grants.funderId))
    .where(eq(grants.id, grantId));
  if (!grant) throw notFound('Grant not found');

  const profile = await loadStructuredProfile(tx, userId);
  const readFit = async () =>
    (await tx.select({ fit: grantMatches.fit, model: grantMatches.model }).from(grantMatches).where(and(eq(grantMatches.userId, userId), eq(grantMatches.grantId, grantId))))[0];
  let match = await readFit();
  // Never scored, or by an older scorer: score now (open calls only).
  if (profile && grant.status === 'active' && (!match?.fit || match.model !== FIT_VERSION)) {
    await scoreUserMatches(tx, userId, { grantIds: [grantId], profile });
    match = await readFit();
  }

  const [proposal] = await tx
    .select({ id: proposals.id, status: proposals.status, title: proposals.title, body: proposals.body })
    .from(proposals)
    .where(and(eq(proposals.ownerId, userId), eq(proposals.grantId, grantId)));

  return { grant, profile, fit: match?.fit ?? null, proposal: proposal ?? null };
}

/* Prompt blocks ----------------------------------------------------- */

const money = (n: number | null, currency = 'USD') =>
  n == null ? 'amount not stated' : `${currency} ${Math.round(n).toLocaleString('en-US')}`;

/** The structured profile as prompt text: the evidence the draft should build on. */
export function profileBlock(p: StructuredProfile | null): string {
  if (!p) return 'Structured profile: none yet.';
  const lines = [
    `- Applies as: ${p.applicantType.value ?? 'not stated'}`,
    `- Country / region: ${p.country.value ?? '-'} / ${p.region.value ?? '-'}`,
    `- Institution: ${p.institution.value ?? '-'}`,
    p.careerStage.value ? `- Career stage: ${CAREER_STAGE_LABEL[p.careerStage.value]}` : null,
    p.qualifications.value.length ? `- Qualifications: ${p.qualifications.value.slice(0, 4).join('; ')}` : null,
    `- Thematic areas: ${p.themes.value.join(', ') || '-'}`,
    `- Keywords: ${p.keywords.value.slice(0, 12).join(', ') || '-'}`,
    p.pastGrants.value.length
      ? `- Past grants: ${p.pastGrants.value.slice(0, 8).map((g) => `${g.funder}${g.amount ? ` (${money(g.amount, g.currency)})` : ''}${g.year ? `, ${g.year}` : ''}`).join('; ')}`
      : '- Past grants: none recorded',
    p.publications.value.length
      ? `- Publications: ${p.publications.value.length}, e.g. ${p.publications.value.slice(0, 3).map((x) => x.title).join(' | ')}`
      : '- Publications: none recorded',
    p.partnerships.value.length ? `- Partners: ${p.partnerships.value.slice(0, 8).join(', ')}` : null,
    p.registration.value ? `- Registration: ${p.registration.value.registered ? 'registered' : 'not registered'} ${p.registration.value.detail}` : null,
    p.annualBudget.value ? `- Annual budget: ${money(p.annualBudget.value.amount, p.annualBudget.value.currency)}` : null,
    p.teamSize.value != null ? `- Team size: ${p.teamSize.value}` : null,
  ];
  return `Structured profile (read from the applicant's documents):\n${lines.filter(Boolean).join('\n')}`;
}

/** The fit assessment as prompt text: gates, components and gaps. */
export function fitBlock(f: FitResult | null): string {
  if (!f) return 'Fit assessment: not available for this call.';
  return [
    `Fit assessment: ${f.score}/100 (${f.band}), eligibility: ${f.eligibility}`,
    'Hard eligibility gates:',
    ...f.gates.map((g) => `- ${g.label}: ${g.status.toUpperCase()} (${g.detail})`),
    'Weighted components:',
    ...f.components.map((c) => `- ${c.label} (${Math.round(c.weight * 100)}%): ${c.score}/100 (${c.detail})`),
    f.gaps.length ? `Gaps to address:\n${f.gaps.map((g) => `- ${g}`).join('\n')}` : 'Gaps to address: none found.',
  ].join('\n');
}
