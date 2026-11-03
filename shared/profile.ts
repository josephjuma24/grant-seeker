// The structured applicant profile and match explanations, shared by the
// API and the browser. Every value carries the evidence it came from, so
// any score built on it can be traced back to a document line or a form
// field. Pure: no imports from server or browser code.

export type ApplicantType = 'individual' | 'organisation';
export type CareerStage = 'student' | 'early' | 'mid' | 'senior';
export type DocumentKind = 'cv' | 'publications' | 'proposal' | 'org_profile' | 'annual_report' | 'other';

export const DOCUMENT_KINDS: { id: DocumentKind; label: string }[] = [
  { id: 'cv', label: 'CV / résumé' },
  { id: 'publications', label: 'Publications list' },
  { id: 'proposal', label: 'Past proposal' },
  { id: 'org_profile', label: 'Organisation profile' },
  { id: 'annual_report', label: 'Annual report' },
  { id: 'other', label: 'Other' },
];

export const CAREER_STAGE_LABEL: Record<CareerStage, string> = {
  student: 'Student / PhD candidate',
  early: 'Early career',
  mid: 'Mid career',
  senior: 'Senior / established',
};

/** Where a value came from: a quoted line in an uploaded document, the sign-up form, or the user's own edit. */
export interface Evidence {
  source: string; // file name, "Profile form" or "Edited by you"
  docId: string | null;
  quote: string;
}

export interface Field<T> {
  value: T;
  evidence: Evidence[];
  /** Set by the user: never overwritten when documents are re-read. */
  edited?: boolean;
}

export interface PastGrant {
  funder: string;
  amount: number | null;
  currency: string;
  year: number | null;
  evidence: Evidence;
}

export interface Publication {
  title: string;
  year: number | null;
  evidence: Evidence;
}

export interface StructuredProfile {
  applicantType: Field<ApplicantType | null>;
  country: Field<string | null>;
  region: Field<string | null>;
  careerStage: Field<CareerStage | null>;
  qualifications: Field<string[]>;
  institution: Field<string | null>;
  themes: Field<string[]>;
  keywords: Field<string[]>;
  pastGrants: Field<PastGrant[]>;
  publications: Field<Publication[]>;
  partnerships: Field<string[]>;
  registration: Field<{ registered: boolean; detail: string } | null>;
  annualBudget: Field<{ amount: number; currency: string } | null>;
  teamSize: Field<number | null>;
}

export type ProfileFieldKey = keyof StructuredProfile;

export const emptyField = <T,>(value: T): Field<T> => ({ value, evidence: [] });

export function emptyProfile(): StructuredProfile {
  return {
    applicantType: emptyField(null),
    country: emptyField(null),
    region: emptyField(null),
    careerStage: emptyField(null),
    qualifications: emptyField([]),
    institution: emptyField(null),
    themes: emptyField([]),
    keywords: emptyField([]),
    pastGrants: emptyField([]),
    publications: emptyField([]),
    partnerships: emptyField([]),
    registration: emptyField(null),
    annualBudget: emptyField(null),
    teamSize: emptyField(null),
  };
}

/* ------------------------------------------------------------------ */
/* Completeness                                                        */
/* ------------------------------------------------------------------ */

export interface CompletenessItem {
  key: ProfileFieldKey | 'documents';
  label: string;
  weight: number;
  done: boolean;
  /** What to do to complete it. */
  prompt: string;
}

const has = (f: Field<unknown>) =>
  Array.isArray(f.value) ? f.value.length > 0 : f.value !== null && f.value !== undefined && f.value !== '';

/** Weighted checklist (sums to 100). Organisations and individuals need different evidence. */
export function profileCompleteness(p: StructuredProfile, documentCount: number): { percent: number; items: CompletenessItem[] } {
  const org = p.applicantType.value === 'organisation';
  const items: CompletenessItem[] = [
    { key: 'applicantType', label: 'Applicant type', weight: 10, done: has(p.applicantType), prompt: 'Say whether you apply as an individual researcher or an organisation.' },
    { key: 'country', label: 'Country', weight: 10, done: has(p.country), prompt: 'Add your country: it decides geographic eligibility.' },
    org
      ? { key: 'registration', label: 'Registration status', weight: 10, done: has(p.registration), prompt: 'Upload your registration certificate or organisation profile.' }
      : { key: 'careerStage', label: 'Career stage', weight: 10, done: has(p.careerStage), prompt: 'Upload your CV so your career stage can be detected.' },
    org
      ? { key: 'teamSize', label: 'Team size', weight: 5, done: has(p.teamSize), prompt: 'Upload an organisation profile that states your staff numbers.' }
      : { key: 'qualifications', label: 'Qualifications', weight: 5, done: has(p.qualifications), prompt: 'Upload your CV to list your qualifications.' },
    { key: 'institution', label: org ? 'Organisation name' : 'Institution', weight: 5, done: has(p.institution), prompt: 'Add your institution or organisation.' },
    { key: 'themes', label: 'Thematic areas', weight: 15, done: has(p.themes), prompt: 'Upload a CV, proposal or publications list so your research themes can be found.' },
    { key: 'keywords', label: 'Keywords', weight: 10, done: p.keywords.value.length >= 3, prompt: 'Add at least three research keywords.' },
    { key: 'pastGrants', label: 'Past grants', weight: 15, done: has(p.pastGrants), prompt: 'Upload a CV or past proposal listing grants you have received.' },
    org
      ? { key: 'annualBudget', label: 'Annual budget', weight: 10, done: has(p.annualBudget), prompt: 'Upload an annual report so your budget size can be compared with award sizes.' }
      : { key: 'publications', label: 'Publications', weight: 10, done: has(p.publications), prompt: 'Upload your publications list.' },
    { key: 'partnerships', label: 'Partnerships', weight: 5, done: has(p.partnerships), prompt: 'Add partners or consortia you have worked with.' },
    { key: 'documents', label: 'Supporting documents', weight: 5, done: documentCount > 0, prompt: 'Upload at least one document (CV, publications, proposal, organisation profile or annual report).' },
  ];
  const percent = items.reduce((sum, i) => sum + (i.done ? i.weight : 0), 0);
  return { percent, items };
}

/* ------------------------------------------------------------------ */
/* Match explanation                                                   */
/* ------------------------------------------------------------------ */

export type GateStatus = 'pass' | 'fail' | 'unknown';
export type Eligibility = 'eligible' | 'check' | 'ineligible';
export type ScoreBand = 'high' | 'medium' | 'low';

export interface GateResult {
  key: 'geography' | 'applicantType' | 'careerStage' | 'registration';
  label: string;
  status: GateStatus;
  detail: string;
  evidence: Evidence[];
}

export interface ComponentResult {
  key: 'thematic' | 'trackRecord' | 'capacity' | 'partnership' | 'deadline' | 'funderHistory';
  label: string;
  /** Share of the total, e.g. 0.35 */
  weight: number;
  /** 0–100 for this component */
  score: number;
  /** weight × score, the points it adds to the total */
  points: number;
  detail: string;
  evidence: Evidence[];
  /** The grant text the component was compared with. */
  grantEvidence: string | null;
}

export interface FitResult {
  version: string;
  score: number;
  band: ScoreBand;
  eligibility: Eligibility;
  gates: GateResult[];
  components: ComponentResult[];
  /** 2–3 sentences citing profile evidence. */
  explanation: string;
  gaps: string[];
}

export const bandFor = (score: number): ScoreBand => (score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low');
