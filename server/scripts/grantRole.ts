/**
 * Bootstraps access for an existing account. The only way to create the
 * first super_admin, since no route can grant a tier above the caller's.
 *
 *   npm run admin:grant-role -- someone@uni.edu super_admin
 *
 * Connects as the table owner (MIGRATION_DATABASE_URL), which the
 * users_guard trigger lets through, and writes an audit row.
 */
import 'dotenv/config';

import pg from 'pg';
import { z } from 'zod';

import { USER_ROLES } from '../db/schema.ts';

const [email, role] = process.argv.slice(2);
const args = z
  .object({ email: z.email(), role: z.enum(USER_ROLES) })
  .safeParse({ email: email?.trim().toLowerCase(), role });
if (!args.success) {
  console.error(`Usage: npm run admin:grant-role -- <email> <${USER_ROLES.join('|')}>`);
  process.exit(1);
}

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('Set MIGRATION_DATABASE_URL (the table-owning role).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('begin');
  const { rows } = await client.query<{ id: string; role: string }>(
    `update users u set role = $2, updated_at = now()
       from (select id, role from users where email = $1 for update) old
      where u.id = old.id
      returning u.id, old.role`,
    [args.data.email, args.data.role],
  );
  const user = rows[0];
  if (!user) throw new Error(`No user with email ${args.data.email}`);
  await client.query(
    `insert into audit_log (action, entity, entity_id, diff)
     values ('system.grant_role', 'user', $1, jsonb_build_object('from', $2::text, 'to', $3::text, 'via', 'cli'))`,
    [user.id, user.role, args.data.role],
  );
  await client.query('commit');
  console.log(`${args.data.email}: ${user.role} → ${args.data.role}`);
} catch (err) {
  await client.query('rollback');
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
