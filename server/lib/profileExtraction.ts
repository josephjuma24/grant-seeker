import {
  emptyProfile,
  type ApplicantType,
  type CareerStage,
  type DocumentKind,
  type Evidence,
  type Field,
  type PastGrant,
  type Publication,
  type StructuredProfile,
} from '../../shared/profile.ts';
import { isAfrica, isEastAfrica, isGlobalSouth, isKenya } from '../../shared/regions.ts';
import { countriesIn, funderIn, moneyIn, regionOfCountry, THEMES, topTerms } from './taxonomy.ts';

// Builds the structured profile from the sign-up form and uploaded
// documents. Rule-based on purpose: every value comes with the exact line
// it was read from, so a score built on it can always be explained.

export interface FormInputs {
  applicantType: ApplicantType | null;
  persona: string | null;
  region: string | null;
  organization: string | null;
  researchInterests: string[];
  qualifications: string | null;
  pastProjects: string | null;
  pastPublications: string | null;
  projectDescriptions: string | null;
}

export interface SourceDocument {
  id: string;
  filename: string;
  kind: DocumentKind;
  text: string;
}

interface Line {
  text: string;
  source: string;
  docId: string | null;
  kind: DocumentKind | 'form';
}

const FORM = 'Profile form';
const MAX_QUOTE = 200;

/** A short quote around the match, so evidence stays readable. */
function quote(line: string, match?: RegExpMatchArray | null): string {
  const t = line.trim();
  if (t.length <= MAX_QUOTE) return t;
  const at = match?.index ?? 0;
  const start = Math.max(0, Math.min(at - 60, t.length - MAX_QUOTE));
  return `${start > 0 ? '…' : ''}${t.slice(start, start + MAX_QUOTE).trim()}…`;
}

const ev = (l: Line, m?: RegExpMatchArray | null): Evidence => ({ source: l.source, docId: l.docId, quote: quote(l.text, m) });

