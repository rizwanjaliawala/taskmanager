import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';

const app = createApp();
const root = path.resolve(process.cwd());
app.use(express.static(root, { index: 'index.html', extensions: ['html'] }));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => logger.info(`Listening on http://localhost:${port}`, { env: env.NODE_ENV }));
