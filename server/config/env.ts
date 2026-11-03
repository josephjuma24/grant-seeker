import { z } from 'zod';

import { flag, parseEnv, projectRoot, SharedSchema } from './base.ts';

export { projectRoot };

// Validated once at boot. A missing or malformed secret stops the process
// instead of surfacing later as a confusing runtime error.
const pem = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    // .env files usually store PEMs on one line with literal "\n".
    .transform((v) => v.replace(/\\n/g, '\n'))
    .refine((v) => v.includes('-----BEGIN'), `${label} must be a PEM-encoded key`);

// The API's settings; shared ones (NODE_ENV, Gemini) come from base.ts.
const EnvSchema = SharedSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  DATABASE_SSL: z
    .enum(['disable', 'require', 'verify-full'])
    .default('disable'),

  JWT_PRIVATE_KEY: pem('JWT_PRIVATE_KEY'),
  JWT_PUBLIC_KEY: pem('JWT_PUBLIC_KEY'),
  JWT_KEY_ID: z.string().min(1).default('gs-ed25519-1'),
  JWT_ISSUER: z.string().min(1).default('grantseeker'),
  JWT_AUDIENCE: z.string().min(1).default('grantseeker-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Off until a mailer exists: with it on, new accounts stay at guest level
  // until verified, and nothing can send the verification link yet.
  AUTH_REQUIRE_EMAIL_VERIFICATION: flag(false),
  // k-anonymity lookup against Have I Been Pwned; fails open on timeout.
  PASSWORD_BREACH_CHECK: flag(true),
  // Express `trust proxy`: hop count, or a preset such as "loopback".
  // Must match the deployment or req.ip (rate limits, audit) is wrong.
  TRUST_PROXY: z
    .string()
    .default('loopback')
    .transform((v) => (/^\d+$/.test(v) ? Number(v) : v)),

  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),

  // Public address of the web app, used in links sent by email.
  APP_URL: z.string().url().default('http://localhost:3000').transform((v) => v.replace(/\/+$/, '')),
  // Outgoing mail. SMTP_URL like smtps://user:pass@smtp.example.com:465.
  // Unset in development: emails (with their links) are printed to the
  // API log instead. Unset in production: nothing is sent and an error is logged.
  SMTP_URL: z.string().trim().optional().transform((v) => v || undefined),
  MAIL_FROM: z.string().trim().min(3).default('GrantSeeker <no-reply@grantseeker.local>'),

  // Sign in with Google (OAuth 2.0 authorization-code flow, popup mode).
  // Both unset: the button says Google sign-in is not configured.
  GOOGLE_CLIENT_ID: z.string().trim().optional(),
  GOOGLE_CLIENT_SECRET: z.string().trim().optional(),
}).refine((e) => !e.GOOGLE_CLIENT_ID === !e.GOOGLE_CLIENT_SECRET, { message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither' });

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = parseEnv(EnvSchema, 'API');
export const isProduction = env.NODE_ENV === 'production';
