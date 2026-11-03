import type { Request } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';

// In-memory counters: correct for one instance. Running several replicas
// needs a shared store (rate-limit-redis or a Postgres store) here.
function limiter(windowMs: number, limit: number, keyGenerator?: Options['keyGenerator']) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        error: { code: 'rate_limited', message: 'Too many requests; slow down and retry later' },
      });
    },
  });
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');

/**
 * Whole API: 600 requests per 15 minutes per IP. A signed-in tab polling
 * team chat every 5 s uses about 180 of them.
 */
export const apiLimiter = limiter(15 * 60_000, 600);

/**
 * Login: 5 per minute per IP+email, so one attacker cannot spray a single
 * account and one busy office NAT does not lock everyone else out.
 */
export const loginLimiter = limiter(60_000, 5, (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `${ipKey(req)}|${email}`;
});

/** Sign-up: 5 per hour per IP. */
export const registerLimiter = limiter(60 * 60_000, 5, ipKey);

/** Refresh: generous, since every open tab refreshes every 15 minutes. */
export const refreshLimiter = limiter(60_000, 30, ipKey);

/**
 * The AI proposal assistant: 20 generations per hour per user. Each call
 * costs model tokens, so this is keyed by account rather than IP. Mount
 * after requireAuth.
 */
export const assistantLimiter = limiter(60 * 60_000, 20, (req) => (req.user ? `user:${req.user.id}` : ipKey(req)));

/**
 * "Forgot password": 3 emails per 15 minutes per IP+address, so the form
 * cannot be used to flood someone's inbox.
 */
export const forgotPasswordLimiter = limiter(15 * 60_000, 3, (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `${ipKey(req)}|${email}`;
});

/** Reset links checked or used: 20 per 15 minutes per IP (tokens are 256-bit, so this only curbs noise). */
export const resetPasswordLimiter = limiter(15 * 60_000, 20, ipKey);
