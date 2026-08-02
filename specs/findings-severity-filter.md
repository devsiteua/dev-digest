# Findings severity counters and filter

Status: in-progress
Owner: —
Packages touched: server, client, e2e

> Split out of the original `L01-run-cost-and-severity-filter.md` draft. The cost half shipped
> as [`L01-run-cost.md`](L01-run-cost.md); this half was never started. Rewritten here from a
> panel-only filter to the counters the design actually shows, on all three surfaces.

## Goal

A reviewer can see, at a glance, how many findings of each severity a pull request produced —
in the PR list, on each run in the timeline, and above the findings themselves — and can narrow
a run's findings to the severities they care about, without a refetch and without a model call.

## Context

Severity is already carried end to end: `Severity` is `CRITICAL | WARNING | SUGGESTION`
(`server/src/vendor/shared/contracts/findings.ts`), `findings.severity` is a persisted column,
and findings are already sorted by severity in
`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts`. Only the
display and the control are missing.

Several pieces of this feature are already in the tree, unused:

- `rollupSeverities()` and its `SeverityCounts` type (`server/src/modules/pulls/status.ts`) are
  pure and unit-tested, and nothing imports them. That file's own docstring already says the PR
  list shows "a FINDINGS severity breakdown".
- `GET /repos/:id/pulls` carries a comment claiming the breakdown is *intentionally* not
  surfaced — written when the column was cut, now false.
- `FindingsPanel` already has the "no findings match" empty state (`prReview.noMatchTitle` /
  `noMatchBody`, whose body reads "Adjust the filters **above**") and an unused `divider` style.

`@devdigest/ui` already covers the visual language: `Chip` takes `active` / `onClick` / `icon` /
`count`, and `SeverityBadge` with `compact` renders exactly icon + count.

## In scope

- `SeverityCounts` promoted from `pulls/status.ts` into `@devdigest/shared`, and
  `PrMeta.findings_by_severity` on `GET /repos/:id/pulls`, computed on read from the latest
  review — mirrored in **both** `vendor/shared` copies.
- A FINDINGS column in the PR list between SCORE and STATUS.
- Per-run severity counters on the Agent-runs timeline rows, replacing the plain
  "{n} finding(s)" text and keeping the "· n blockers" suffix.
- A multi-select severity filter on the findings panel: clicking a severity narrows that run's
  list; nothing selected shows everything.
- Seed data extended so all three severities are non-zero and the timeline has a run to render.

## Out of scope

- Persisting the filter in the URL or across reloads.
- Filtering by category, agent, or file.
- Making the timeline or PR-list counters clickable — they are read-only.
- Sorting or filtering the PR list by findings.
- Excluding dismissed findings from any count.
- A per-severity breakdown on `agent_runs` / `RunSummary` (that means a migration; the timeline
  derives its counts on the client instead).
- Changing `ReviewRunAccordion`'s header text or the existing severity sort order.
- `INFO` as a fourth severity. It exists only in the vendored UI kit and two dead client
  constants maps, and can never arrive from the API.

## Decisions

- **Multi-select, and nothing selected means everything.** Single-select cannot express
  "blockers and warnings, hide the noise", which is the actual triage move.
- **All three chips always render on the panel; a zero chip is muted and inert.** A chip that
  disappears reflows the toolbar under the cursor mid-toggle. On the read-only surfaces
  (timeline, list) zero severities are hidden instead — nothing reflows there, and `⛔2 ⚠1`
  reads faster than `⛔2 ⚠1 💡0`.
- **A zero-count severity is dropped from the effective filter.** Otherwise turning on "hide low
  confidence" can empty a selected severity, leaving a muted chip the user can no longer
  un-toggle and a permanently empty list.
- **No reset when a new run completes — React already does it.** `FindingsTab` keys accordions
  by `review.id`, so a new run mounts a fresh panel with an empty filter, while an existing
  run's panel keeps its filter across accept/dismiss.
- **`SeverityCounts` is promoted, not redefined,** and keeps its lowercase keys. It already
  existed in `pulls/status.ts` with no importers; moving it into the contract removes a
  duplicate type and any mapping layer. The uppercase `findings_by_severity` shapes in
  `observability.ts` / `productionize.ts` are L07 stubs and are deliberately left alone.
