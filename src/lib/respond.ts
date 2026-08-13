import type { Response } from 'express';
import { AppError } from './errors.js';
import { logger } from './logger.js';

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ ok: true, data });
}

export function fail(res: Response, err: AppError): void {
  res.status(err.status).json({
    ok: false,
    error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
  });
}

/** Express error handler. Unknown errors are logged in full and reported as INTERNAL_ERROR. */
export function errorHandler(err: unknown, _req: any, res: Response, _next: any): void {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error(err.message, { code: err.code });
    fail(res, err);
    return;
  }
  logger.error('Unhandled error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  fail(res, new AppError('INTERNAL_ERROR', 'An unexpected error occurred'));
}
