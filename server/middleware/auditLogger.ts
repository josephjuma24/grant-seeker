import { randomUUID } from 'node:crypto';

import type { Request, RequestHandler } from 'express';

import { withUserTx, type Tx } from '../db/index.ts';
import { auditLog } from '../db/schema.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Assigns req.requestId (honouring a well-formed X-Request-Id) and echoes it. */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && UUID_RE.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

/* Redaction --------------------------------------------------------- */

const SECRET_KEY = /pass(word)?|secret|token|hash|cookie|authorization|api[-_]?key/i;

/** Copies `value`, replacing anything under a secret-looking key. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1),
    ]),
  );
}

/* Writing rows ------------------------------------------------------ */

export interface AuditEntry {
  /** dotted verb, e.g. `user.login`, `proposal.submit` */
  action: string;
  entity?: string;
  entityId?: string;
  diff?: Record<string, unknown>;
  /** Override the actor, e.g. for login where req.user is not set yet. */
  actor?: { id: string; level: number; orgId: string | null } | null;
}

/**
 * Writes an audit row inside `tx`, so it commits or rolls back with the
 * change it describes. prev_hash/hash are filled in by the database.
 */
export async function recordAudit(tx: Tx, req: Request, entry: AuditEntry): Promise<void> {
  const actor =
    entry.actor !== undefined
      ? entry.actor
      : req.user
        ? { id: req.user.id, level: req.user.level, orgId: req.user.orgId }
        : null;

  await tx.insert(auditLog).values({
    action: entry.action,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    actorId: actor?.id ?? null,
    actorLevel: actor?.level ?? null,
    orgId: actor?.orgId ?? null,
    requestId: req.requestId ?? null,
    ip: req.ip ?? null,
    diff: entry.diff ? (redact(entry.diff) as Record<string, unknown>) : null,
  });
  auditedRequests.add(req);
}

/* Safety net -------------------------------------------------------- */

const auditedRequests = new WeakSet<Request>();

/**
 * Marks a mutation as deliberately unaudited, for high-volume routine
 * calls (token refresh) whose security-relevant outcomes are audited
 * explicitly instead.
 */
export function skipAudit(req: Request): void {
  auditedRequests.add(req);
}

/**
 * Guarantees every successful mutation leaves a trace. Handlers should call
 * recordAudit() inside their own transaction (precise, atomic); when one
 * forgets, this writes a coarse `http.<method>` row after the response.
 * Request bodies are never logged here.
 */
export const auditMutations: RequestHandler = (req, res, next) => {
  if (!MUTATING.has(req.method)) return next();

  res.on('finish', () => {
    if (res.statusCode >= 400 || auditedRequests.has(req)) return;
    const route = `${req.baseUrl}${req.route?.path ?? req.path}`;
    withUserTx(req.identity ?? null, (tx) =>
      recordAudit(tx, req, {
        action: `http.${req.method.toLowerCase()}`,
        entity: route,
        diff: { status: res.statusCode },
      }),
    ).catch((err: unknown) => {
      console.error('[audit] fallback write failed', req.requestId, err);
    });
  });
  next();
};
