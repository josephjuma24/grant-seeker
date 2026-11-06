import fs from 'node:fs';
import path from 'node:path';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { z } from 'zod';

import { env, isProduction, projectRoot } from './config/env.ts';
import { closeDb, pingDb } from './db/index.ts';
import { startLiveUpdates, stopLiveUpdates } from './lib/liveUpdates.ts';
import { HttpError } from './lib/httpError.ts';
import { auditMutations, requestContext } from './middleware/auditLogger.ts';
import { CSRF_HEADER } from './middleware/auth.ts';
import { apiLimiter } from './middleware/rateLimit.ts';
import { validationError } from './middleware/validation.ts';
import { adminRouter } from './routes/admin.routes.ts';
import { assistantRouter } from './routes/assistant.routes.ts';
import { authRouter } from './routes/auth.routes.ts';
import { collaborationRouter } from './routes/collaboration.routes.ts';
import { grantsRouter } from './routes/grants.routes.ts';
import { profileRouter } from './routes/profile.routes.ts';
import { proposalsRouter } from './routes/proposals.routes.ts';
import { usersRouter } from './routes/users.routes.ts';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

/* ------------------------------------------------------------------ */
/* Security headers, CORS, limits                                      */
/* ------------------------------------------------------------------ */

app.use(requestContext);
app.use(
  helmet({
    // Vite's dev server injects inline scripts for HMR, so CSP is
    // production-only. The built SPA loads nothing from other origins
    // except Google's sign-in client (accounts.google.com/gsi).
    contentSecurityPolicy: isProduction
      ? {
          useDefaults: true,
          directives: {
            'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
            // motion writes inline style attributes.
            'style-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
            'img-src': ["'self'", 'data:', 'https:'],
            'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
            'frame-src': ['https://accounts.google.com/gsi/'],
            'frame-ancestors': ["'none'"],
          },
        }
      : false,
    // Google's sign-in popup reports back with postMessage, which a
    // same-origin opener policy would cut off.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginEmbedderPolicy: false,
    hsts: isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  }),
);

const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
app.use(
  '/api',
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', CSRF_HEADER],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600,
  }),
);
app.use('/api', apiLimiter);
app.use('/api', express.json({ limit: '1mb' }));
app.use('/api', cookieParser());
app.use('/api', auditMutations);

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

app.get('/api/health', async (_req, res) => {
  const database = await pingDb();
  res.status(database.ok ? 200 : 503).json({
    status: database.ok ? 'ok' : 'degraded',
    database,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/profile', profileRouter);
app.use('/api/grants', grantsRouter);
app.use('/api/proposals', proposalsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/collaboration', collaborationRouter);
app.use('/api/assistant', assistantRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'No such API route' } });
});

/* ------------------------------------------------------------------ */
/* Errors: only HttpError details reach the client                     */
/* ------------------------------------------------------------------ */

/**
 * Database refusals that are the client's doing. 42501 covers RLS denials
 * and the users_guard trigger; the message is ours or Postgres's, never
 * row data, but stays generic anyway.
 */
function fromPostgres(err: unknown): HttpError | null {
  const pg = (err as { cause?: { code?: string } })?.cause ?? (err as { code?: string });
  switch (pg?.code) {
    case '42501':
      return new HttpError(403, 'forbidden', 'You do not have permission to change this');
    case '23505':
      return new HttpError(409, 'conflict', 'That already exists');
    case '23503':
      return new HttpError(400, 'invalid_reference', 'A referenced record does not exist');
    case '22P02':
      return new HttpError(400, 'invalid_input', 'Malformed value');
    default:
      return null;
  }
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  // express.json() on a malformed body
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Body exceeds 1 MB' } });
  }

  const httpErr =
    err instanceof z.ZodError ? validationError(err) : err instanceof HttpError ? err : fromPostgres(err);
  if (httpErr) {
    return res.status(httpErr.status).json({
      error: { code: httpErr.code, message: httpErr.message, details: httpErr.details },
    });
  }

  console.error(`[api] unhandled error request=${req.requestId}`, err);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong', requestId: req.requestId },
  });
};
app.use(errorHandler);

/* ------------------------------------------------------------------ */
/* SPA                                                                 */
/* ------------------------------------------------------------------ */

async function mountFrontend() {
  if (isProduction) {
    const dist = path.join(projectRoot, 'dist');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    return;
  }

  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: projectRoot,
    configFile: path.join(projectRoot, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  app.use(vite.middlewares);
  app.get('*', async (req, res, next) => {
    try {
      const template = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf-8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Start & graceful shutdown                                           */
/* ------------------------------------------------------------------ */

export { app };

async function start() {
  await mountFrontend();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`GrantSeeker API listening on http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
  });
  // Push dashboard updates when the harvester or admins change catalogue data.
  void startLiveUpdates();

  const shutdown = (signal: string) => {
    console.log(`${signal} received, draining connections`);
    void stopLiveUpdates();
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    // Do not hang forever on keep-alive sockets.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Imported by tests: build the app without listening.
if (process.env.GS_NO_LISTEN !== '1') {
  start().catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
  });
}
