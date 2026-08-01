# L01 — Run cost badge + severity filter on findings

Status: draft
Owner: —
Packages touched: server, client

> Drafted from the lesson table in the root `README.md`. Confirm the exact scope with the
> lesson material before moving to `in-progress`.

## Goal

After a review, the user can see **what that run cost** and can **narrow the findings list to
the severities they care about**.

## Context

Cost tracking was deliberately stripped out of the starter (commits `d45ab0d`, `58c6ac7`),
leaving the plumbing in place:

- `reviewPullRequest` already returns `costUsd` in its `ReviewOutcome`
  (`reviewer-core/src/review/run.ts`) — the server currently ignores it.
- `LLMProvider` responses already carry `costUsd`; OpenAI/Anthropic compute it via
  `server/src/adapters/llm/pricing.ts`, OpenRouter via the live `PriceBook`
  (`server/src/platform/price-book.ts`).
- `agent_runs` has **no** cost column — that is the missing link.
- Findings are already sorted by severity in
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts`,
  but there is no filter.

## In scope

- New migration adding a nullable `cost_usd` column to `agent_runs` (`pnpm db:generate`).
- `ReviewRunExecutor` persists `outcome.costUsd` on run completion; `null` stays `null` when
  the provider cannot price the model.
- Cost exposed on the run DTOs already returned by `GET /pulls/:id/runs` and the run trace
  stats, with the shared Zod contract updated in **both** `vendor/shared` copies.
- Cost badge in the run history / run status UI, hidden (not zeroed) when cost is unknown.
- Severity filter control on the findings panel, with the active filter reflected in the
  findings count.

## Out of scope

- Per-PR or per-repo cost aggregation, budgets, and the cost dashboard (L08).
- Re-pricing historical runs — rows created before the migration keep `null`.
- Persisting cost on `reviews`; the run is the unit of cost.
- Any change to grounding, scoring, or prompt assembly.

## Acceptance criteria

- [ ] A completed run stores a non-null `cost_usd` when the provider reports one.
- [ ] A run on a model with no known price completes normally and stores `null`.
- [ ] Failed and cancelled runs still complete their row and trace; cost is `null`.
- [ ] The badge shows the cost for priced runs and is absent (not `$0.00`) otherwise.
- [ ] Filtering findings by severity changes the visible list and the displayed count, and
      does not refetch from the API.
- [ ] With no filter selected, the panel renders exactly as before this lesson.
- [ ] Server and client `vendor/shared` copies remain byte-identical for the changed contract.

## Test plan

- server unit — executor maps `outcome.costUsd` onto the completion payload, including the
  `null` path.
- server `*.it.test.ts` — a run through the real DB round-trips `cost_usd`.
- client component — `FindingsPanel` filter behaviour, including "no findings match".
- e2e — not required; no new user journey, and flows must stay LLM-free.

## Risks

- Forgetting the mirror edit in `client/src/vendor/shared` → type drift that only surfaces at
  runtime. Diff both copies before committing.
- OpenRouter pricing is fetched live and degrades to a static table; do not let a cold or
  failed price lookup fail the run.

## Open questions

- Display currency/precision: `$0.0031` vs `0.31¢`?
- Should the badge appear on the run row only, or also inside the run trace drawer?