- **`findings_by_severity` is `.nullish()`, not `.nullable()`** — and not for the reason
  recorded in `INSIGHTS.md` about persisted jsonb. `PrDetail` extends `PrMeta` and
  `GET /pulls/:id` omits the list-only fields entirely, so `.nullable()` would make the key
  required and break that endpoint (and `contracts.test.ts`).
- **The PR-list count is the latest review's, not a sum.** It mirrors `PrMeta.score` and
  `cost_usd`. Summing across reviews would triple-count one defect found by three agents and
  would disagree with the SCORE ring beside it, which describes exactly one review.
- **Dismissed findings are counted**, matching `findings.length` in the accordion header and
  `agent_runs.findings_count`. A fourth notion of "count" is not worth the confusion.
- **Timeline counts are derived on the client** from `run_id` → `review.findings`. `FindingsTab`
  already holds both lists and already joins them by `run_id` for cost. A server field would
  cost a migration or a join on a hot path, and would only add counters for runs whose review
  was deleted — where the findings are gone and a count of them would be a lie.
- **The seed's existing review grows to four findings** rather than gaining a second review. A
  newer second review would become `defaultOpen` and bury the finding the e2e flow asserts on;
  an older one would never reach the list column, which is latest-review-only. Changing one
  assertion string in flow 04 is cheaper and more honest.
- **No migration.** `findings.severity` already exists and every count is computed on read.

## Acceptance criteria

- [ ] Selecting a severity changes the visible list; selecting two shows the union.
- [ ] With no severity selected, the panel renders exactly as it does today.
- [ ] Filtering does not refetch from the API and triggers no model call.
- [ ] A filter that matches nothing shows the existing "no findings match" empty state.
- [ ] A severity whose count is zero renders muted, is not clickable, and cannot strand the
      panel on an empty list.
- [ ] Two run panels on the same PR filter independently.
- [ ] The PR list shows the latest review's counts; a never-reviewed PR shows `—`; a reviewed
      PR with no findings shows `0`, not `—`.
- [ ] A timeline row for a settled run shows its severity counters and keeps its blockers
      suffix; a run whose review was deleted falls back to the plain "{n} finding(s)" text.
- [ ] `GET /pulls/:id` still succeeds without `findings_by_severity` in its payload.
- [ ] The counters sum to the finding count already shown in the accordion header.
- [ ] `git status server/src/db/migrations` stays clean.

## Test plan

- server unit — `rollupSeveritiesByReview` grouping and unknown-severity tolerance
  (`pulls-status.test.ts`); `PrDetail` parses without the new key (`contracts.test.ts`).
- server `*.it.test.ts` — `GET /repos/:id/pulls` reports counts for the grounded findings only,
  `null` for a never-reviewed PR, and zeros for a review that kept none (`reviews.it.test.ts`).
- client unit — `lib/severity.ts` tallies; `FindingsPanel/helpers.ts` filter/sort, including a
  regression that the two-argument call is unchanged.
- client component — the filter chips (multi-select, zero state, empty state, per-panel
  isolation), `SeverityCounters`, and the `RunHistory` counters plus their text fallback.
- e2e — no new flow; `04-pr-findings.flow.json` updates its seeded finding count.

## Risks

- The panel is rendered once per review run in the accordion; filter state must be per-panel, or
  filtering one run would silently filter the others.
- The two `vendor/shared` copies have no build step keeping them in sync — a missed mirror edit
  surfaces only at runtime.
- The PR list's `GRID` track count and `COLUMN_KEYS` length must stay equal, or the header row
  silently misaligns from the data rows.
- `@devdigest/ui` exports a four-value `Severity`; `@devdigest/shared` exports a three-value one.
  A file importing both must alias one.
- Seeding `lastReviewedSha` would flip the demo PR to `reviewed` and drop it out of the PR
  list's default `needs_review` filter, breaking e2e flows 02, 04 and 05.

## Open questions

None — multi-select and filter-reset are answered under **Decisions**.
