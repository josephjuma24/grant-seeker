import { getTableColumns, sql } from 'drizzle-orm';

import { funders, grants, type Grant } from '../db/schema.ts';

// Every grant column except the 768-float embedding and the tsvector,
// which are large and only ever used inside SQL.
const { embedding: _embedding, search: _search, ...leanGrantColumns } = getTableColumns(grants);

/** Select list for grant rows joined to funders (left join on funder_id). */
export const grantRowColumns = {
  ...leanGrantColumns,
  funderName: funders.name,
  hasEmbedding: sql<boolean>`${grants.embedding} is not null`.as('has_embedding'),
};

export type GrantRow = Omit<Grant, 'embedding' | 'search'> & {
  funderName: string | null;
  hasEmbedding: boolean;
};

/** pgvector literal for a JS embedding: '[0.1,0.2,…]'. */
export const vectorLiteral = (v: number[]) => `[${v.join(',')}]`;
