import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppError } from './lib/errors.js';
import { ok, errorHandler } from './lib/respond.js';
import { env } from './lib/env.js';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Same-origin deployment: only allow the configured app origin.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', env.APP_URL);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  app.get('/api/health', (_req, res) => {
    ok(res, { status: 'ok', service: 'Utopia Trucking Task Manager', ts: new Date().toISOString() });
  });

  app.get('/api/health/boom', () => {
    throw new Error('intentional failure: secret-value-must-not-leak');
  });

  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'Endpoint not found')));
  app.use(errorHandler);

  return app;
}
