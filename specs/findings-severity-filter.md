# Findings severity counters and filter

Status: done
Owner: —
Packages touched: server, client, e2e

> **Round 1 shipped, then was reopened.** Everything below the first horizontal rule is the
> original spec, kept verbatim — it is still an accurate description of what round 1 built.
> Round 2 is appended at the end: it reconciles the feature with the unpacked design prototype
> and with two requirements of the lesson brief that round 1 read from screenshots.

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

- [x] Selecting a severity changes the visible list; selecting two shows the union.
- [x] With no severity selected, the panel renders exactly as it does today.
- [x] Filtering does not refetch from the API and triggers no model call.
- [x] A filter that matches nothing shows the existing "no findings match" empty state.
- [x] A severity whose count is zero renders muted, is not clickable, and cannot strand the
      panel on an empty list.
- [x] Two run panels on the same PR filter independently.
- [x] The PR list shows the latest review's counts; a never-reviewed PR shows `—`; a reviewed
      PR with no findings shows `0`, not `—`.
- [x] A timeline row for a settled run shows its severity counters and keeps its blockers
      suffix; a run whose review was deleted falls back to the plain "{n} finding(s)" text.
- [x] `GET /pulls/:id` still succeeds without `findings_by_severity` in its payload.
- [x] The counters sum to the finding count already shown in the accordion header.
- [x] `git status server/src/db/migrations` stays clean.

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

---

# Round 2 — design parity

Status: done

## Context

Round 1 was built from two screenshots of the design. The design itself later arrived as a
runnable, unpacked prototype (`DevDigest-Design-unpacked/`, React sources per screen), and
reading it turned up three things no screenshot could show, plus two requirements of the lesson
brief that had been satisfied only in spirit:

- The chip row **rests with all three severities active** (`src/10-findings.jsx:105`); round 1
  rested with all three inactive.
- Both counter surfaces open a **hover popover listing the findings behind the numbers**
  (`src/12-prdetail_runs.jsx:38-54`, used from `src/14-screen_dashboard.jsx:58`). Round 1 had
  only a native `title`.
- The counters are **bare text on a dotted rule**, not filled severity pills
  (`src/14-screen_dashboard.jsx:55`, `src/12-prdetail_runs.jsx:67`).
- The brief asks for a counter **on the PR page** reading "3 CRITICAL · 5 WARNING · 2
  SUGGESTION". Round 1 put chips inside each run's panel, so a PR with several runs had no
  single answer.
- The brief asks that **clicking a level shows only its findings**. Round 1's click *added* a
  level to a selection.

## In scope

- Chip row resting state `null` (all active) with isolate-on-first-click; transitions in
  `nextSelection` (`FindingsPanel/helpers.ts`).
- `FindingsTooltip` — a new shared component under `pulls/_components/`, opened on hover by the
  PR-list column and the timeline row.
- `SeverityCounters` redrawn as icon + count in the severity colour on a dotted underline, with
  a `gap` prop (8 in the list, 10 in the timeline) and optional popover props.
- `useLatestReviewFindings` — hover-armed query for the PR list, sharing the `["reviews", prId]`
  cache key with `usePrReviews`.
- `PrSeveritySummary` in the PR header, tallying every finding on the PR.
- Deterministic tie-break on both list aggregates (`desc(created_at), desc(id)` /
  `desc(ran_at), desc(id)`), plus integration cover for latest-review-only and summary-exclusion.
- `lineLabel` lifted to `src/lib/findings.ts`, now shared by `FindingCard` and the popover.

## Out of scope

- The design's **"All categories" chip** after the toolbar divider. It has no state anywhere in
  the prototype and no category filter exists; a dead control is worse than a missing one.
- The design's **"Hide low confidence" position**. The design puts the divider before the
  category chip and the toggle hard right; with the category chip omitted, the divider carries
  `marginLeft: auto` and the result is visually identical.
- Counting the **latest review only** on the PR-page summary. The header must agree with the
  findings listed under it, which is every run's.
- **Indexes on `findings.review_id` / `reviews.pr_id`** — see Open questions.
- A URL-persisted filter, category filtering, clickable read-only counters — all still out, as
  in round 1.

## Decisions

- **Hybrid chip semantics.** The design's resting state and the brief's click behaviour
  contradict each other: from "all on", the design's click *hides* a level, while the brief
  wants "only this level". Resting at `null` and isolating on the first click satisfies both,
  and normalising an empty or full selection back to `null` keeps one canonical "show all" so
  the next click is predictable.
