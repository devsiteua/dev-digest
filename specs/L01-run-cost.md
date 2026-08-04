# L01 — Run cost, end to end

Status: done
Owner: —
Packages touched: server, client, reviewer-core (test only)

## Goal

The user can see what reviewing costs — the running total per PR in the PR list, and the cost
of each individual run on the PR detail timeline, on each review-run header, and in the run
trace — without a single extra model call.

## Context

The number already existed; only the wiring was missing. Cost was deliberately stripped from
the starter so this lesson could rebuild it:

- `d45ab0d` dropped `agent_runs.cost_usd` (migration `0009`), `cost_usd` from `RunStats` /
  `RunSummary`, and the COST tile + `formatCost` in the run trace drawer.
- `58c6ac7` removed the `{tok} tok · $cost` line from the Agent runs timeline rows.
- The PR-list cost column never existed — `PrMeta` had no cost field at all.

What was left in place, and what this lesson reconnects to:

- `reviewPullRequest` returns `costUsd` on its `ReviewOutcome`
  (`reviewer-core/src/review/run.ts`); the executor was destructuring around it.
- `LLMProvider` results already carry `costUsd`. OpenRouter asks the API for the real
  generation cost (`usage: { include: true }`, `reviewer-core/src/llm/openrouter.ts`), falling
  back to the live `PriceBook` (`server/src/platform/price-book.ts`) and then to the static
  table (`server/src/adapters/llm/pricing.ts`).

## In scope

- Migration `0010` adding a nullable `cost_usd` to `agent_runs` (`pnpm db:generate`).
- `ReviewRunExecutor` persists `outcome.costUsd` on completion and into the trace `stats`;
  failure and cancellation paths persist `null`.
- `cost_usd` on `RunSummary` (`GET /pulls/:id/runs`), `RunStats` (the trace document), and
  `PrMeta` (`GET /repos/:id/pulls`) — mirrored in **both** `vendor/shared` copies.
- A per-PR aggregate on the list endpoint: the **sum over every `done` run** of that PR,
  computed on read.
- Client: `lib/format.ts` (`formatCost`, `formatTokenCount`) and a `RunCostBadge` component,
  rendered in four places — PR list column, Agent runs timeline row, review-run accordion
  header, run trace Stats tile.

## Out of scope

- Sorting or filtering the PR list by cost, and the FINDINGS column the mockup shows (the list
  has never had one).
- Per-repo totals, budgets, and the cost dashboard (L08).
- Re-pricing historical runs — rows created before migration `0010` keep `null` forever.
- Persisting cost on `reviews`; the **run** is the unit of cost.
- The findings severity filter, previously bundled into this spec — see
  [`findings-severity-filter.md`](findings-severity-filter.md).
- Any change to grounding, scoring, or prompt assembly.

## Decisions

- **PR-list cost is the SUM over every `done` run of the PR.** Corrected after the L01 mentor
  review; the column first shipped as the latest run's cost only. One review by three agents is
  three `agent_runs` rows, so "latest run" showed one third of the bill — an arbitrary third, at
  that (whichever agent finished last). Cost is additive in a way `score` and `findings` are
  not: the argument against summing those (three agents finding one defect must not count it
  three times) is about **defects**, and it was wrongly carried over to **money**. Three agents
  burn three real bills; a re-review burns another. The column means "what has reviewing this PR
  cost so far", and it is the one place in the row that is not latest-review-only.
- **`null` and `0` are different.** `null` = unknown (unpriced model, or never reviewed) and
  renders `—`. `0` = a genuinely free model (e.g. `z-ai/glm-4.7-flash`, priced 0/0) and renders
  `$0.00`. The engine already encodes this: one unpriced call poisons the whole outcome to
  `null` rather than contributing zero. **The per-PR sum inherits that rule** — one unpriced run
  makes the total `null`, because a partial sum shown as a total is a wrong number stated as
  fact.
- **One formatter, adaptive precision.** Four decimals minus trailing zeros, floored at two —
  reproducing every value in the design (`$0.06`, `$0.014`, `$0.003`, `$0.0013`) with no
  per-call-site precision flag.
- **Only `done` runs feed the PR-list column.** A `running` row has no cost yet, and failed,
  cancelled and reaped runs are completed with NULL usage; either would poison the sum to `—`
  even though every finished run was priced.

## Acceptance criteria

- [x] A completed run stores a non-null `cost_usd` when the provider reports one.
- [x] A run on a model with no known price completes normally and stores `null`.
- [x] Failed and cancelled runs still complete their row and trace; cost is `null`.
- [x] The UI shows `—` for unknown cost and `$0.00` for a genuinely free run.
- [x] The PR list shows the sum of every `done` run of the PR; a newer `running` row neither
      changes nor blanks that total.
- [x] A PR with one unpriced `done` run reports `null` for the whole total, not a partial sum.
- [x] A trace document written **before** this lesson still parses and renders (`RunStats.cost_usd`
      is `.nullish()`, not `.nullable()`).
- [x] Server and client `vendor/shared` copies gain byte-identical edits.

## Test plan

- reviewer-core unit — `costUsd` null-propagation: summed when every call is priced, `null`
  when any call is not, `0` for a free model (`reviewer-core/test/run.test.ts`).
- server unit — `RunTrace` parses a **legacy** `stats` block with no `cost_usd` key
  (`server/test/contracts.test.ts`).
- server `*.it.test.ts` — cost round-trips DB → `GET /pulls/:id/runs` → trace → `GET
  /repos/:id/pulls`; a never-reviewed PR reports `null`; a second `done` run adds to the PR-list
  total; a `running` row neither changes nor blanks it; one unpriced `done` run makes the total
  `null` (`server/test/reviews.it.test.ts`).
- client — `lib/format.test.ts` (every value in the design, plus the `≥ $1` case a naive
  trailing-zero strip gets wrong) and `RunCostBadge.test.tsx` (both shapes, `—` vs `$0.00`).
- e2e — not required; no new user journey, and flows must stay LLM-free.

## Risks

- Forgetting the mirror edit in `client/src/vendor/shared` → type drift that only surfaces at
  runtime. Diff both copies before committing.
- OpenRouter pricing is fetched live and degrades to a static table; a cold or failed price
  lookup must never fail the run — it yields `null` cost, which the UI renders as `—`.
- `RunStats.cost_usd` must stay `.nullish()`. Tightening it to `.nullable()` would 500 the
  trace drawer for every run recorded before migration `0010`.

## Open questions

None — the display-precision and badge-placement questions from the draft are answered under
**Decisions** above.
