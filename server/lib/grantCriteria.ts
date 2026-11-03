import type { Evidence, GateResult, StructuredProfile } from '../../shared/profile.ts';
import { CAREER_STAGE_LABEL, type CareerStage } from '../../shared/profile.ts';
import { applicantRegionEligible, isGlobalSouth, isWorldwide } from '../../shared/regions.ts';
import { countriesIn } from './taxonomy.ts';

// The four hard eligibility gates: geography, applicant type, career stage
// and registration. Each one passes, fails, or is "unknown" when either
// the call or the profile does not say enough to decide. A failed gate
// makes a grant ineligible; an unknown one asks the user to check.

export interface CriteriaGrant {
  title: string;
  description: string;
  objectives: string | null;
  scope: string | null;
  eligibleRegions: string[];
  eligibleOrgTypes: string[];
}

/** The call's own wording, searched for requirements. */
export const grantText = (g: CriteriaGrant) => [g.title, g.description, g.objectives, g.scope].filter(Boolean).join('\n');

/** The sentence around a match in the grant text, for "the call says…" evidence. */
export function grantSnippet(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m || m.index === undefined) return null;
  const start = Math.max(text.lastIndexOf('.', m.index) + 1, m.index - 120);
  const endDot = text.indexOf('.', m.index + m[0].length);
  const end = Math.min(endDot === -1 ? text.length : endDot + 1, m.index + m[0].length + 140);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

const FOREIGN_OK = /foreign (organi[sz]ations|institutions|entities|applicants)( \w+){0,3} (are|is) eligible|international applicants (are )?(welcome|eligible)|open to (applicants|researchers|organi[sz]ations) (from )?(any|all) countr/i;
const FOREIGN_NO = /foreign (organi[sz]ations|institutions|entities|applicants)( \w+){0,3} (are|is) not eligible|not open to foreign|u\.?s\.? (citizens|nationals) only|must be (a )?u\.?s\.? (citizen|based|organi[sz]ation)/i;

/* Geography --------------------------------------------------------- */

function geography(p: StructuredProfile, g: CriteriaGrant, text: string): GateResult {
  const base = { key: 'geography' as const, label: 'Geography' };
  const evidence: Evidence[] = [...p.country.evidence, ...p.region.evidence].slice(0, 2);
  const where = p.country.value ?? p.region.value;
  const regions = g.eligibleRegions.filter((r) => r.trim());

  if (regions.length === 0) return { ...base, status: 'pass', detail: 'The call lists no geographic restriction.', evidence };
  const listed = regions.join(', ');
  if (regions.some(isWorldwide)) return { ...base, status: 'pass', detail: `Open worldwide (${listed}).`, evidence };
  if (!where) return { ...base, status: 'unknown', detail: `Open to ${listed}; add your country to check.`, evidence: [] };

  const fits = regions.some((r) => {
    // A call that names countries (and no wider region) wants one of them.
    const named = countriesIn(r);
    const wider = /africa|asia|europe|america|caribbean|region|global|developing|countries|lmic/i.test(r) || isGlobalSouth(r);
    if (named.length && !wider && p.country.value) return named.includes(p.country.value);
    return applicantRegionEligible(r, p.country.value) || applicantRegionEligible(r, p.region.value);
  });
  if (fits) return { ...base, status: 'pass', detail: `${where} is within ${listed}.`, evidence };

  const foreignOk = grantSnippet(text, FOREIGN_OK);
  if (foreignOk && !FOREIGN_NO.test(text)) {
    return { ...base, status: 'pass', detail: `Listed for ${listed}, but the call accepts foreign applicants: "${foreignOk}"`, evidence };
  }
  return { ...base, status: 'fail', detail: `Restricted to ${listed}; your profile places you in ${where}.`, evidence };
}

/* Applicant type ---------------------------------------------------- */

