import { eq } from 'drizzle-orm';
import * as t from '../../src/db/schema.js';
import type { PgFixture } from './pg.js';

/**
 * Wait for an eval batch to reach a terminal status — and THROW when it does not.
 *
 * The throw is the whole point, and it is a deliberate departure from
 * `waitForPrRuns` next door. That helper's timeout branch is
 * `if (Date.now() - start > timeoutMs) return runs`: it hands back the rows it
 * happens to have, the test proceeds against a run the executor has not
 * finished, and the failure surfaces three lines later as
 * `Cannot read properties of undefined` in an assertion about content. Nothing
 * in that message mentions a timeout, which is why the first instinct is to
 * look for a logic bug (`server/INSIGHTS.md`, 2026-08-07 and 2026-08-28).
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
