import { isTest } from './env.js';

function emit(level: 'info' | 'warn' | 'error', msg: string, meta?: object) {
  if (isTest && level !== 'error') return;
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...meta });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, meta?: object) => emit('info', msg, meta),
  warn: (msg: string, meta?: object) => emit('warn', msg, meta),
  error: (msg: string, meta?: object) => emit('error', msg, meta),
};
