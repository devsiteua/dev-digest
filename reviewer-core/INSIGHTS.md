# Insights — reviewer-core

Append-only, newest first within each section. Sections, entry format, and promotion rules:
see the root [`../INSIGHTS.md`](../INSIGHTS.md).

---

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

### 2026-08-01 · The score you see is never the score the model returned

Trigger:  a review's score not matching the model's raw output in the run trace
Cause:    `reviewPullRequest` recomputes the score with `scoreFromFindings(ground.kept)` after
          the citation gate, so the score, the findings list, and the deterministic blocker
          count always agree with each other.
Takeaway: when a score looks wrong, look at which findings were **dropped** by grounding
          first — the drop reasons are emitted as events and stored in the trace.
Evidence: src/review/run.ts
Status:   → promoted to `CLAUDE.md` (Conventions)

### 2026-08-22 · There are now TWO post-steps after the reduce, and the score comes from the LAST one

Trigger:  adding the scope gate beside `groundFindings`, and having to decide where the score is
          computed.
Cause:    the pipeline is `reduce → ground → scope-gate → score`, and `scoreFromFindings` takes
          the survivors of BOTH. The 2026-08-01 entry below is still right about grounding and
          is no longer the whole picture: a post-step inserted between the gate and the score
          would silently make the persisted score describe a finding set the user never sees.
Takeaway: a new post-step goes after the existing ones and BEFORE `scoreFromFindings`, returns
          `{ kept, dropped: { finding, reason }[] }` plus a summary string exactly as
          `grounding.ts` does, and emits one event per drop. Its summary belongs in `RunStats`
          as `z.string().nullish()` — nullish because every trace written before it existed has
          no such key, the same reason `cost_usd` carries.
Evidence: reviewer-core/src/review/run.ts:206-232 · reviewer-core/src/scope-gate.ts
Status:   resolved

### 2026-08-01 · The grounding gate runs once, after the reduce

Trigger:  wondering whether map-reduce grounds per chunk
Cause:    each chunk returns its own partial `Review`; they are merged by `reduceReviews`, and
          only the merged set goes through `groundFindings`. One gate, one code path, both
          strategies.
Takeaway: do not "optimise" by gating per chunk — it would drop findings that the reduce step
          is meant to keep, and it would give two different behaviours for single-pass and
          map-reduce.
Evidence: src/review/reduce.ts, src/grounding.ts
Status:   → promoted to `docs/prompt-contract.md`

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

_None yet._
