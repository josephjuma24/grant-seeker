import { sql, type SQL } from 'drizzle-orm';
import type { DocumentKind, Eligibility, FitResult, StructuredProfile } from '../../shared/profile.ts';
import {
  bigserial,
  boolean,
  char,
  customType,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ */
/* Custom column types                                                 */
/* ------------------------------------------------------------------ */

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const EMBEDDING_DIMENSIONS = 768;

/* ------------------------------------------------------------------ */
/* Roles & RBAC tiers                                                  */
/* ------------------------------------------------------------------ */

// Database roles, created by sql/000_bootstrap.sql. `.existing()` keeps
// drizzle-kit from trying to create or drop them.
export const appRole = pgRole('gs_app').existing();
export const workerRole = pgRole('gs_worker').existing();

export const USER_ROLES = [
  'researcher',
  'grant_officer',
  'institution_admin',
  'super_admin',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

// `guest` is never stored: it is the level of a signed-out or unverified
// session. Levels leave gaps so a tier can be inserted later.
export const ROLE_LEVEL = {
  guest: 10,
  researcher: 20,
  grant_officer: 30,
  institution_admin: 40,
  super_admin: 50,
} as const satisfies Record<UserRole | 'guest', number>;
export type RoleOrGuest = keyof typeof ROLE_LEVEL;

// Set by withSystemTx() for the auth service and the worker. Above every
// human tier, so `app.level() >= 50` policies admit it.
export const SYSTEM_LEVEL = 100;

export const userRoleEnum = pgEnum('user_role', USER_ROLES);

// What kind of applicant someone is, used for matching. Unrelated to
// access: the prototype's `role` field held this value.
export const PERSONAS = ['academic', 'industry', 'student'] as const;
export type Persona = (typeof PERSONAS)[number];
export const personaEnum = pgEnum('persona', PERSONAS);
export const orgTypeEnum = pgEnum('org_type', [
  'university',
  'research_institute',
  'nonprofit',
  'company',
  'government',
  'individual',
]);
export const orgStatusEnum = pgEnum('org_status', ['pending', 'active', 'suspended']);
export const funderTypeEnum = pgEnum('funder_type', [
  'government',
  'foundation',
  'corporate',
  'international',
]);
export const grantStatusEnum = pgEnum('grant_status', ['active', 'closed']);
export const matchFeedbackEnum = pgEnum('match_feedback', ['relevant', 'not_relevant']);
export const proposalStatusEnum = pgEnum('proposal_status', [
  'draft',
  'review',
  'approved',
  'submitted',
  'awarded',
  'rejected',
]);
export const budgetStatusEnum = pgEnum('budget_status', ['draft', 'approved']);
export const budgetCategoryEnum = pgEnum('budget_category', [
  'personnel',
  'equipment',
  'travel',
  'materials',
  'subcontracts',
  'indirect',
  'other',
]);
export const teamRoleEnum = pgEnum('team_role', ['lead', 'member']);
export const teamGrantStatusEnum = pgEnum('team_grant_status', [
  'planning',
  'draft',
  'submitted',
  'awarded',
  'rejected',
]);
export const notificationTypeEnum = pgEnum('notification_type', [
  'deadline',
  'new_grant',
  'match_alert',
  'proposal_update',
  'system',
]);
export const scraperTriggerEnum = pgEnum('scraper_trigger', ['cron', 'manual']);
export const applicantTypeEnum = pgEnum('applicant_type', ['individual', 'organisation']);
export const documentKindEnum = pgEnum('document_kind', [
  'cv',
  'publications',
  'proposal',
  'org_profile',
  'annual_report',
  'other',
] as const satisfies readonly DocumentKind[]);
export const eligibilityEnum = pgEnum('match_eligibility', ['eligible', 'check', 'ineligible'] as const satisfies readonly Eligibility[]);

export const scraperStatusEnum = pgEnum('scraper_status', [
  'running',
  'ok',
  'partial',
  'failed',
]);

/* ------------------------------------------------------------------ */
/* RLS helpers                                                         */
/* ------------------------------------------------------------------ */

// app.uid(), app.org() and app.level() read transaction-local settings
// written by withUserTx()/withSystemTx() in db/index.ts.
const uid = sql`app.uid()`;
const org = sql`app.org()`;
const level = sql`app.level()`;
const atLeast = (n: number): SQL => sql`${level} >= ${sql.raw(String(n))}`;

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const id = () => uuid('id').primaryKey().defaultRandom();

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text('name').notNull(),
    type: orgTypeEnum('type').notNull().default('university'),
    region: text('region'),
    inviteCode: text('invite_code').unique(),
    status: orgStatusEnum('status').notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    pgPolicy('organizations_read', {
      for: 'select',
      to: appRole,
      using: sql`${t.id} = ${org} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    pgPolicy('organizations_write', {
      for: 'all',
      to: appRole,
      using: sql`(${t.id} = ${org} and ${atLeast(ROLE_LEVEL.institution_admin)}) or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
  ],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    legacyId: text('legacy_id').unique(),
    email: citext('email').notNull().unique(),
    passwordHash: text('password_hash'),
    // Google account id (OIDC sub) once the user has signed in with Google.
    googleSub: text('google_sub').unique(),
    role: userRoleEnum('role').notNull().default('researcher'),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    persona: personaEnum('persona').notNull().default('academic'),
    region: text('region'),
    researchInterests: text('research_interests').array().notNull().default(sql`'{}'::text[]`),
    collaborationInterests: text('collaboration_interests')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    qualifications: text('qualifications'),
    fundingNeedsMin: numeric('funding_needs_min', { precision: 14, scale: 2, mode: 'number' }),
    pastProjects: text('past_projects'),
    pastPublications: text('past_publications'),
    projectDescriptions: text('project_descriptions'),
    teamMembers: text('team_members'),
    isPublicProfile: boolean('is_public_profile').notNull().default(false),
    profileEmbedding: vector('profile_embedding', { dimensions: EMBEDDING_DIMENSIONS }),

    // Bumped on logout-all, password change and suspension: every access
    // token carrying an older `tv` claim is rejected.
    tokenVersion: integer('token_version').notNull().default(0),
    failedLogins: smallint('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('users_org_idx').on(t.orgId),
    pgPolicy('users_read', {
      for: 'select',
      to: appRole,
      using: sql`${t.id} = ${uid}
        or (${t.orgId} = ${org} and ${atLeast(ROLE_LEVEL.grant_officer)})
        or (${t.isPublicProfile} and ${atLeast(ROLE_LEVEL.researcher)})
        or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    // Which rows may be updated. Which *columns* may change (role, org,
    // lockout and session fields) is guarded by app.users_guard() in
    // sql/900_hardening.sql, since a policy cannot compare old and new.
    pgPolicy('users_update', {
      for: 'update',
      to: appRole,
      using: sql`${t.id} = ${uid}
        or (${t.orgId} = ${org} and ${atLeast(ROLE_LEVEL.institution_admin)})
        or ${atLeast(ROLE_LEVEL.super_admin)}`,
      // An institution admin may also remove a member (org_id → null).
      withCheck: sql`${t.id} = ${uid}
        or ((${t.orgId} = ${org} or ${t.orgId} is null) and ${atLeast(ROLE_LEVEL.institution_admin)})
        or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    // Sign-up runs under withSystemTx().
    pgPolicy('users_insert', {
      for: 'insert',
      to: appRole,
      withCheck: atLeast(ROLE_LEVEL.super_admin),
    }),
    // The matcher reads profiles; column grants in sql/900_hardening.sql
    // keep password_hash and lockout fields out of its reach.
    pgPolicy('users_worker_read', { for: 'select', to: workerRole, using: sql`true` }),
    // Writes back re-embedded profiles; the column grant limits it to that.
    pgPolicy('users_worker_embed', { for: 'update', to: workerRole, using: sql`true` }),
  ],
);

// Only the auth service touches this table, always via withSystemTx().
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by'),
    // false: 'Keep me signed in' was off; a browser-session cookie and a short expiry.
    persistent: boolean('persistent').notNull().default(true),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.userId),
    pgPolicy('refresh_tokens_system', {
      for: 'all',
      to: appRole,
      using: atLeast(SYSTEM_LEVEL),
    }),
  ],
);

/**
 * System-wide settings, one JSON document per key (validated by the code
 * that owns it, e.g. lib/accessPolicy.ts). Super admins only.
 */
export const systemSettings = pgTable(
  'system_settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('system_settings_admin', {
      for: 'all',
      to: appRole,
      using: atLeast(ROLE_LEVEL.super_admin),
    }),
  ],
);