const INDIVIDUAL_TYPES = /\bindividuals?\b|students?|candidates?|fellows?\b|scholars?|postdoc|early[- ]career|investigators?|researchers?\b/i;
const ORG_TYPES = /organi[sz]ations?|institutions?|universit|nonprofit|non-profit|\bngos?\b|business|compan|government|school district|tribal|housing|labs?\b|cent(er|re)s?\b|higher education|consorti/i;
const HIGHER_ED = /higher education|universit|research (institutions?|cent(er|re)s|organi[sz]ations)|academic/i;
const UNRESTRICTED = /unrestricted|any type of entity|open to all|^\s*all\s*$/i;

function applicantType(p: StructuredProfile, g: CriteriaGrant): GateResult {
  const base = { key: 'applicantType' as const, label: 'Applicant type' };
  const type = p.applicantType.value;
  const evidence = p.applicantType.evidence.slice(0, 1);
  // "Others (see text …)" alone says nothing.
  const types = g.eligibleOrgTypes.filter((t) => !/^others?\b/i.test(t.trim()));
  if (types.length === 0) {
    return g.eligibleOrgTypes.length
      ? { ...base, status: 'unknown', detail: 'The call describes who may apply only in its full text.', evidence }
      : { ...base, status: 'pass', detail: 'The call names no applicant-type restriction.', evidence };
  }
  if (types.some((t) => UNRESTRICTED.test(t))) return { ...base, status: 'pass', detail: 'Open to any type of applicant.', evidence };
  if (!type) return { ...base, status: 'unknown', detail: `Open to: ${types.slice(0, 3).join('; ')}. Say whether you apply as an individual or organisation.`, evidence: [] };

  const forIndividuals = types.filter((t) => INDIVIDUAL_TYPES.test(t) && !ORG_TYPES.test(t));
  const forOrgs = types.filter((t) => ORG_TYPES.test(t));
  if (type === 'individual') {
    if (forIndividuals.length) return { ...base, status: 'pass', detail: `Open to individuals (${forIndividuals[0]}).`, evidence };
    const viaHost = forOrgs.find((t) => HIGHER_ED.test(t));
    if (viaHost && p.institution.value) {
      return {
        ...base,
        status: 'pass',
        detail: `Applications come from institutions (${viaHost}); apply through ${p.institution.value}.`,
        evidence: [...evidence, ...p.institution.evidence.slice(0, 1)],
      };
    }
    if (viaHost) return { ...base, status: 'unknown', detail: `Institutions apply (${viaHost}); add your host institution to apply through it.`, evidence };
    return { ...base, status: 'fail', detail: `Only organisations may apply (${forOrgs.slice(0, 2).join('; ') || types[0]}).`, evidence };
  }
  if (forOrgs.length) return { ...base, status: 'pass', detail: `Open to organisations (${forOrgs[0]}).`, evidence };
  return { ...base, status: 'fail', detail: `Only individuals may apply (${forIndividuals[0] ?? types[0]}).`, evidence };
}

/* Career stage ------------------------------------------------------ */

