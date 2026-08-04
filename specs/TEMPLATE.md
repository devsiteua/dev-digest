# <Lesson or feature name>

Status: draft | in-progress | done | dropped
Owner: <who>
Packages touched: <server | client | reviewer-core | e2e>

## Goal

One or two sentences. What a user can do afterwards that they cannot do now.

## Context

Why now, and what already exists that this builds on. Link, do not restate:
`docs/…`, `<pkg>/README.md`, the relevant module.

## In scope

- Concrete, listable changes. Name the files or modules where known.

## Out of scope

- The tempting adjacent work we are explicitly **not** doing in this pass.
- Refactors that would be nice but are not required for the acceptance criteria.

## Acceptance criteria

- [ ] Checkable by a human or a test. One behaviour per line.
- [ ] Include the degraded/empty path, not only the happy path.
- [ ] Include what must stay unchanged (regressions we refuse to accept).

## Test plan

Which suite covers what — unit / `*.it.test.ts` / client component / e2e flow.
See `TESTING.md` for the split.

## Risks

What could break, and how we would notice.

## Open questions

Answer or delete before moving to `in-progress`.
