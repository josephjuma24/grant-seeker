import type { CompletenessItem, DocumentKind, Eligibility, FitResult, StructuredProfile } from '../shared/profile';

/** The applicant persona used for matching (the prototype called it "role"). */
export type UserRole = 'academic' | 'industry' | 'student';

/** Access tier, enforced by the API and the database. */
export type AccessRole = 'researcher' | 'grant_officer' | 'institution_admin' | 'super_admin';

export type ProposalStatus = 'draft' | 'review' | 'approved' | 'submitted' | 'awarded' | 'rejected';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  /** @deprecated same as persona; kept because the UI reads it everywhere */
  role: UserRole;
  persona: UserRole;
  accessRole: AccessRole;
  organizationId: string | null;
  /** Read-only here: joining an organisation goes through an invite code. */
  organization: string;
  emailVerified: boolean;
  region: string;
  researchInterests: string[];
  qualifications: string;
  fundingNeedsMin: number;
  pastProjects?: string;
  teamMembers?: string;
  pastPublications?: string;
  projectDescriptions?: string;
  isPublicProfile?: boolean;
  collaborationInterests?: string[];
  institution?: string;
}

export interface Funder {
  id: string;
  name: string;
  type: 'government' | 'foundation' | 'corporate' | 'international';
  website: string;
}

export type GrantLifecycle = 'active' | 'expired' | 'archived';

export interface Grant {
  id: string;
  title: string;
  subject: string;
  fundingAmount: number;
  deadline: string; // ISO String or YYYY-MM-DD
  eligibleRegions: string[];
  eligibleOrgTypes: string[];
  description: string;
  source: string; // e.g., 'Grants.gov', 'NIH RePORTER', 'NSF Awards'
  category: string; // e.g., 'Health', 'Tech', 'Energy', 'Education', 'Social Sciences'
  url: string;
  status: 'active' | 'closed';
  /** active: open; expired: closed or past deadline; archived: filed away */
  lifecycle: GrantLifecycle;
  archivedAt?: string | null;
  /** When the call ended: the earlier of its deadline and the day it closed */
  endedOn: string | null;
  /** Archived because it ended over 30 days ago (cannot be restored) */
  archivedByAge: boolean;
  /** Editions of this call seen so far, this one included */
  editionCount: number;
  /** The next cycle of this call, when the funder has published one */
  newerEditionId: string | null;
  funderId: string;
  funderName: string;
  extractedKeywords: string[];
  objectives?: string;
  requiredOutcomes?: string;
  scope?: string;
}

export interface GrantMatch {
  grantId: string;
  userId: string;
  matchScore: number; // 0 to 100
  rationale: string;
  /** Gates, weighted components and evidence; null for matches made before fit-v1. */
  fit?: FitResult | null;
  eligibility?: Eligibility | null;
  isGemini?: boolean;
  relevanceBreakdown: {
    subject: number;
    eligibility: number;
    amount: number;
    urgency: number;
  };
  feedback?: 'relevant' | 'not_relevant' | null;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
  type: 'deadline' | 'new_grant' | 'match_alert' | 'proposal_update' | 'system';
  grantId?: string;
}

export interface StatusTransition {
  id: string;
  status: ProposalStatus;
  timestamp: string;
  notes: string;
  actor: string;
}

export interface ApplicationTracker {
  id: string;
  userId: string;
  grantId: string;
  grantTitle: string;
  funderName: string;
  amount: number;
  deadline: string;
  /** review/approved only occur for proposals routed through an organisation. */
  status: ProposalStatus;
  submittedDate?: string;
  orgId: string | null;
  notes?: string;
  history?: StatusTransition[];
}

export interface ScraperLog {
  id: string;
  timestamp: string;
  source: string;
  status: 'success' | 'failed' | 'running';
  itemsExtracted: number;
  message?: string;
}

export interface HarvestStatus {
  sourcesCount: number;
  running: boolean;
  lastRunAt: string | null;
  lastRunStatus: 'ok' | 'partial' | 'failed' | null;
  lastSuccessAt: string | null;
  lastRunNewCalls: number;
}

export interface DashboardStats {
  totalActiveGrants: number;
  totalFundingAvailable: number;
  averageGrantAmount: number;
  /** Open calls closing within criticalDeadlineDays */
  upcomingDeadlinesCount: number;
  upcomingDeadlinesFunding: number;
  dueThisWeekCount: number;
  criticalDeadlineDays: number;
  /** Open calls that state an award amount (the pool and average use only these) */
  fundedGrantsCount: number;
  activeFundersCount: number;
  newThisWeekCount: number;
  harvest: HarvestStatus | null;
  generatedAt: string;
  /** Closed or past deadline, not yet archived */
  expiredGrantsCount: number;
  expiredFunding: number;
  /** Expired calls that move to the archive within the next 7 days */
  archivingSoonCount: number;
  /** Days after a call ends before it is archived */
  archiveAfterDays: number;
  archivedGrantsCount: number;
  matchedGrantsCount: number;
  /** null until at least one proposal is awarded or rejected */
  successRate: number | null;
  funderDistribution: { name: string; value: number }[];
  categoryDistribution: { name: string; value: number }[];
  timelineData: { date: string; count: number; amount: number }[];
}

