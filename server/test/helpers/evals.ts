import { eq } from 'drizzle-orm';
import * as t from '../../src/db/schema.js';
import type { PgFixture } from './pg.js';

/**
 * Wait for an eval batch to reach a terminal status — and THROW when it does not.
 *
 * The throw is the whole point, and it is the contract `waitForPrRuns` next door
 * now keeps as well. That helper used to RETURN the rows it happened to have
 * when its budget expired, so a test proceeded against a run the executor had
 * not finished and failed three lines later with
 * `Cannot read properties of undefined` in an assertion about content — a
 * message naming nothing about a timeout, which is why the first instinct was to
 * look for a logic bug (`server/INSIGHTS.md`, 2026-08-07 and 2026-08-28). It was
 * changed in the same commit that added this file; neither helper hides a
 * timeout any more.
 *
 * So this one reports the counts it actually saw. A slow lane then fails as
 * "the batch was still running after 15000 ms (8 of 8 cases written)", which
 * names the cause instead of hiding it.
 */
const TERMINAL = new Set(['done', 'partial', 'failed']);

export async function waitForBatch(
  db: PgFixture['handle']['db'],
  batchId: string,
  opts: { timeoutMs?: number } = {},
): Promise<typeof t.evalRunBatches.$inferSelect> {
  const { timeoutMs = 15_000 } = opts;
  const start = Date.now();

  for (;;) {
    const [batch] = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.id, batchId));
    if (!batch) throw new Error(`waitForBatch: no eval_run_batches row for id ${batchId}`);
    if (TERMINAL.has(batch.status)) return batch;

    if (Date.now() - start > timeoutMs) {
      const runs = await db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
      throw new Error(
        `waitForBatch: batch ${batchId} was still '${batch.status}' after ${timeoutMs} ms ` +
          `(${runs.length} of ${batch.casesTotal} case rows written, cases_ran=${batch.casesRan})`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
