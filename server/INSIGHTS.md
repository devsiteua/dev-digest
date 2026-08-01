# Insights — server

Append-only, newest first. Format and promotion rules: see the root
[`../INSIGHTS.md`](../INSIGHTS.md).

---

## 2026-08-01 · A "running" run that never finishes is usually a dead process, not a hang

Trigger:  a run stuck at `running` in the UI with no events arriving
Cause:    `RunBus` is in-memory. If the API restarted mid-run, the executor died with it: the
          row stays `running`, the SSE stream has nothing to replay, and there is no runner
          left to cancel. `reapStaleRuns()` on the next boot is what clears these.
Takeaway: check `agent_runs.status` and `run_traces` in the DB before assuming the engine
          hung. `cancelRun` deliberately marks the row cancelled **and** completes the bus so
          orphaned runs can also be dismissed from the UI.
Status:   → promoted to `CLAUDE.md` (Gotchas)

## 2026-08-01 · `POST /pulls/:id/review` returning `reviews: []` is correct

Trigger:  the response body looks empty even though the review runs fine
Cause:    the route creates the `agent_runs` rows, returns the runIds immediately, and fires
          `executor.executeRuns(...)` without awaiting. Results are persisted later; the
          client subscribes to `/runs/:id/events` and refetches on completion.
Takeaway: do not add an await to "fix" the empty array — it would block the request for the
          entire LLM call and break the SSE subscription window.
Status:   → promoted to `CLAUDE.md` (Gotchas)