export interface Consortium {
  id: string;
  name: string;
  description: string;
  creatorId: string;
  creatorName: string;
  /** Empty unless you are a member: outsiders see only memberCount. */
  memberIds: string[];
  memberCount: number;
  grantIds: string[]; // collectives grant tracking
  isPrivate: boolean;
  isOwner: boolean;
  createdAt: string;
}

export interface TeamMessage {
  id: string;
  teamId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
}

export interface TeamSharedGrant {
  id: string;
  teamId: string;
  grantId: string;
  sharedById: string;
  sharedByName: string;
  notes?: string;
  status: 'planning' | 'draft' | 'submitted' | 'awarded' | 'rejected';
  timestamp: string;
}


/* Research office (grant officers and institution admins) ------------ */

export interface OfficeProposal {
  id: string;
  ownerId: string;
  ownerName: string;
  grantId: string | null;
  grantTitle: string;
  funderName: string;
  title: string;
  status: ProposalStatus;
  amount: number | null;
  deadline: string | null;
  submittedDate: string | null;
  notes: string;
  updatedAt: string;
  history: StatusTransition[];
}

export interface BudgetLine {
  id: string;
  category: string;
  description: string | null;
  year: number;
  amount: number;
}

export interface Budget {
  id: string;
  status: 'draft' | 'approved';
  currency: string;
  approvedBy: string | null;
  approvedAt: string | null;
  total: number;
  lines: BudgetLine[];
}

export interface Organization {
  id: string;
  name: string;
  type: string;
  region: string | null;
  status: 'pending' | 'active' | 'suspended';
  /** Officers and up only. */
  memberCount?: number;
  /** Institution admins only. */
  inviteCode?: string | null;
}

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  accessRole: AccessRole;
  persona: UserRole;
  emailVerified: boolean;
  suspended: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** The automatic scan schedule (AI Web Scraper Panel). */
export interface ScraperSchedule {
  cron: string;
  timezone: string;
  description: string;
  nextRuns: string[];
  workerOnline: boolean;
  lastAutomatic: {
    id: string;
    status: 'running' | 'ok' | 'partial' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    itemsFound: number;
    itemsNew: number;
  } | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
}

/* Smart profile ------------------------------------------------------ */

export interface ProfileDocument {
  id: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  pages: number | null;
  characters: number;
  createdAt: string;
}

export interface SmartProfilePayload {
  profile: StructuredProfile;
  completeness: { percent: number; items: CompletenessItem[] };
  documents: ProfileDocument[];
  extractedAt: string | null;
  updatedAt: string;
  /** Matches rescored by the change that returned this payload. */
  rescored?: number;
}

export interface SmartMatch {
  match: GrantMatch;
  grant: Grant;
}

export interface SmartMatchList {
  matches: SmartMatch[];
  counts: Record<Eligibility, number>;
}

/* Applying from a match ---------------------------------------------- */

export type AssistantMode = 'eligibility' | 'outline' | 'collaborators' | 'feedback';

export interface ChecklistItem {
  text: string;
  done: boolean;
}

/** proposals.body for an application started from a match. */
export interface ApplicationBody {
  origin?: 'smart_match';
  fitAtStart?: { score: number; eligibility: Eligibility; version: string; at: string };
  checklist?: ChecklistItem[];
  drafts?: Partial<Record<AssistantMode, { text: string; simulated: boolean; generatedAt: string }>>;
}

export interface ApplicationContext {
  grant: Grant;
  fit: FitResult | null;
  proposal: { id: string; status: string; title: string; body: ApplicationBody | null } | null;
  hasProfile: boolean;
}

/* General settings ---------------------------------------------------- */

export interface SessionInfo {
  familyId: string;
  userAgent: string | null;
  ip: string | null;
  lastUsedAt: string;
  expiresAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  accessRole: AccessRole;
  organization: string | null;
  emailVerifiedAt: string | null;
  suspendedAt: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** How GrantSeeker applies least privilege (server: lib/accessPolicy.ts). */
export interface AccessPolicy {
  registrationMode: 'open' | 'invite_only';
  institutionAdminMaxRole: 'researcher' | 'grant_officer';
  requireReasonToElevate: boolean;
  dormantAfterDays: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AccessReview {
  dormantAfterDays: number;
  totalUsers: number;
  privileged: (Pick<AdminUser, 'id' | 'name' | 'email' | 'accessRole' | 'organization' | 'lastLoginAt' | 'createdAt' | 'suspendedAt'> & { dormant: boolean })[];
  counts: { super_admin: number; institution_admin: number; grant_officer: number; dormant: number };
}

/* Call history: every edition of a recurring call and what changed */

export interface CallEdition {
  key: string;
  grantId: string;
  /** listing: a call in the catalogue; revision: an earlier version of a call's page */
  kind: 'listing' | 'revision';
  title: string;
  funderName: string | null;
  category: string | null;
  amount: number | null;
  currency: string;
  deadline: string | null;
  eligibleRegions: string[];
  eligibleOrgTypes: string[];
  lifecycle: GrantLifecycle | 'superseded';
  url: string;
  referenceCodes: string[];
  seenAt: string | null;
  isCurrent: boolean;
  duplicateIds: string[];
}

export type CallFieldChange =
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

export interface CallComparison {
  from: string;
  to: string;
  highlights: string[];
  changes: CallFieldChange[];
}

export interface CallHistory {
  current: string;
  editions: CallEdition[];
  comparisons: CallComparison[];
}
