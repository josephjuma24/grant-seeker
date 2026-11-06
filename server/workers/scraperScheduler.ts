/**
 * The harvester process: `npm run worker`.
 *
 *   - every SCRAPE_CRON (default daily at 06:00 and 12:00, Africa/Nairobi):
 *     harvest, embed, match, notify;
 *   - every HOUSEKEEPING_CRON (default 02:00): close expired calls, purge
 *     expired refresh tokens; archive calls that ended over 30 days ago;
 *   - on NOTIFY scraper_run_requested (the admin "run now" button): a run
 *     now, for one source or all.
 *
 * Runs as the gs_worker database role, which can write grants, matches,
 * notifications and run records and read only the profile columns that
 * matching needs. A Postgres advisory lock keeps runs exclusive across
 * replicas; within this process a request during a run is queued once.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import cron from 'node-cron';
import pg from 'pg';
import { z } from 'zod';

import { flag, parseEnv, SharedSchema } from '../config/base.ts';
import * as schema from '../db/schema.ts';
import { embedBatch, extractGrantsFromPage, geminiAvailable } from '../lib/gemini.ts';
import { DEFAULT_SETTINGS, errorText, housekeeping, runHarvest, type PipelineDeps, type RunRequest } from './pipeline.ts';
import { DEFAULT_SOURCES, SCRAPER_CHANNEL } from './sources.ts';

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const cronExpr = (fallback: string) =>
  z.string().default(fallback).refine((v) => cron.validate(v), 'must be a valid cron expression');

const WorkerSchema = SharedSchema.extend({
  // The worker's own login (gs_worker). Falls back to DATABASE_URL for a
  // single-role local setup.
  WORKER_DATABASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),

  HOUSEKEEPING_CRON: cronExpr('0 2 * * *'),
  SCRAPE_ON_START: flag(false),
  HARVEST_DEFAULT_SOURCES: flag(true),
  GRANTS_GOV_API_URL: z.string().url().default('https://api.grants.gov/v1/api'),

  MATCH_NOTIFY_THRESHOLD: z.coerce.number().int().min(0).max(100).default(DEFAULT_SETTINGS.notifyThreshold),
}).refine((e) => e.WORKER_DATABASE_URL || e.DATABASE_URL, { message: 'Set WORKER_DATABASE_URL (or DATABASE_URL)' });

const env = parseEnv(WorkerSchema, 'worker');

const log = (msg: string) => console.log(`[worker ${new Date().toISOString()}] ${msg}`);

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

const connectionString = (env.WORKER_DATABASE_URL ?? env.DATABASE_URL)!;
const ssl = env.DATABASE_SSL === 'disable' ? undefined : { rejectUnauthorized: env.DATABASE_SSL === 'verify-full' };

const pool = new pg.Pool({
  connectionString,
  ssl,
  max: 5,
  idleTimeoutMillis: 30_000,
  statement_timeout: 60_000,
  application_name: 'grantseeker-worker',
});
pool.on('error', (err) => log(`idle client error: ${err.message}`));

const deps: PipelineDeps = {
  db: drizzle(pool, { schema }),
  pool,
  sources: env.HARVEST_DEFAULT_SOURCES ? DEFAULT_SOURCES : [],
  adapter: {
    fetch,
    grantsGovApi: env.GRANTS_GOV_API_URL,
    extractFromPage: geminiAvailable() ? extractGrantsFromPage : null,
    log,
  },
  embedDocuments: (texts) => embedBatch(texts, 'RETRIEVAL_DOCUMENT'),
  // Profiles are matched against grants, so they embed as queries.
  embedProfiles: (texts) => embedBatch(texts, 'RETRIEVAL_QUERY'),
  settings: {
    ...DEFAULT_SETTINGS,
    notifyThreshold: env.MATCH_NOTIFY_THRESHOLD,
  },
  log,
};

/* ------------------------------------------------------------------ */
/* Run control                                                         */
/* ------------------------------------------------------------------ */

let current: Promise<void> | null = null;
let queued: RunRequest | null = null;

