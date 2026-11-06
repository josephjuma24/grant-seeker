import { getTableColumns, sql } from 'drizzle-orm';

import { ARCHIVE_AFTER_DAYS } from '../../shared/grantLifecycle.ts';
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
 * The 30-day rule (shared/grantLifecycle.ts): a call that ended at most
 * ARCHIVE_AFTER_DAYS days ago is expired; older than that it is archived.
 * Admins may also archive an expired call early (archived_at).
 *
 * endedOn: the earlier of the deadline and the day the call was closed;
 * a closed call with neither falls back to its last update.
 */
export const endedOn = sql`(case
  when ${grants.status} = 'closed' then coalesce(least(${grants.deadline}, (${grants.closedAt} at time zone 'UTC')::date), (${grants.updatedAt} at time zone 'UTC')::date)
  when ${grants.deadline} < current_date then ${grants.deadline}
end)`;
const hasEnded = sql`(${grants.status} = 'closed' or ${grants.deadline} < current_date)`;
/** Ended more than ARCHIVE_AFTER_DAYS days ago: archived by the rule, whatever archived_at says. */
export const isPastArchiveAge = sql`(${hasEnded} and ${endedOn} < current_date - ${sql.raw(String(ARCHIVE_AFTER_DAYS))})`;
export const isArchived = sql`(${grants.archivedAt} is not null or ${isPastArchiveAge})`;
export const isExpired = sql`(${grants.archivedAt} is null and ${hasEnded} and not ${isPastArchiveAge})`;
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
  endedOn: sql<string | null>`to_char(${endedOn}, 'YYYY-MM-DD')`.as('ended_on'),
  // Archived by the 30-day rule rather than by an admin: cannot be restored.
  archivedByAge: sql<boolean>`coalesce(${isPastArchiveAge}, false)`.as('archived_by_age'),
  // Editions of this call: distinct (title, deadline) listings in its
  // series plus earlier versions saved from its own page.
  editionCount: sql<number>`(
    (case when length(split_part(${grants.seriesKey}, '|', 2)) >= 12
      then (select count(distinct (lower(g2.title), g2.deadline)) from grants g2 where g2.series_key = ${grants.seriesKey})
      else 1 end)
    + (case when length(split_part(${grants.seriesKey}, '|', 2)) >= 12
      then (select count(*) from grant_revisions r join grants g3 on g3.id = r.grant_id where g3.series_key = ${grants.seriesKey})
      else (select count(*) from grant_revisions r where r.grant_id = ${grants.id}) end)
  )`.mapWith(Number).as('edition_count'),
  // The next cycle of this call, when one has been published.
  newerEditionId: sql<string | null>`(
    select g2.id from grants g2
    where g2.series_key = ${grants.seriesKey} and g2.deadline > ${grants.deadline}
      and length(split_part(g2.series_key, '|', 2)) >= 12
    order by g2.deadline desc limit 1
  )`.as('newer_edition_id'),
};

export type GrantRow = Omit<Grant, 'embedding' | 'search'> & {
  funderName: string | null;
  hasEmbedding: boolean;
  lifecycle: GrantLifecycle;
  endedOn: string | null;
  archivedByAge: boolean;
  editionCount: number;
  newerEditionId: string | null;
};

/** pgvector literal for a JS embedding: '[0.1,0.2,…]'. */
export const vectorLiteral = (v: number[]) => `[${v.join(',')}]`;

