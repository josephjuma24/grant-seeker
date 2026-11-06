/**
 * Harvester status for the dashboard header: how many sources the agents
 * watch and when they last scanned. scraper_runs is admin-only under RLS,
 * so this reads it as the system and returns aggregates only, never errors
 * or source details.
 */
import { desc, sql } from 'drizzle-orm';

import { withSystemTx } from '../db/index.ts';
import { funders, scraperRuns } from '../db/schema.ts';
import { DEFAULT_SOURCES, funderSource } from '../workers/sources.ts';

export type HarvestStatus = {
  /** Sources the harvester reads: built-in feeds plus funders with a scrape config. */
  sourcesCount: number;
  running: boolean;
  lastRunAt: string | null;
  lastRunStatus: 'ok' | 'partial' | 'failed' | null;
  lastSuccessAt: string | null;
  /** New calls found by the last finished run. */
  lastRunNewCalls: number;
};

// A run still marked running after this long has died without finishing.
const STALE_RUN_MINUTES = 60;

export async function harvestStatus(): Promise<HarvestStatus> {
  return withSystemTx(async (tx) => {
    const configured = await tx
      .select({ id: funders.id, slug: funders.slug, name: funders.name, scrapeConfig: funders.scrapeConfig })
      .from(funders)
      .where(sql`${funders.scrapeConfig} is not null`);
    const sourcesCount = DEFAULT_SOURCES.length + configured.map(funderSource).filter((s) => s !== null).length;

    const [last] = await tx
      .select({
        status: scraperRuns.status,
        finishedAt: scraperRuns.finishedAt,
        itemsNew: scraperRuns.itemsNew,
      })
      .from(scraperRuns)
      .where(sql`${scraperRuns.status} <> 'running'`)
      .orderBy(desc(scraperRuns.startedAt))
      .limit(1);
    const [agg] = await tx
      .select({
        running: sql<boolean>`bool_or(${scraperRuns.status} = 'running' and ${scraperRuns.startedAt} > now() - make_interval(mins => ${STALE_RUN_MINUTES}))`,
        lastSuccessAt: sql<Date | null>`max(${scraperRuns.finishedAt}) filter (where ${scraperRuns.status} in ('ok', 'partial'))`,
      })
      .from(scraperRuns);

    const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
    return {
      sourcesCount,
      running: agg?.running ?? false,
      lastRunAt: iso(last?.finishedAt),
      lastRunStatus: (last?.status as HarvestStatus['lastRunStatus']) ?? null,
      lastSuccessAt: iso(agg?.lastSuccessAt),
      lastRunNewCalls: last?.itemsNew ?? 0,
    };
  });
}