- **The popover never fetches.** It is presentational; the caller decides it is open and hands
  over the findings. The timeline already holds them; the PR list arms a query on first hover
  rather than loading N PRs' findings for a panel most rows never open.
- **The PR-list popover reuses `["reviews", prId]`.** The hovered row is usually the clicked
  row, so the detail page opens with its reviews cached. `select` is per-observer, so the detail
  page still receives the full list.
- **`latestReviewFindings` re-implements the server's picking rule** (newest `kind: 'review'`,
  summaries excluded) rather than trusting arrival order — otherwise the popover could list
  findings the numbers above it never counted.
- **Two different tallies, on purpose.** The PR list counts the latest review; the PR header
  counts every finding on the PR. The list sits beside a SCORE ring describing one review, and
  summing there would triple-count a defect three agents each found. The header sits above the
  list of findings it describes, and disagreeing with that list is the one thing it must not do.
- **Zeros render on the header summary**, unlike the read-only counters. It is a fixed
  scoreboard; a row that changes shape between PRs is harder to scan than one that does not.
- **`tableCard` drops `overflow: hidden`** so the popover can escape the card. The design does
  the same (`src/14-screen_dashboard.jsx:111`); the cost is that rows no longer clip to the
  card's rounded corners.
- **The tie-break buys stability, not correctness.** `id` is a random uuid, so it cannot say
  which of two rows sharing a `created_at` is newer — but without it the winner is whatever the
  planner returned, and two identical requests could disagree. A monotonic key would mean a
  migration.
- **Counts still exclude confidence-hidden findings** (a deviation from the design, which tallies
  over everything). A chip must not advertise a finding the toggle has hidden; the seed's 0.62
  SUGGESTION exists to demonstrate exactly that.

## Acceptance criteria

- [x] The chip row loads with all three severities active and the full list visible.
- [x] Clicking a severity from the resting state shows only that severity's findings.
- [x] A second severity adds to the selection; removing the last one returns to showing all.
- [x] Hovering the PR list's FINDINGS cell opens a popover listing that review's findings, and
      the first hover is what triggers the request.
- [x] Hovering a timeline row's counters opens the same popover with no request at all.
- [x] The popover opens upwards for rows in the lower half of the PR list.
- [x] The counters render as coloured icon + count on a dotted underline, with no pill fill.
- [x] The PR header shows `CRITICAL n · WARNING n · SUGGESTION n` across every finding on the
      PR, and the numbers match the "Agent runs" tab count.
- [x] `GET /repos/:id/pulls` counts the newest `kind='review'` row and ignores summaries.
- [x] Two identical list requests report the same tally when two reviews share a timestamp.
- [x] `git status server/src/db/migrations` stays clean.

## Test plan

- client unit — `nextSelection` state machine; `latestReviewFindings` (newest, summaries
  excluded, empty); `lineLabel`.
- client component — `FindingsPanel` resting state and isolate/add/remove/reset;
  `SeverityCounters` visual contract and popover open/close/onHover; `FindingsTooltip` count,
  anchor, markdown stripping, empty; `PRRow` hover-armed query and popover placement;
  `PrSeveritySummary` scoreboard.
- server `*.it.test.ts` — newest-review-wins with a summary row present; a shared timestamp
  yields the same tally twice.
- e2e — still no new flow; flows 02 and 04 were re-read against the changed markup and assert
  only text this round does not touch.

## Risks

- `tableCard` is now `overflow: visible`; any future absolutely-positioned child of a row can
  escape the card, and the last row's corners no longer clip.
- The popover is rendered inside the clickable PR row, so a click landing on it navigates. It
  has no interactive content, which is why this is tolerable rather than fixed.
- Two tallies with different rules now exist on two screens. Each is documented at its call
  site; a third surface adopting the wrong one would be a silent inconsistency.
- jsdom's computed-style parser drops declarations containing `var()`, so `toHaveStyle` cannot
  assert any token-based colour. Tests read the inline `style` attribute instead.

## Open questions

- **Indexes on `findings.review_id` and `reviews.pr_id`.** Postgres does not index foreign keys
  automatically, so both list aggregates are sequential scans that grow with the total number of
  findings rather than with the page. Fixing it means a migration, which every version of this
  spec has deliberately avoided. Deferred, not dismissed.

