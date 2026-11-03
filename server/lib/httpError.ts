/**
 * Thrown from handlers and middleware; the error handler in server.ts turns
 * it into `{ error: { code, message, details? } }` with this status. Any
 * other error becomes an opaque 500 so internals never reach the client.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (code: string, message: string) => new HttpError(401, code, message);
export const forbidden = (code: string, message: string, details?: unknown) =>
  new HttpError(403, code, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
