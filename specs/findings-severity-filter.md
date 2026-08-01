# Severity filter on the findings panel

Status: draft
Owner: —
Packages touched: client

> Split out of the original `L01-run-cost-and-severity-filter.md` draft. The cost half shipped
> as [`L01-run-cost.md`](L01-run-cost.md); this half was never started.

## Goal

The user can narrow a run's findings list to the severities they care about, without a refetch.

## Context

Findings are already sorted by severity in
`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts`, but there
is no filter control. Every finding for a run is already in the client's cache — this is a
presentation-layer change only, with no new endpoint.

`FindingsPanel` already has an empty-state for "no findings match"
(`prReview.noMatchTitle` / `noMatchBody` in `client/messages/en/prReview.json`), which suggests
the filter was designed for and then removed alongside the cost work.

## In scope

- A severity filter control on the findings panel (CRITICAL / WARNING / INFO).
- The active filter reflected in the displayed findings count.
- Filtering happens client-side over already-fetched findings.

## Out of scope

- Filtering by category, agent, or file.
- Persisting the filter across reloads or in the URL.
- Any server-side filtering or a new endpoint.
- Changing the existing severity sort order.

## Acceptance criteria

- [ ] Selecting a severity changes the visible list and the displayed count.
- [ ] Filtering does not refetch from the API.
- [ ] A filter that matches nothing shows the existing "no findings match" empty state.
- [ ] With no filter selected, the panel renders exactly as it does today.

## Test plan

- client component — `FindingsPanel` filter behaviour, including the "no findings match" path
  and the untouched default rendering.
- e2e — not required; no new journey and flows must stay LLM-free.

## Risks

- The panel is rendered once per review run in the accordion; filter state must be per-panel,
  not global, or filtering one run would silently filter the others.

## Open questions

- Multi-select (show CRITICAL **and** WARNING) or single-select?
- Should the filter reset when a new review run completes and the accordion re-renders?
