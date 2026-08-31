import * as t from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PgFixture } from './pg.js';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled), and THROWS with the
 * counts it saw if the budget runs out.
 *
 * The budget is 30s rather than 10s because the lane's cost is the number of
 * files in it: every `*.it.test.ts` starts its own Postgres container, and at 19
 * containers a 10s wait expired on nearly every whole-lane run while each file
 * passed alone.
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 30_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const done =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    if (done) return runs;
    if (Date.now() - start > timeoutMs) {
      // THROW, never return what we have. Returning the rows on timeout is what
      // turned a slow lane into an assertion three lines away from the cause:
      // the caller read `trace.prompt_assembly` off a run the executor had not
      // finished and failed with `TypeError: Cannot read properties of
      // undefined`, which reads as a logic bug in prompt rendering and is not
      // one (`server/INSIGHTS.md`, 2026-08-07 and 2026-08-28).
      const want = expected != null ? `${expected} terminal runs` : `all ${runs.length} runs terminal`;
      throw new Error(
        `waitForPrRuns timed out after ${timeoutMs}ms for pr ${prId}: ` +
          `expected ${want}, saw ${terminal.length} terminal of ${runs.length} rows ` +
          `(statuses: ${runs.map((r) => r.status ?? 'null').join(', ') || 'none'})`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