/** Starts a run, or queues one follow-up if a run is already going. */
function requestRun(req: RunRequest) {
  if (current) {
    // Several clicks during one run collapse into a single follow-up.
    queued = queued && !queued.source ? queued : req;
    log(`run in progress; queued ${req.trigger} request${req.source ? ` for ${req.source}` : ''}`);
    return;
  }
  current = runHarvest(deps, req)
    .then(() => {})
    .catch((err: unknown) => log(`run crashed: ${errorText(err)}`))
    .finally(() => {
      current = null;
      const next = queued;
      queued = null;
      if (next) requestRun(next);
    });
}

/* LISTEN for the admin trigger ---------------------------------------- */

const TriggerPayload = z.object({
  source: z.string().max(200).nullable().optional(),
  requestedBy: z.string().uuid().nullable().optional(),
  requestId: z.string().nullable().optional(),
});

let listener: pg.Client | null = null;
let stopping = false;

async function listen(attempt = 0): Promise<void> {
  if (stopping) return;
  const client = new pg.Client({ connectionString, ssl, application_name: 'grantseeker-worker-listen' });
  const retry = () => {
    if (stopping || listener !== client) return;
    listener = null;
    const delay = Math.min(30_000, 1_000 * 2 ** attempt);
    log(`trigger listener disconnected; reconnecting in ${delay / 1000}s`);
    setTimeout(() => void listen(attempt + 1), delay);
  };
  client.on('error', (err) => {
    log(`trigger listener error: ${err.message}`);
    retry();
  });
  client.on('end', retry);
  client.on('notification', (msg) => {
    if (msg.channel !== SCRAPER_CHANNEL) return;
    let payload: z.infer<typeof TriggerPayload> = {};
    try {
      payload = TriggerPayload.parse(JSON.parse(msg.payload ?? '{}'));
    } catch {
      log('ignored a malformed trigger payload');
      return;
    }
    log(`run requested${payload.source ? ` for ${payload.source}` : ''} (request ${payload.requestId ?? '-'})`);
    requestRun({ trigger: 'manual', source: payload.source ?? null, requestedBy: payload.requestedBy ?? null });
  });
  try {
    listener = client;
    await client.connect();
    await client.query(`LISTEN ${SCRAPER_CHANNEL}`);
    attempt = 0;
    log(`listening for run requests on "${SCRAPER_CHANNEL}"`);
  } catch (err) {
    log(`could not start trigger listener: ${(err as Error).message}`);
    retry();
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  await pool.query('select 1'); // fail fast on bad credentials
  log(
    `starting: harvest "${env.SCRAPE_CRON}", housekeeping "${env.HOUSEKEEPING_CRON}" (${env.CRON_TIMEZONE}); ` +
      `${deps.sources.length} built-in sources; Gemini ${geminiAvailable() ? 'on' : 'off (local matching, no embeddings)'}`,
  );

  const harvestTask = cron.schedule(env.SCRAPE_CRON, () => requestRun({ trigger: 'cron' }), {
    timezone: env.CRON_TIMEZONE,
    name: 'harvest',
    noOverlap: true,
  });
  const housekeepingTask = cron.schedule(
    env.HOUSEKEEPING_CRON,
    () => housekeeping(deps).then(() => {}).catch((err: unknown) => log(`housekeeping failed: ${errorText(err)}`)),
    { timezone: env.CRON_TIMEZONE, name: 'housekeeping', noOverlap: true },
  );

  await listen();
  if (env.SCRAPE_ON_START) requestRun({ trigger: 'manual', source: null });

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: stopping; waiting for any run in progress`);
    await harvestTask.stop();
    await housekeepingTask.stop();
    await listener?.end().catch(() => {});
    // A run that outlives the grace period is cut off; its row stays
    // "running" and the lock is released when the connection closes.
    await Promise.race([current ?? Promise.resolve(), new Promise((r) => setTimeout(r, 60_000))]);
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('[worker] failed to start', err);
  process.exit(1);
});
