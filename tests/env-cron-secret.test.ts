import { describe, expect, it } from 'vitest';

/**
 * `src/lib/env.ts` parses `process.env` at module-evaluation time and throws
 * synchronously on failure, so each case here needs a fresh module instance —
 * a cache-busting query string forces Vite/vitest to re-evaluate the module
 * against whatever `process.env` looks like at that moment.
 */
async function importEnvWith(overrides: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    // @vite-ignore — the specifier is intentionally dynamic (cache-busting query
    // string, no '.' in the value — esbuild's loader otherwise misreads it as a
    // file extension) so each case gets a fresh module evaluation of env.ts.
    const bust = `${Date.now()}${Math.random().toString(16).slice(2)}`;
    return await import(/* @vite-ignore */ `../src/lib/env.js?bust=${bust}`);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('CRON_SECRET production guard', () => {
  it('rejects the well-known default value when NODE_ENV=production', async () => {
    await expect(
      importEnvWith({ NODE_ENV: 'production', CRON_SECRET: undefined }),
    ).rejects.toThrow(/CRON_SECRET/);
  });

  it('rejects an explicitly-set default value in production too', async () => {
    await expect(
      importEnvWith({ NODE_ENV: 'production', CRON_SECRET: 'dev-cron-secret-change-me' }),
    ).rejects.toThrow(/CRON_SECRET/);
  });

  it('accepts a real secret in production', async () => {
    const mod = await importEnvWith({
      NODE_ENV: 'production', CRON_SECRET: 'a-real-production-cron-secret-value',
    });
    expect(mod.env.CRON_SECRET).toBe('a-real-production-cron-secret-value');
    expect(mod.isProd).toBe(true);
  });

  it('leaves development unaffected by the default value', async () => {
    const mod = await importEnvWith({ NODE_ENV: 'development', CRON_SECRET: undefined });
    expect(mod.env.CRON_SECRET).toBe('dev-cron-secret-change-me');
  });

  it('leaves test unaffected by the default value', async () => {
    const mod = await importEnvWith({ NODE_ENV: 'test', CRON_SECRET: undefined });
    expect(mod.env.CRON_SECRET).toBe('dev-cron-secret-change-me');
    expect(mod.isTest).toBe(true);
  });
});
