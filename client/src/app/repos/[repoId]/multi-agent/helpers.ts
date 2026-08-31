/**
 * Route-level pure helpers for /repos/:repoId/multi-agent.
 *
 * They live beside `page.tsx` rather than in one component's folder because the
 * page derives with them and hands the result to BOTH views — the same shape
 * `pulls/helpers.ts` and `conventions/helpers.ts` already use.
 */
import type { AgentColumn, RunEvent } from "@devdigest/shared";

/** Columns whose run is still in flight — the ones worth an SSE subscription. */
export function runningRunIds(columns: readonly AgentColumn[]): string[] {
  return columns.filter((c) => c.status === "running").map((c) => c.run_id);
}

/**
 * What the live event streams say about each run, keyed by run id.
 *
 * The executor writes exactly two terminal lines: `result` when it persisted a
 * review, `error` when the run failed or was cancelled
 * (`server/src/modules/reviews/run-executor.ts`). Nothing else changes a column's
 * status, which is what keeps one column's event from touching another's — the
 * map is per run id, not a single page-wide flag.
 *
 * A cancelled run arrives here as `failed`; the authoritative status lands with
 * the refetch the page issues when the streams end.
 */
export function liveStatusByRun(
  events: readonly RunEvent[],
): Record<string, AgentColumn["status"]> {
  const byRun: Record<string, AgentColumn["status"]> = {};
  for (const e of events) {
    if (e.kind === "result") byRun[e.runId] = "done";
    else if (e.kind === "error") byRun[e.runId] = "failed";
  }
  return byRun;
}

/**
 * The columns as they should render right now: the server's answer, with any
 * live status the streams have reported since it was fetched.
 *
 * Only the STATUS is overridden. Score, duration, cost and findings are written
 * by the run itself and arrive with the refetch — inventing them here would put
 * two sources of truth on one card.
 */
export function withLiveStatus(
  columns: readonly AgentColumn[],
  live: Record<string, AgentColumn["status"]>,
): AgentColumn[] {
  return columns.map((c) => {
    const status = live[c.run_id];
    return status && c.status === "running" ? { ...c, status } : { ...c };
  });
}


/**
 * How long a still-running column has been going, in whole seconds.
 *
 * `now` is a parameter so this stays pure and so nothing here needs a timer: the
 * label is recomputed on the renders the SSE events already cause, and a ticking
 * clock would mean an interval this feature is not allowed to add.
 */
export function elapsedSeconds(ranAt: string, now: number = Date.now()): number {
  const started = Date.parse(ranAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((now - started) / 1000));
}
