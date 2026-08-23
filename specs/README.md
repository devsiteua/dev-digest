# Specs — what to build

A spec answers **"what should exist when this is done"**. It is deliberately short-lived:
once the work ships, the spec is marked `done` and stops being linked from any `CLAUDE.md`.

Not to be confused with:

- `README.md` — what a package is and how to run it (permanent, human-facing)
- `docs/` — how something works and *why* it was decided that way (permanent)
- `INSIGHTS.md` — what we learned the hard way (append-only journal)
- `e2e/specs/` — **unrelated**: those are agent-browser flow definitions, not lesson specs

## Rules

1. One file per lesson or feature: `L0X-kebab-case-name.md`. Non-lesson work: `kebab-case.md`.
2. Copy `TEMPLATE.md`. Every section stays, even if the answer is "none".
3. **`Out of scope` is the most valuable section.** It is what stops an agent from
   redesigning half the codebase on the way to a small feature.
4. Acceptance criteria must be checkable by a human or a test — not aspirations.
5. Status transitions: `draft` → `in-progress` → `done` | `dropped`. Never delete a spec;
   history explains why the code looks the way it does.
6. When a spec closes, remove its pointer from the relevant `CLAUDE.md` **Read when** list.

## Lesson index

Derived from the course plan in the root `README.md`. Specs are written just before the
lesson starts, not upfront.

| Lesson | Scope | Spec |
|--------|-------|------|
| L01 | Run cost badge · severity counters and filter on findings | [`L01-run-cost.md`](L01-run-cost.md) `done` · [`findings-severity-filter.md`](findings-severity-filter.md) `done` (incl. Round 2 — design parity) |
| L02 | Skills in the product · Conventions extractor | [`L02-skills.md`](L02-skills.md) `done` (incl. Round 2 — the four gaps the mentor named) · [`L02-conventions-extractor.md`](L02-conventions-extractor.md) `done` · [`pr-self-review.md`](pr-self-review.md) `done` (repo tooling, adjacent) |
| L03 | Intent layer · Smart Diff | [`L03-intent-layer.md`](L03-intent-layer.md) — Intent layer `done` (incl. Round 2 — conformance with the course brief: hunk headers, `missing_context`, link widening, token/prompt-composition logging, the scope gate, the read-only agent boundary) · [`L03-smart-diff.md`](L03-smart-diff.md) — Smart Diff `done` (classifier + `GET /pulls/:id/smart-diff`, the seeded nine-file demo PR, the reviewer-ordered Files tab with findings badges that jump to the line; incl. Round 2 — the two gaps the mentor named: `verify:l03` over `classifyFile`, and a line badge that opens the finding) |
| L04 | `devdigest-mcp` server · Blast Radius | — |
| L05 | Project Context Folder · Onboarding generator · PR Brief card | — |
| L06 | Eval pipeline · Secret/Phantom gates · Plan Verifier · Export to CI | — |
| L07 | Multi-agent review · Run Trace / Live Log · Persistent memory | — |
| L08 | Plugin export/import · Agent performance dashboard · weekly digest | — |

## Module-local specs

`server/`, `client/`, and `reviewer-core/` each have their own `specs/` folder for work that
touches only that package. Anything spanning two or more packages — which most lessons do —
belongs here at the root.
