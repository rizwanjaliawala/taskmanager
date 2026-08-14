import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { jobRuns } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export type JobResult = {
  job: string; processed: number; succeeded: number; failed: number; skipped: number;
};

export type JobBody = () => Promise<Omit<JobResult, 'job'>>;

/** Wraps a job body in a job_runs audit row. Never throws — a cron caller gets a result. */
export async function runJob(job: string, body: JobBody): Promise<JobResult> {
  const [run] = await db.insert(jobRuns).values({ job }).returning();
  const started = Date.now();

  try {
    const r = await body();
    await db.update(jobRuns).set({
      finishedAt: new Date(), processed: r.processed, succeeded: r.succeeded, failed: r.failed,
    }).where(eq(jobRuns.id, run!.id));

    logger.info(`job ${job} finished`, { ...r, ms: Date.now() - started });
    return { job, ...r };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(jobRuns).set({ finishedAt: new Date(), error: message.slice(0, 500) })
      .where(eq(jobRuns.id, run!.id));
    logger.error(`job ${job} failed`, { message });
    return { job, processed: 0, succeeded: 0, failed: 1, skipped: 0 };
  }
}