/**
 * One-time password reset links. Only a hash of the token is stored, so a
 * leaked table cannot be used to reset anyone's password.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedIp: inet('requested_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('password_reset_tokens_user_idx').on(t.userId),
    pgPolicy('password_reset_tokens_system', {
      for: 'all',
      to: appRole,
      using: atLeast(SYSTEM_LEVEL),
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export const funders = pgTable(
  'funders',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    type: funderTypeEnum('type').notNull(),
    website: text('website'),
    scrapeConfig: jsonb('scrape_config').$type<Record<string, unknown>>(),
    ...timestamps,
  },
  () => [
    pgPolicy('funders_read', { for: 'select', to: [appRole, workerRole], using: sql`true` }),
    pgPolicy('funders_write', {
      for: 'all',
      to: appRole,
      using: atLeast(ROLE_LEVEL.super_admin),
    }),
  ],
);

export const grants = pgTable(
  'grants',
  {
    id: id(),
    legacyId: text('legacy_id').unique(),
    funderId: uuid('funder_id').references(() => funders.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    subject: text('subject'),
    category: text('category'),
    description: text('description').notNull().default(''),
    objectives: text('objectives'),
    requiredOutcomes: text('required_outcomes'),
    scope: text('scope'),
    amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    deadline: date('deadline'),
    eligibleRegions: text('eligible_regions').array().notNull().default(sql`'{}'::text[]`),
    eligibleOrgTypes: text('eligible_org_types').array().notNull().default(sql`'{}'::text[]`),
    status: grantStatusEnum('status').notNull().default('active'),
    source: text('source'),
    url: text('url').notNull().unique(),
    contentHash: bytea('content_hash'),
    keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    // Bare column names: a generation expression may not qualify them with
    // the table name, which ${grants.title} would render.
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(subject, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')`,
    ),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('grants_deadline_idx').on(t.deadline),
    index('grants_status_idx').on(t.status),
    index('grants_funder_idx').on(t.funderId),
    index('grants_regions_idx').using('gin', t.eligibleRegions),
    index('grants_search_idx').using('gin', t.search),
    index('grants_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    pgPolicy('grants_read', { for: 'select', to: [appRole, workerRole], using: sql`true` }),
    pgPolicy('grants_write_app', {
      for: 'all',
      to: appRole,
      using: atLeast(ROLE_LEVEL.super_admin),
    }),
    pgPolicy('grants_write_worker', { for: 'all', to: workerRole, using: sql`true` }),
  ],
);

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export type RelevanceBreakdown = {
  subject: number;
  eligibility: number;
  amount: number;
  urgency: number;
};

export const grantMatches = pgTable(
  'grant_matches',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    score: smallint('score').notNull(),
    similarity: real('similarity'),
    rationale: text('rationale'),
    breakdown: jsonb('breakdown').$type<RelevanceBreakdown>(),
    // null = algorithmic fallback; otherwise the model that reranked it.
    model: text('model'),
    feedback: matchFeedbackEnum('feedback'),
    // The full explanation: hard gates, weighted components and the
    // profile evidence each relied on (see shared/profile.ts FitResult).
    fit: jsonb('fit').$type<FitResult>(),
    eligibility: eligibilityEnum('eligibility'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.grantId] }),
    index('grant_matches_user_score_idx').on(t.userId, t.score.desc()),
    pgPolicy('grant_matches_owner', {
      for: 'all',
      to: appRole,
      using: sql`${t.userId} = ${uid} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    pgPolicy('grant_matches_worker', { for: 'all', to: workerRole, using: sql`true` }),
  ],
);

/* ------------------------------------------------------------------ */
/* Smart profile                                                       */
/* ------------------------------------------------------------------ */

