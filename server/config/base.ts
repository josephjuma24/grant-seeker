import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import cron from 'node-cron';
import { z } from 'zod';

// Settings every process shares (the API and the harvester), so the
// worker can start without the API's JWT keys and cookie settings.

/**
 * The repository root, independent of the working directory: from this
 * file's location under tsx; the CommonJS production bundle has no
 * import.meta, so there it is the directory the process starts in.
 */
export const projectRoot: string = import.meta.url
  ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  : process.cwd();

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

// z.coerce.boolean() would read "false" as true.
export const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

export const SharedSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Unset, or the AI Studio placeholder: AI matching, embeddings and
  // semantic search fall back to the local matcher and full-text search.
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v !== 'MY_GEMINI_API_KEY' ? v : undefined)),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),

  // When the harvester looks for new grant calls: every day at 06:00 and
  // 12:00, Kenya time. Read by the worker (which runs it) and the API
  // (which shows it in the AI Web Scraper Panel).
  SCRAPE_CRON: z
    .string()
    .default('0 6,12 * * *')
    .refine((v) => cron.validate(v), 'must be a valid cron expression'),
  CRON_TIMEZONE: z
    .string()
    .default('Africa/Nairobi')
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'must be an IANA time zone, e.g. Africa/Nairobi'),
});

/**
 * Validates process.env once at boot. A missing or malformed setting stops
 * the process instead of surfacing later as a confusing runtime error.
 */
export function parseEnv<S extends z.ZodType>(schema: S, processName: string): z.output<S> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    console.error(`Invalid ${processName} configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const sharedEnv = parseEnv(SharedSchema, 'shared');
