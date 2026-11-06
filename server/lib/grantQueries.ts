import { getTableColumns, sql } from 'drizzle-orm';

import { funders, grants, type Grant } from '../db/schema.ts';

// Every grant column except the 768-float embedding and the tsvector,
// which are large and only ever used inside SQL.
const { embedding: _embedding, search: _search, ...leanGrantColumns } = getTableColumns(grants);

/* ------------------------------------------------------------------ */
/* Lifecycle: active → expired → archived                              */
/* ------------------------------------------------------------------ */

export const GRANT_LIFECYCLES = ['active', 'expired', 'archived'] as const;
export type GrantLifecycle = (typeof GRANT_LIFECYCLES)[number];

/**
 * A call is expired once it is closed or its deadline has passed, even
 * before housekeeping flips its status. Archived calls are expired calls an
 * admin (or the auto-archive policy) has filed away.
 */
export const isArchived = sql`${grants.archivedAt} is not null`;
export const isExpired = sql`(${grants.archivedAt} is null and (${grants.status} = 'closed' or ${grants.deadline} < current_date))`;
export const isLive = sql`(${grants.archivedAt} is null and ${grants.status} = 'active' and (${grants.deadline} is null or ${grants.deadline} >= current_date))`;

export const lifecycleFilter: Record<GrantLifecycle, ReturnType<typeof sql>> = {
  active: isLive,
  expired: isExpired,
  archived: isArchived,
};

export const grantLifecycle = sql<GrantLifecycle>`case when ${isArchived} then 'archived' when ${isExpired} then 'expired' else 'active' end`;

/** Select list for grant rows joined to funders (left join on funder_id). */
export const grantRowColumns = {
  ...leanGrantColumns,
  funderName: funders.name,
  hasEmbedding: sql<boolean>`${grants.embedding} is not null`.as('has_embedding'),
  lifecycle: grantLifecycle.as('lifecycle'),
};

export type GrantRow = Omit<Grant, 'embedding' | 'search'> & {
  funderName: string | null;
  hasEmbedding: boolean;
  lifecycle: GrantLifecycle;
};

/** pgvector literal for a JS embedding: '[0.1,0.2,…]'. */
export const vectorLiteral = (v: number[]) => `[${v.join(',')}]`;

