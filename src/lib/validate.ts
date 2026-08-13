import type { RequestHandler } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { AppError } from './errors.js';

type Schemas = { body?: ZodSchema; query?: ZodSchema; params?: ZodSchema };

export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new AppError('VALIDATION_ERROR', 'Request validation failed',
          err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))));
        return;
      }
      next(err);
    }
  };
}