const STAGE_REQUIREMENTS: { stages: CareerStage[]; re: RegExp }[] = [
  { stages: ['student'], re: /ph\.?d\.? candidates?|doctoral (students?|candidates?)|(post)?graduate students?|master'?s students?/i },
  { stages: ['early'], re: /early[- ]career|within (\d+|three|five|seven|ten) years of (their |the |completing )?(a |the )?(ph\.?d|doctora)|post-?doc(toral)? (fellows?|researchers?)|new investigators?|junior (researchers?|faculty)/i },
  { stages: ['mid'], re: /mid[- ]career/i },
  { stages: ['senior'], re: /senior (researchers?|scientists?|investigators?)|established (investigators?|researchers?)/i },
];

/** Stage names as they read mid-sentence ("for early-career applicants"). */
const STAGE_PHRASE: Record<CareerStage, string> = {
  student: 'student or PhD-candidate',
  early: 'early-career',
  mid: 'mid-career',
  senior: 'senior',
};

function careerStage(p: StructuredProfile, g: CriteriaGrant, text: string): GateResult {
  const base = { key: 'careerStage' as const, label: 'Career stage' };
  const required = STAGE_REQUIREMENTS.filter((r) => g.eligibleOrgTypes.some((t) => r.re.test(t)) || r.re.test(text));
  if (required.length === 0) return { ...base, status: 'pass', detail: 'No career-stage requirement.', evidence: [] };
  const stages = [...new Set(required.flatMap((r) => r.stages))];
  // Quote the applicant-type entry that asks for it, else the sentence.
  const re = required[0]!.re;
  const said = g.eligibleOrgTypes.find((t) => re.test(t)) ?? grantSnippet(text, re);
  const wanted = stages.map((s) => STAGE_PHRASE[s]).join(' or ');
  if (p.applicantType.value === 'organisation') {
    return { ...base, status: 'pass', detail: `The call targets ${wanted} applicants; this applies to the lead researcher you name.`, evidence: [] };
  }
  const stage = p.careerStage.value;
  if (!stage) return { ...base, status: 'unknown', detail: `For ${wanted} applicants${said ? ` ("${said}")` : ''}. Upload your CV to check.`, evidence: [] };
  const evidence = p.careerStage.evidence.slice(0, 1);
  const detail = `The call wants ${wanted} applicants; you are ${CAREER_STAGE_LABEL[stage]}.`;
  return { ...base, status: stages.includes(stage) ? 'pass' : 'fail', detail, evidence };
}

/* Registration ------------------------------------------------------ */

const REG_REQUIRED = /legally registered|must be (a )?registered|proof of (legal )?registration|registration certificate|registered (ngos?|non-?profits?|organi[sz]ations?|charit(y|ies)|entit(y|ies)|compan(y|ies)) (only|are eligible|may apply)|certificate of incorporation/i;
const REGISTERED_ENTITY = /501\(c\)\(3\)|non-?profits?|\bngos?\b|compan(y|ies)|business|government|charit/i;

function registration(p: StructuredProfile, g: CriteriaGrant, text: string): GateResult {
  const base = { key: 'registration' as const, label: 'Registration' };
  const types = g.eligibleOrgTypes.filter((t) => !/^others?\b/i.test(t.trim()));
  // Required when the text says so, or when every listed applicant type is a registered entity.
  const said = grantSnippet(text, REG_REQUIRED);
  const allRegistered = types.length > 0 && types.every((t) => REGISTERED_ENTITY.test(t) && !HIGHER_ED.test(t));
  if (!said && !allRegistered) return { ...base, status: 'pass', detail: 'No registration requirement.', evidence: [] };
  const why = said ? `"${said}"` : `open to ${types.slice(0, 2).join('; ')}`;
  if (p.applicantType.value === 'individual') {
    return p.institution.value
      ? { ...base, status: 'pass', detail: `Registration is required (${why}); your host institution ${p.institution.value} would hold it.`, evidence: p.institution.evidence.slice(0, 1) }
      : { ...base, status: 'unknown', detail: `A registered organisation must apply (${why}); add a host institution.`, evidence: [] };
  }
  const reg = p.registration.value;
  if (!reg) return { ...base, status: 'unknown', detail: `Registration is required (${why}). Upload your registration certificate or organisation profile.`, evidence: [] };
  return reg.registered
    ? { ...base, status: 'pass', detail: `Registration is required and your documents show it.`, evidence: p.registration.evidence.slice(0, 1) }
    : { ...base, status: 'fail', detail: `Registration is required (${why}); your documents say you are not registered.`, evidence: p.registration.evidence.slice(0, 1) };
}

/* ------------------------------------------------------------------ */

export function evaluateGates(p: StructuredProfile, g: CriteriaGrant): GateResult[] {
  const text = grantText(g);
  return [geography(p, g, text), applicantType(p, g), careerStage(p, g, text), registration(p, g, text)];
}
