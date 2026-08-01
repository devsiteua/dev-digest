# Insights — reviewer-core

Append-only, newest first. Format and promotion rules: see the root
[`../INSIGHTS.md`](../INSIGHTS.md).

---

## 2026-08-01 · The score you see is never the score the model returned

Trigger:  a review's score not matching the model's raw output in the run trace
Cause:    `reviewPullRequest` recomputes the score with `scoreFromFindings(ground.kept)` after
          the citation gate, so the score, the findings list, and the deterministic blocker
          count always agree with each other.
Takeaway: when a score looks wrong, look at which findings were **dropped** by grounding
          first — the drop reasons are emitted as events and stored in the trace.
Status:   → promoted to `CLAUDE.md` (Conventions)

## 2026-08-01 · The grounding gate runs once, after the reduce

Trigger:  wondering whether map-reduce grounds per chunk
Cause:    each chunk returns its own partial `Review`; they are merged by `reduceReviews`, and
          only the merged set goes through `groundFindings`. One gate, one code path, both
          strategies.
Takeaway: do not "optimise" by gating per chunk — it would drop findings that the reduce step
          is meant to keep, and it would give two different behaviours for single-pass and
          map-reduce.
Status:   → promoted to `docs/prompt-contract.md`