/** Lines of all sources; long PDF lines are split into sentences. */
function toLines(form: FormInputs, docs: SourceDocument[]): Line[] {
  const lines: Line[] = [];
  const push = (text: string, source: string, docId: string | null, kind: Line['kind']) => {
    for (const raw of text.split('\n')) {
      const parts = raw.length > 400 ? raw.split(/(?<=[.;])\s+(?=[A-Z(])/) : [raw];
      for (const p of parts) {
        const t = p.trim();
        if (t.length >= 3) lines.push({ text: t, source, docId, kind });
      }
    }
  };
  for (const v of [form.qualifications, form.pastProjects, form.pastPublications, form.projectDescriptions]) {
    if (v) push(v, FORM, null, 'form');
  }
  for (const d of docs) push(d.text, d.filename, d.id, d.kind);
  return lines;
}

const field = <T,>(value: T, evidence: Evidence[] = []): Field<T> => ({ value, evidence });

/* ------------------------------------------------------------------ */
/* Individual fields                                                   */
/* ------------------------------------------------------------------ */

const ORG_SIGNALS = /\bour organi[sz]ation\b|\bregistered (ngo|charity|company|non-?profit)\b|board of (directors|trustees)|\bwe are a (registered|non-?profit|social enterprise|community)/i;

function applicantType(form: FormInputs, lines: Line[], docs: SourceDocument[]): Field<ApplicantType | null> {
  if (form.applicantType) return field(form.applicantType, [{ source: FORM, docId: null, quote: `Applicant type: ${form.applicantType}` }]);
  const orgDoc = docs.find((d) => d.kind === 'org_profile' || d.kind === 'annual_report');
  if (orgDoc) return field('organisation', [{ source: orgDoc.filename, docId: orgDoc.id, quote: `Uploaded as ${orgDoc.kind === 'annual_report' ? 'an annual report' : 'an organisation profile'}` }]);
  const sig = lines.find((l) => l.kind !== 'form' && ORG_SIGNALS.test(l.text));
  if (sig) return field('organisation', [ev(sig, sig.text.match(ORG_SIGNALS))]);
  if (form.persona === 'academic' || form.persona === 'student') {
    return field('individual', [{ source: FORM, docId: null, quote: `Signed up as ${form.persona === 'student' ? 'a graduate student' : 'an academic researcher'}` }]);
  }
  return field(null);
}

const LOCATION_CONTEXT = /based in|located in|address|nationality|citizen|resident|p\.?\s?o\.?\s?box|headquarter/i;

function country(form: FormInputs, lines: Line[]): Field<string | null> {
  const fromForm = form.region ? countriesIn(form.region)[0] : undefined;
  if (fromForm) return field(fromForm, [{ source: FORM, docId: null, quote: `Region: ${form.region}` }]);
  const score = new Map<string, { n: number; best: Line; weight: number }>();
  for (const l of lines) {
    for (const c of countriesIn(l.text)) {
      const w = LOCATION_CONTEXT.test(l.text) ? 3 : 1;
      const cur = score.get(c);
      if (!cur) score.set(c, { n: w, best: l, weight: w });
      else {
        cur.n += w;
        if (w > cur.weight) Object.assign(cur, { best: l, weight: w });
      }
    }
  }
  const top = [...score.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return top ? field(top[0], [ev(top[1].best)]) : field(null);
}

function region(form: FormInputs, c: Field<string | null>): Field<string | null> {
  const derived = regionOfCountry(c.value);
  if (derived) return field(derived, c.evidence);
  // The form may name a region rather than a country.
  const r = form.region?.trim();
  if (r && (isKenya(r) || isEastAfrica(r) || isAfrica(r) || isGlobalSouth(r) || /europe|america|asia|global/i.test(r))) {
    return field(r, [{ source: FORM, docId: null, quote: `Region: ${r}` }]);
  }
  return field(null);
}

const STAGE_RULES: { stage: CareerStage; re: RegExp }[] = [
  { stage: 'student', re: /\b(ph\.?d\.?|doctoral|msc|master'?s) (candidate|student|researcher in training)\b|\bgraduate student\b/i },
  { stage: 'mid', re: /\b(associate professor|senior lecturer|senior research (fellow|scientist|officer)|senior scientist)\b/i },
  { stage: 'senior', re: /\b(full professor|(?<!(assistant|associate) )professor\b|director\b|chief (scientist|executive)|head of (department|research|unit)|dean\b)/i },
  { stage: 'early', re: /\b(post-?doc(toral)?|assistant professor|lecturer|research (fellow|associate)|early[- ]career)\b/i },
];

function careerStage(lines: Line[], applicant: ApplicantType | null): Field<CareerStage | null> {
  if (applicant === 'organisation') return field(null);
  for (const { stage, re } of STAGE_RULES) {
    const hit = lines.find((l) => re.test(l.text));
    if (hit) return field(stage, [ev(hit, hit.text.match(re))]);
  }
  // Years since the PhD, when no title says it.
  const phd = lines.map((l) => ({ l, m: l.text.match(/\bph\.?\s?d\.?\b[^\n]{0,80}?\b((?:19|20)\d{2})\b/i) })).find((x) => x.m);
  if (phd?.m) {
    const years = new Date().getFullYear() - Number(phd.m[1]);
    const stage: CareerStage = years < 0 ? 'student' : years <= 7 ? 'early' : years <= 15 ? 'mid' : 'senior';
    return field(stage, [{ ...ev(phd.l, phd.m), quote: `${quote(phd.l.text, phd.m)} (PhD ${years} year${years === 1 ? '' : 's'} ago)` }]);
  }
  return field(null);
}

const DEGREE = /\b(Ph\.?\s?D|DPhil|MBChB|MBBS|M\.?D\.?(?=[\s,])|M\.?Sc|M\.?Phil|MPH|MBA|M\.?A\.?(?=[\s,])|B\.?Sc|B\.?A\.?(?=[\s,])|BEng|MEng|LLB|LLM)\b/;

function qualifications(lines: Line[]): Field<string[]> {
  const seen = new Set<string>();
  const values: string[] = [];
  const evidence: Evidence[] = [];
  for (const l of lines) {
    const m = l.text.match(DEGREE);
    if (!m) continue;
    const key = m[1]!.replace(/[.\s]/g, '').toUpperCase();
    if (seen.has(key) || l.text.length > 220) continue;
    seen.add(key);
    values.push(l.text.length > 120 ? `${l.text.slice(0, 117)}…` : l.text);
    evidence.push(ev(l, m));
    if (values.length >= 6) break;
  }
  return field(values, evidence);
}

const ORG_NAME =
  /\b((?:[A-Z][\w&.'-]*\s+){0,5}(?:University|Institute|College|Hospital|Centre|Center|Foundation|Council|Organi[sz]ation|Trust|Society|Agency|Ministry|Laboratory|Network|Alliance)(?:\s+(?:of|for|on)\s+(?:the\s+)?[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,4})?)/;

const orgNamesIn = (text: string) =>
  [...text.matchAll(new RegExp(ORG_NAME.source, 'g'))].map((m) => m[1]!.trim()).filter((n) => n.split(/\s+/).length >= 2);

function institution(form: FormInputs, lines: Line[]): Field<string | null> {
  if (form.organization?.trim()) return field(form.organization.trim(), [{ source: FORM, docId: null, quote: `Organisation: ${form.organization.trim()}` }]);
  for (const l of lines.filter((x) => x.kind === 'cv' || x.kind === 'org_profile' || x.kind === 'annual_report')) {
    const name = orgNamesIn(l.text)[0];
    if (name) return field(name, [ev(l, l.text.match(ORG_NAME))]);
  }
  return field(null);
}

function themes(form: FormInputs, lines: Line[]): Field<string[]> {
  const hits = new Map<string, Evidence[]>();
  for (const interest of form.researchInterests) {
    for (const t of THEMES.filter((th) => th.pattern.test(interest))) {
      hits.set(t.label, [...(hits.get(t.label) ?? []), { source: FORM, docId: null, quote: `Research interest: ${interest}` }]);
    }
  }
  const lineHits = new Map<string, Line[]>();
  for (const l of lines) {
    for (const t of THEMES) {
      if (t.pattern.test(l.text)) lineHits.set(t.label, [...(lineHits.get(t.label) ?? []), l]);
    }
  }
  // A theme counts when stated on the form or seen in at least two lines.
  for (const [label, ls] of lineHits) {
    if (ls.length >= 2 || hits.has(label)) {
      const t = THEMES.find((x) => x.label === label)!;
      hits.set(label, [...(hits.get(label) ?? []), ...ls.slice(0, 2).map((l) => ev(l, l.text.match(t.pattern)))]);
    }
  }
  const ranked = [...hits.entries()].sort((a, b) => (lineHits.get(b[0])?.length ?? 0) - (lineHits.get(a[0])?.length ?? 0));
  return field(
    ranked.map(([label]) => label).slice(0, 6),
    ranked.slice(0, 6).flatMap(([, e]) => e.slice(0, 2)),
  );
}

function keywords(form: FormInputs, lines: Line[]): Field<string[]> {
  const values: string[] = [];
  const evidence: Evidence[] = [];
  for (const k of form.researchInterests.map((s) => s.trim()).filter(Boolean)) {
    if (!values.some((v) => v.toLowerCase() === k.toLowerCase())) {
      values.push(k);
      evidence.push({ source: FORM, docId: null, quote: `Research interest: ${k}` });
    }
  }
  // A CV's first line is the person's name, which would otherwise top the list.
  const docText = lines
    .filter((l, i) => l.kind !== 'form' && !(l.kind === 'cv' && lines[i - 1]?.docId !== l.docId))
    .map((l) => l.text)
    .join('\n');
  for (const term of topTerms(docText, 15)) {
    if (values.length >= 20) break;
    if (values.some((v) => v.toLowerCase() === term) || countriesIn(term).length) continue;
    const l = lines.find((x) => x.text.toLowerCase().includes(term));
    if (!l) continue;
    values.push(term);
    evidence.push(ev(l, l.text.toLowerCase().match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))));
  }
  return field(values, evidence);
}

const GRANT_CUE = /\b(grant|award(ed)?|funded|funding from|fellowship|scholarship|recipient|principal investigator|\bpi\b|co-?pi)\b/i;

function pastGrants(lines: Line[]): Field<PastGrant[]> {
  const out: PastGrant[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!GRANT_CUE.test(l.text)) continue;
    const funder =
      funderIn(l.text) ??
      l.text.match(/(?:funded by|from|by)\s+(?:the\s+)?([A-Z][\w&'.-]*(?:\s+[A-Z&][\w&'.-]*){0,6})/)?.[1]?.trim() ??
      null;
    const money = moneyIn(l.text);
    if (!funder && !money) continue;
    const years = [...l.text.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]));
    const year = years.length ? Math.max(...years) : null;
    const key = `${funder ?? '?'}|${year ?? '?'}|${money?.amount ?? '?'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ funder: funder ?? 'Funder not named', amount: money?.amount ?? null, currency: money?.currency ?? 'USD', year, evidence: ev(l, l.text.match(GRANT_CUE)) });
    if (out.length >= 30) break;
  }
  return field(out, out.slice(0, 3).map((g) => g.evidence));
}

const PUB_CUE = /\bdoi\b|doi\.org|\bjournal\b|proceedings|\bvol\.?\s?\d|\bpp\.?\s?\d|\bet al\.?|lancet|plos|nature\b|\bbmj\b|elsevier|springer|wiley|press\b/i;

function publications(lines: Line[]): Field<Publication[]> {
  const out: Publication[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.text.length < 40 || l.text.length > 400 || moneyIn(l.text)) continue;
    const yearM = l.text.match(/\((19|20)\d{2}[a-z]?\)|\b(19|20)\d{2}\b/);
    const inPubList = l.kind === 'publications';
    if (!(PUB_CUE.test(l.text) && yearM) && !(inPubList && yearM)) continue;
    const key = l.text.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const year = yearM ? Number(yearM[0].replace(/\D/g, '').slice(0, 4)) : null;
    out.push({ title: l.text.length > 160 ? `${l.text.slice(0, 157)}…` : l.text, year, evidence: ev(l) });
    if (out.length >= 60) break;
  }
  return field(out, out.slice(0, 3).map((p) => p.evidence));
}

const PARTNER_CUE = /(in partnership with|partnered with|partners? (include|including|are|were)|consorti(um|a) (with|of|members?|led by|including)|collaborat(ed|ing|ion) with|jointly with|in collaboration with)/i;

function partnerships(lines: Line[]): Field<string[]> {
  const values: string[] = [];
  const evidence: Evidence[] = [];
  for (const l of lines) {
    const m = l.text.match(PARTNER_CUE);
    if (!m) continue;
    const after = l.text.slice((m.index ?? 0) + m[0].length);
    const names = orgNamesIn(after);
    const found = names.length ? names : [after.split(/[.;:]/)[0]!.trim().slice(0, 80)].filter((s) => s.length > 3);
    for (const n of found) {
      if (!values.some((v) => v.toLowerCase() === n.toLowerCase())) {
        values.push(n);
        if (evidence.length < 5) evidence.push(ev(l, m));
      }
    }
    if (values.length >= 20) break;
  }
  return field(values, evidence);
}

const REG_POS = /registered (as|under|with|in)\b|registration (no\.?|number|certificate)|ngo co-?ordination board|501\(c\)\(3\)|charity (no\.?|number)|company (no\.?|number|registration)|incorporated (in|under)|certificate of (registration|incorporation)/i;
const REG_NEG = /not (yet )?registered|unregistered|registration (is )?pending/i;

function registration(lines: Line[]): Field<{ registered: boolean; detail: string } | null> {
  const neg = lines.find((l) => REG_NEG.test(l.text));
  if (neg) return field({ registered: false, detail: quote(neg.text) }, [ev(neg, neg.text.match(REG_NEG))]);
  const pos = lines.find((l) => REG_POS.test(l.text));
  if (pos) return field({ registered: true, detail: quote(pos.text) }, [ev(pos, pos.text.match(REG_POS))]);
  return field(null);
}

const BUDGET_CUE = /(annual|yearly)\s+(budget|turnover|income|revenue|expenditure)|budget of|turnover of|total income/i;

function annualBudget(lines: Line[]): Field<{ amount: number; currency: string } | null> {
  for (const l of lines) {
    if (!BUDGET_CUE.test(l.text)) continue;
    const money = moneyIn(l.text);
    if (money) return field(money, [ev(l, l.text.match(BUDGET_CUE))]);
  }
  return field(null);
}

const TEAM = /\b(\d{1,5})\s*\+?\s*(full[- ]time\s+|part[- ]time\s+|permanent\s+)?(staff|employees|team members|personnel|researchers|people on staff)\b/i;

function teamSize(lines: Line[]): Field<number | null> {
  const hit = lines.map((l) => ({ l, m: l.text.match(TEAM) })).find((x) => x.m);
  return hit?.m ? field(Number(hit.m[1]), [ev(hit.l, hit.m)]) : field(null);
}

/* ------------------------------------------------------------------ */

/**
 * The profile read from the form and documents. Fields the user edited in
 * `previous` are kept as they are: their edit beats anything extracted.
 */
export function extractProfile(form: FormInputs, docs: SourceDocument[], previous?: StructuredProfile | null): StructuredProfile {
  const lines = toLines(form, docs);
  const type = applicantType(form, lines, docs);
  const c = country(form, lines);
  const extracted: StructuredProfile = {
    ...emptyProfile(),
    applicantType: type,
    country: c,
    region: region(form, c),
    careerStage: careerStage(lines, type.value),
    qualifications: qualifications(lines),
    institution: institution(form, lines),
    themes: themes(form, lines),
    keywords: keywords(form, lines),
    pastGrants: pastGrants(lines),
    publications: publications(lines),
    partnerships: partnerships(lines),
    registration: registration(lines),
    annualBudget: annualBudget(lines),
    teamSize: teamSize(lines),
  };
  if (!previous) return extracted;
  const merged = { ...extracted } as Record<string, Field<unknown>>;
  for (const [k, f] of Object.entries(previous) as [string, Field<unknown>][]) {
    if (f?.edited) merged[k] = f;
  }
  return merged as unknown as StructuredProfile;
}
