import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

import { HttpError } from '../lib/httpError.ts';

type Schemas = {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
};

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface Validated<S extends Schemas> {
  body: Out<S['body']>;
  query: Out<S['query']>;
  params: Out<S['params']>;
}

export function validationError(error: z.ZodError): HttpError {
  return new HttpError(400, 'validation_failed', 'Request validation failed', {
    issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

function parsePart(schema: z.ZodType | undefined, value: unknown): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/**
 * Wraps a route handler: parses body, query and params with zod (unknown
 * keys stripped, so mass-assignment is impossible), passes the typed
 * result as `input`, and forwards thrown or rejected errors to the error
 * handler, which Express 4 does not do for async handlers on its own.
 *
 *   router.post('/x', handle({ body: Schema }, async (req, res, { body }) => …))
 */
export function handle<S extends Schemas>(
  schemas: S,
  fn: (req: Request, res: Response, input: Validated<S>) => Promise<unknown> | unknown,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Each part was parsed by the schema the caller declared for it.
      const input = {
        body: parsePart(schemas.body, req.body),
        query: parsePart(schemas.query, req.query),
        params: parsePart(schemas.params, req.params),
      } as Validated<S>;
      // Later middleware and logging see the cleaned body, never the raw one.
      if (schemas.body) req.body = input.body;
      await fn(req, res, input);
    } catch (err) {
      next(err);
    }
  };
}

/* Reusable field schemas ------------------------------------------- */

export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Must be a valid email address' }));

export const zUuid = z.uuid({ message: 'Must be a UUID' });

export const zPagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
