import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { jobRuns } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export type JobResult = {
  job: string;
  /**
   * `processed` counts every unit of work the job examined — every task the job's
   * selection query returned — regardless of what happened to it next (sent, skipped
   * as a duplicate or age-gated, or failed). It is not "count of successful sends";
   * that is `succeeded`. Both jobs (reminders, expiry) share this definition so a
   * reader of `job_runs` can compare `processed` across job types.
   */
  processed: number;
  succeeded: number; failed: number; skipped: number;
};

export type JobBody = () => Promise<Omit<JobResult, 'job'>>;

/** Wraps a job body in a job_runs audit row. Never throws — a cron caller gets a result. */
export async function runJob(job: string, body: JobBody): Promise<JobResult> {
  const started = Date.now();
  let runId: string | undefined;

  try {
    // The initial insert is inside the try too: a database error here must produce a
    // failure result like any other, not escape and break the "never throws" contract.
    const [run] = await db.insert(jobRuns).values({ job }).returning();
    runId = run!.id;

    const r = await body();
    await db.update(jobRuns).set({
      finishedAt: new Date(), processed: r.processed, succeeded: r.succeeded, failed: r.failed,
    }).where(eq(jobRuns.id, runId));

    logger.info(`job ${job} finished`, { ...r, ms: Date.now() - started });
    return { job, ...r };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await db.update(jobRuns).set({ finishedAt: new Date(), error: message.slice(0, 500) })
        .where(eq(jobRuns.id, runId))
        .catch(() => {}); // best-effort audit write; must not itself escape
    }
    logger.error(`job ${job} failed`, { message });
    return { job, processed: 0, succeeded: 0, failed: 1, skipped: 0 };
  }
}