/**
 * Documents a user uploaded to build their profile. Only the extracted
 * text is kept, never the original file: enough to re-read the profile
 * and to show where each value came from.
 */
export const profileDocuments = pgTable(
  'profile_documents',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: documentKindEnum('kind').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: bytea('sha256').notNull(),
    pages: smallint('pages'),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('profile_documents_user_sha_uq').on(t.userId, t.sha256),
    pgPolicy('profile_documents_owner', {
      for: 'all',
      to: appRole,
      using: sql`${t.userId} = ${uid} or ${atLeast(ROLE_LEVEL.super_admin)}`,
      withCheck: sql`${t.userId} = ${uid}`,
    }),
  ],
);

/** The structured profile extracted from the form and documents, with evidence per field. */
export const applicantProfiles = pgTable(
  'applicant_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicantType: applicantTypeEnum('applicant_type'),
    data: jsonb('data').$type<StructuredProfile>().notNull(),
    completeness: smallint('completeness').notNull().default(0),
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    pgPolicy('applicant_profiles_owner', {
      for: 'all',
      to: appRole,
      using: sql`${t.userId} = ${uid} or ${atLeast(ROLE_LEVEL.super_admin)}`,
      withCheck: sql`${t.userId} = ${uid} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    // The matcher scores new grants against every profile.
    pgPolicy('applicant_profiles_worker_read', { for: 'select', to: workerRole, using: sql`true` }),
  ],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    note: text('note'),
    remindAt: timestamp('remind_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.grantId] }),
    pgPolicy('bookmarks_owner', {
      for: 'all',
      to: appRole,
      using: sql`${t.userId} = ${uid} or ${atLeast(ROLE_LEVEL.super_admin)}`,
      withCheck: sql`${t.userId} = ${uid}`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* Institutional: proposals & budgets                                  */
/* ------------------------------------------------------------------ */

export const proposals = pgTable(
  'proposals',
  {
    id: id(),
    legacyId: text('legacy_id').unique(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    grantId: uuid('grant_id').references(() => grants.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: proposalStatusEnum('status').notNull().default('draft'),
    body: jsonb('body').$type<Record<string, unknown>>(),
    notes: text('notes'),
    requestedAmount: numeric('requested_amount', { precision: 14, scale: 2, mode: 'number' }),
    deadline: date('deadline'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('proposals_owner_idx').on(t.ownerId),
    index('proposals_org_status_idx').on(t.orgId, t.status),
    pgPolicy('proposals_access', {
      for: 'all',
      to: appRole,
      using: sql`${t.ownerId} = ${uid}
        or (${t.orgId} = ${org} and ${atLeast(ROLE_LEVEL.grant_officer)})
        or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
  ],
);

export const proposalEvents = pgTable(
  'proposal_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    fromStatus: proposalStatusEnum('from_status'),
    toStatus: proposalStatusEnum('to_status').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('proposal_events_proposal_idx').on(t.proposalId),
    // The subquery is itself filtered by proposals' policy, so access
    // follows the parent proposal.
    pgPolicy('proposal_events_via_proposal', {
      for: 'all',
      to: appRole,
      using: sql`exists (select 1 from proposals p where p.id = ${t.proposalId})`,
    }),
  ],
);

