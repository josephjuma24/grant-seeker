import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Migrations are generated from server/db/schema.ts and applied by
// server/db/migrate.ts as the table-owning role (MIGRATION_DATABASE_URL),
// never as gs_app.
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
