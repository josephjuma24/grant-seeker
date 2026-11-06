/**
 * Live dashboard updates.
 *
 * Triggers on grants, grant_matches and scraper_runs (sql/900_hardening.sql)
 * NOTIFY 'grants_changed' whenever the harvester, housekeeping or an admin
 * changes catalogue data. One dedicated connection LISTENs, debounces a
 * burst of notices (a harvest writes row by row) into one event, and fans
 * it out to every open dashboard over Server-Sent Events.
 *
 * Events carry no data, only "something changed": clients re-fetch through
 * the normal, access-controlled endpoints.
 */
import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';
import pg from 'pg';

import { env } from '../config/env.ts';

const CHANNEL = 'grants_changed';
// Long enough to fold one harvest step's writes together, short enough to feel live.
const DEBOUNCE_MS = 1_500;
const KEEPALIVE_MS = 25_000;
const MAX_CLIENTS = 500;

export type ChangeEvent = { at: string; tables: string[] };

const bus = new EventEmitter();
bus.setMaxListeners(MAX_CLIENTS + 10);

let pending = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let client: pg.Client | null = null;
let stopped = false;
let clients = 0;

function queue(table: string) {
  pending.add(table);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const event: ChangeEvent = { at: new Date().toISOString(), tables: [...pending].sort() };
    pending = new Set();
    bus.emit('change', event);
  }, DEBOUNCE_MS);
}

/** Starts LISTENing; reconnects with backoff if the connection drops. */
export async function startLiveUpdates(attempt = 0): Promise<void> {
  if (stopped) return;
  const c = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === 'disable' ? undefined : { rejectUnauthorized: env.DATABASE_SSL === 'verify-full' },
    application_name: 'grantseeker-api-live',
  });
  const retry = () => {
    if (stopped || client !== c) return;
    client = null;
    const delay = Math.min(60_000, 1_000 * 2 ** attempt);
    setTimeout(() => void startLiveUpdates(attempt + 1), delay);
  };
  c.on('error', (err) => {
    console.error('[live] listener error', err.message);
    retry();
  });
  c.on('end', retry);
  c.on('notification', (msg) => {
    if (msg.channel === CHANNEL) queue(msg.payload || 'grants');
  });
  try {
    client = c;
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    if (attempt > 0) queue('reconnect'); // may have missed changes while away
  } catch (err) {
    console.error('[live] could not listen', (err as Error).message);
    retry();
  }
}

export async function stopLiveUpdates() {
  stopped = true;
  bus.emit('shutdown'); // end open streams so the HTTP server can close
  if (timer) clearTimeout(timer);
  await client?.end().catch(() => {});
  client = null;
}

/** GET /api/grants/live: a text/event-stream of "change" events. */
export function liveStream(req: Request, res: Response) {
  if (clients >= MAX_CLIENTS) {
    res.status(503).json({ error: { code: 'live_busy', message: 'Too many live connections; refresh later' } });
    return;
  }
  clients++;
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  // Clients wait this long before reconnecting after a drop.
  res.write(`retry: 5000\nevent: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const onChange = (e: ChangeEvent) => res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`);
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS);
  const onShutdown = () => res.end();
  bus.on('change', onChange);
  bus.once('shutdown', onShutdown);
  req.on('close', () => {
    clients--;
    clearInterval(keepalive);
    bus.off('change', onChange);
    bus.off('shutdown', onShutdown);
  });
}
