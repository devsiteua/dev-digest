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
| L01 | Run cost badge · severity filter on findings | [`L01-run-cost.md`](L01-run-cost.md) `done` · [`findings-severity-filter.md`](findings-severity-filter.md) |
| L02 | Skills in the product · Conventions extractor | — |
| L03 | Intent layer · Smart Diff | — |
| L04 | `devdigest-mcp` server · Blast Radius | — |
| L05 | Project Context Folder · Onboarding generator · PR Brief card | — |
| L06 | Eval pipeline · Secret/Phantom gates · Plan Verifier · Export to CI | — |
| L07 | Multi-agent review · Run Trace / Live Log · Persistent memory | — |
| L08 | Plugin export/import · Agent performance dashboard · weekly digest | — |

## Module-local specs

`server/`, `client/`, and `reviewer-core/` each have their own `specs/` folder for work that
touches only that package. Anything spanning two or more packages — which most lessons do —
belongs here at the root.
