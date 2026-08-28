import type { RunSummary } from '@devdigest/shared';

import type { ApiClient } from './client.js';

/**
 * Infrastructure ring — the wait that turns a fire-and-forget trigger into one
 * blocking tool call.
 *
 * `POST /pulls/:id/review` creates the `agent_runs` rows and returns immediately
 * with `reviews: []` (`server/CLAUDE.md` § Gotchas — that empty array is correct
 * and must not be "fixed"). The result appears later, so somebody has to wait,
 * and D4 of `specs/L04-mcp-server.md` puts that wait HERE rather than on the
 * server, over **polling** rather than over SSE:
 *
 * - `RunBus` is in-memory, so an SSE consumer can block forever on a run whose
 *   process died. `server/INSIGHTS.md` 2026-08-01 records exactly that, and its
 *   answer is to read the run's status row.
 * - `GET /pulls/:id/runs` is described in the service as the server-side source
 *   of truth that survives a reload (`reviews/service.ts:63,69`).
 * - The repo already waits this way in its own integration lane
 *   (`server/test/helpers/runs.ts` `waitForPrRuns`).
 *
 * It borrows the mechanism from that helper and deliberately NOT its ending:
 * `waitForPrRuns` returns the rows it has when its timeout expires, and
 * `server/INSIGHTS.md` 2026-08-07 records the consequence — "when a wait helper
 * is allowed to return without meeting its condition, every downstream assertion
 * becomes a liar". {@link waitForRun} therefore returns a **discriminated**
 * outcome whose `timed_out` member is impossible to mistake for a finished run:
 * it carries no verdict, and the caller cannot read one out of it by accident.
 */

/** 2 s for the first minute (D5). */
export const FAST_POLL_INTERVAL_MS = 2_000;
/** 5 s after that — a long review must not keep spending the rate-limit budget. */
export const SLOW_POLL_INTERVAL_MS = 5_000;
/** How long the fast cadence lasts. */
export const FAST_POLL_WINDOW_MS = 60_000;

/**
 * The statuses `agent_runs.status` settles on. `running` is the only non-terminal
 * one, and a null status is treated as "not settled yet" rather than as unknown:
 * the column is nullable in the contract (`RunSummary.status`), and a row that
 * has not written its status has certainly not finished.
 */
const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'] as const;

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/**
 * What the wait observed, as a discriminated union rather than a run row plus a
 * boolean.
 *
 * A boolean beside the data is exactly what lets a caller read the data and
 * forget the boolean. Here the only member carrying `run: RunSummary` is one
 * where the run genuinely finished; `timed_out` carries `run: RunSummary | null`
 * — the last row seen, never a result — and `runId`, which is what the caller
 * hands the model so it can collect the answer later.
 */
export type WaitOutcome =
  | {
      readonly status: TerminalStatus;
      readonly run: RunSummary;
      readonly runId: string;
      readonly waitedMs: number;
      readonly polls: number;
    }
  | {
      readonly status: 'timed_out';
      /** The last row the poll saw, or null when the run row never appeared. */
      readonly run: RunSummary | null;
      readonly runId: string;
      readonly waitedMs: number;
      readonly polls: number;
    };

/**
 * The two time primitives, injectable together.
 *
 * A test drives a 120-second wait by advancing a number instead of waiting for
 * it — which is the only way the timeout path can be a first-class assertion
 * rather than a branch nobody runs. D5 makes that path ordinary rather than
 * exceptional (a real multi-file review can exceed two minutes), so it has to be
 * as cheap to test as the happy one.
 */
export interface WaitClock {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface WaitOptions extends WaitClock {
  /** Ceiling from `DEVDIGEST_MCP_RUN_TIMEOUT_MS` — read in `config.ts`, never here. */
  readonly timeoutMs: number;
}

/**
 * Poll `GET /pulls/:pullId/runs` until the row for `runId` is terminal.
 *
 * **The deadline is checked BEFORE the sleep, never after** (D5). Checking after
 * would let the last sleep carry the call past the ceiling, and 120 s is not an
 * arbitrary number: Claude Code backgrounds an MCP call that runs past
 * `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (~2 minutes by default), so a wait that
 * overshoots stops returning on its own terms. Concretely the loop returns at
 * 115 s of a 120 s ceiling — the elapsed time it can honestly report — rather
 * than sleeping to 120 s and answering at 122 s.
 *
 * Cost, since the API's global rate limit is 120 requests/minute shared with the
 * web app (`server/src/app.ts:96`): 30 polls in the first minute, then 12 per
 * minute, so a full 120 s wait spends ~42 requests.
 *
 * A failed poll is NOT retried. It throws its `DevDigestApiError` to the caller,
 * because the two failures worth having here — the API went down mid-run, or the
 * global limit was hit — both want the caller told, and a retry loop on 429 is
 * the one thing the plan's constraint table forbids by name.
 */
export async function waitForRun(
  api: ApiClient,
  pullId: string,
  runId: string,
  options: WaitOptions,
): Promise<WaitOutcome> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = now();

  let polls = 0;
  let lastSeen: RunSummary | null = null;

  for (;;) {
    const runs = await api.get<RunSummary[]>(`/pulls/${pullId}/runs`);
    polls += 1;

    // Match by run_id, never by position: `listRunsForPull` returns every run on
    // the pull request, including the other agents' and previous attempts'.
    const run = runs.find((row) => row.run_id === runId) ?? null;
    if (run) lastSeen = run;

    const terminal = terminalStatusOf(run);
    if (terminal && run) {
      return { status: terminal, run, runId, waitedMs: now() - startedAt, polls };
    }

    const elapsed = now() - startedAt;
    const interval = elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
    // The deadline check, before the sleep. `>=` rather than `>` so a sleep that
    // lands exactly ON the deadline does not happen either: the poll after it
    // would already be over the ceiling.
    if (elapsed + interval >= options.timeoutMs) {
      return { status: 'timed_out', run: lastSeen, runId, waitedMs: elapsed, polls };
    }

    await sleep(interval);
  }
}

/** The run's status when it has settled, or null while it is still going. */
export function terminalStatusOf(run: RunSummary | null): TerminalStatus | null {
  const status = run?.status;
  if (!status) return null;
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
    ? (status as TerminalStatus)
    : null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