export const budgets = pgTable(
  'budgets',
  {
    id: id(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    status: budgetStatusEnum('status').notNull().default('draft'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('budgets_proposal_idx').on(t.proposalId),
    pgPolicy('budgets_via_proposal', {
      for: 'all',
      to: appRole,
      using: sql`exists (select 1 from proposals p where p.id = ${t.proposalId})`,
    }),
  ],
);

export const budgetLines = pgTable(
  'budget_lines',
  {
    id: id(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    category: budgetCategoryEnum('category').notNull(),
    description: text('description'),
    year: smallint('year').notNull().default(1),
    amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
    ...timestamps,
  },
  (t) => [
    index('budget_lines_budget_idx').on(t.budgetId),
    pgPolicy('budget_lines_via_budget', {
      for: 'all',
      to: appRole,
      using: sql`exists (select 1 from budgets b where b.id = ${t.budgetId})`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* Collaboration                                                       */
/* ------------------------------------------------------------------ */

// app.is_team_member() is SECURITY DEFINER (sql/000_bootstrap.sql) so the
// team_members policy can consult team_members without recursing.
const isMember = (teamId: SQL | unknown) => sql`app.is_team_member(${teamId})`;

export const teams = pgTable(
  'teams',
  {
    id: id(),
    legacyId: text('legacy_id').unique(),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    isPrivate: boolean('is_private').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    pgPolicy('teams_read', {
      for: 'select',
      to: appRole,
      // The owner too: INSERT … RETURNING checks the new row against this
      // policy before the creator's membership row exists.
      using: sql`not ${t.isPrivate} or ${t.ownerId} = ${uid} or ${isMember(t.id)} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    pgPolicy('teams_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.ownerId} = ${uid}`,
    }),
    // An owner may hand the team to another member when leaving; the route
    // checks the new owner is a member.
    pgPolicy('teams_owner_write', {
      for: 'update',
      to: appRole,
      using: sql`${t.ownerId} = ${uid} or ${atLeast(ROLE_LEVEL.super_admin)}`,
      withCheck: sql`${isMember(t.id)} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    pgPolicy('teams_owner_delete', {
      for: 'delete',
      to: appRole,
      using: sql`${t.ownerId} = ${uid} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamRoleEnum('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    index('team_members_user_idx').on(t.userId),
    pgPolicy('team_members_read', {
      for: 'select',
      to: appRole,
      using: sql`${isMember(t.teamId)} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    // Joining: yourself, and only a public team. Adding someone else: the
    // team's owner only. Leaving: yourself; removing others: the owner.
    pgPolicy('team_members_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`(${t.userId} = ${uid}
          and exists (select 1 from teams tm where tm.id = ${t.teamId} and not tm.is_private))
        or exists (select 1 from teams tm where tm.id = ${t.teamId} and tm.owner_id = ${uid})
        or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    pgPolicy('team_members_update', {
      for: 'update',
      to: appRole,
      using: sql`exists (select 1 from teams tm where tm.id = ${t.teamId} and tm.owner_id = ${uid})
        or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    pgPolicy('team_members_delete', {
      for: 'delete',
      to: appRole,
      using: sql`${t.userId} = ${uid}
        or exists (select 1 from teams tm where tm.id = ${t.teamId} and tm.owner_id = ${uid})
        or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
  ],
);

export const teamMessages = pgTable(
  'team_messages',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('team_messages_team_idx').on(t.teamId, t.createdAt),
    // Members read and post; only the author may edit or delete a message.
    pgPolicy('team_messages_read', {
      for: 'select',
      to: appRole,
      using: sql`${isMember(t.teamId)} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    pgPolicy('team_messages_post', {
      for: 'insert',
      to: appRole,
      withCheck: sql`${isMember(t.teamId)} and ${t.authorId} = ${uid}`,
    }),
    pgPolicy('team_messages_own_update', {
      for: 'update',
      to: appRole,
      using: sql`${t.authorId} = ${uid}`,
    }),
    pgPolicy('team_messages_own_delete', {
      for: 'delete',
      to: appRole,
      using: sql`${t.authorId} = ${uid} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
  ],
);

export const teamGrants = pgTable(
  'team_grants',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    sharedBy: uuid('shared_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    status: teamGrantStatusEnum('status').notNull().default('planning'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('team_grants_team_grant_uq').on(t.teamId, t.grantId),
    pgPolicy('team_grants_members', {
      for: 'all',
      to: appRole,
      using: isMember(t.teamId),
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* Activity & operations                                               */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    grantId: uuid('grant_id').references(() => grants.id, { onDelete: 'set null' }),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt.desc()),
    pgPolicy('notifications_owner', {
      for: 'all',
      to: appRole,
      using: sql`${t.userId} = ${uid} or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
    // A grant officer notifying an org member about their proposal. The
    // users subquery is itself RLS-filtered to rows the officer can see.
    pgPolicy('notifications_org_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`${atLeast(ROLE_LEVEL.grant_officer)}
        and exists (select 1 from users u where u.id = ${t.userId} and u.org_id = ${org})`,
    }),
    pgPolicy('notifications_worker', { for: 'insert', to: workerRole, withCheck: sql`true` }),
  ],
);

export const scraperRuns = pgTable(
  'scraper_runs',
  {
    id: id(),
    trigger: scraperTriggerEnum('trigger').notNull(),
    source: text('source'),
    status: scraperStatusEnum('status').notNull().default('running'),
    itemsFound: integer('items_found').notNull().default(0),
    itemsNew: integer('items_new').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('scraper_runs_started_idx').on(t.startedAt.desc()),
    pgPolicy('scraper_runs_admin', {
      for: 'all',
      to: appRole,
      using: atLeast(ROLE_LEVEL.super_admin),
    }),
    pgPolicy('scraper_runs_worker', { for: 'all', to: workerRole, using: sql`true` }),
  ],
);

// Append-only. UPDATE/DELETE are revoked and blocked by a trigger, and
// prev_hash/hash are filled by a BEFORE INSERT trigger
// (sql/900_hardening.sql), so a rewritten row breaks the chain.
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorLevel: smallint('actor_level'),
    orgId: uuid('org_id'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    requestId: uuid('request_id'),
    ip: inet('ip'),
    diff: jsonb('diff').$type<Record<string, unknown>>(),
    prevHash: bytea('prev_hash'),
    hash: bytea('hash'),
  },
  (t) => [
    index('audit_log_actor_idx').on(t.actorId, t.at.desc()),
    index('audit_log_org_idx').on(t.orgId, t.at.desc()),
    pgPolicy('audit_log_insert', {
      for: 'insert',
      to: [appRole, workerRole],
      withCheck: sql`true`,
    }),
    pgPolicy('audit_log_read', {
      for: 'select',
      to: appRole,
      using: sql`${t.actorId} = ${uid}
        or (${t.orgId} = ${org} and ${atLeast(ROLE_LEVEL.grant_officer)})
        or ${atLeast(ROLE_LEVEL.super_admin)}`,
    }),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Grant = typeof grants.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
