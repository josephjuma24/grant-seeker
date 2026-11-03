import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { env } from '../config/env.ts';
import * as schema from './schema.ts';
import { ROLE_LEVEL, SYSTEM_LEVEL } from './schema.ts';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Who a transaction runs as. Mirrors the claims in the access token. */
export interface SessionIdentity {
  userId: string;
  orgId: string | null;
  level: number;
}

function sslConfig(): pg.PoolConfig['ssl'] {
  switch (env.DATABASE_SSL) {
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-full':
      return { rejectUnauthorized: true };
    default:
      return undefined;
  }
}

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: sslConfig(),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Bounds any single statement so a runaway query cannot pin a connection.
  statement_timeout: 15_000,
  application_name: 'grantseeker-api',
});

pool.on('error', (err) => {
  // An idle client died (e.g. the server restarted). pg drops it from the
  // pool; log it rather than crash the process.
  console.error('[db] idle client error', err.message);
});

/**
 * Raw handle. Queries through it run with no session identity, so RLS
 * shows only rows whose policy admits anonymous access (grants, funders).
 * Use withUserTx()/withSystemTx() for everything else.
 */
export const db: Database = drizzle(pool, { schema });

async function setIdentity(tx: Tx, identity: SessionIdentity | null) {
  // is_local = true: the settings vanish at COMMIT/ROLLBACK, so a pooled
  // connection never carries one user's identity into the next request.
  await tx.execute(sql`
    select
      set_config('app.user_id', ${identity?.userId ?? ''}, true),
      set_config('app.org_id', ${identity?.orgId ?? ''}, true),
      set_config('app.level', ${String(identity?.level ?? ROLE_LEVEL.guest)}, true)
  `);
}

/**
 * Runs `fn` in a transaction scoped to `identity`. Every RLS policy sees
 * that user, org and tier. Pass null for a signed-out request.
 */
export function withUserTx<T>(
  identity: SessionIdentity | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setIdentity(tx, identity);
    return fn(tx);
  });
}

/**
 * Runs `fn` above every human tier. Reserved for code that must act before
 * or outside a user session: sign-up, login, token rotation, the worker.
 * Route handlers must not call this.
 */
export function withSystemTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.user_id', '', true),
        set_config('app.org_id', '', true),
        set_config('app.level', ${String(SYSTEM_LEVEL)}, true)
    `);
    return fn(tx);
  });
}

export async function pingDb(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = performance.now();
  try {
    await pool.query('select 1');
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - started) };
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { schema };
