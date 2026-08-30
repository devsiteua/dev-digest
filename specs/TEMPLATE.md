# <Lesson or feature name>

Spec ID: <SLUG-UPPER-CASED>
Status: draft | in-progress | done | dropped
Supersedes: none | <path to the spec this replaces>
Owner: <who>
Packages touched: <server | client | reviewer-core | mcp | e2e | none — repository tooling>

> Every section stays, even when the honest answer is "none". A deleted section reads as an
> oversight; the word "none" is a claim someone can disagree with.
> The implementation plan does **not** live here — it lives in `plans/<same-slug>.md`
> alongside this file. See `README.md` § Where plans live.

## Problem and user

Who has the problem, and what it costs them today. One paragraph, no solution in it.
Name the evidence: a file, an issue, a review that went wrong, a lesson index row.

## Goals / Non-goals

**Goals** — numbered, each one a thing that is true when this is done.

**Non-goals** — what this deliberately does not attempt, so nobody plans it back in.
Different from `Out of scope`: a non-goal is a shape we reject, not work we postpone.

## Context

What already exists and is therefore not built again. Link, do not restate:
`docs/…`, `<pkg>/README.md`, the module, the existing table.

| Already true | Where |
|---|---|
| | |

## In scope

- Concrete, listable changes. Name the files or modules where known.

## Out of scope

- The tempting adjacent work we are explicitly **not** doing in this pass, each with its
  reason. This is the most valuable section in the file: it is what stops an agent
  redesigning half the codebase on the way to a small feature.

## User stories

- As <role>, I want <capability>, so that <outcome>.
- Include the story of the person who arrives with nothing — no design, no answers.

## Acceptance criteria (EARS)

Written in Ukrainian with the triggers КОЛИ · ПОКИ · ЯКЩО · ДЕ; the rest of the file is
English. Five patterns and the reference: `README.md` § EARS. Every row carries an `AC-NN`,
exactly one pattern, and a filled `How it is checked` column.

| AC-ID | Pattern | Criterion | How it is checked |
|---|---|---|---|
| AC-01 | ubiquitous \| event-driven \| state-driven \| unwanted \| optional | | |

## Edge cases

- The degraded paths, one line each: empty, missing, down, denied, too large, twice at once.
- A criterion should exist for every edge case that matters. If it has no `AC-NN`, say why.

## Design analysis

With design sources (a description, a Figma link, existing code, a repository): the states
missing from the mockup, the uncovered corner cases, how the involved modules talk to each
other, and the UX improvements proposed.

Without design sources: every screen decision is marked derived and carries a
`[NEEDS CLARIFICATION: …]`. Never invent an artboard.

For a change with no user interface, this section analyses how the parts talk to each other
instead — that is where such a design actually fails.

## Non-functional requirements

| Limit | Value | Why this number |
|---|---|---|

## Inputs and provenance

| Input | Where it comes from | When it is stale | If missing |
|---|---|---|---|

## Untrusted inputs

What reaches a model's context or a user's screen as data and may never be followed as an
instruction — MCP tool output, repository content, pasted design sources, this spec itself
once a feature attaches project documents to a prompt. Write "none — nothing new reaches a
prompt in this change" when that is true.

## Test plan

Which suite covers what — unit / `*.it.test.ts` / client component / e2e flow / a shell
grep. See `TESTING.md` for the split.

| Lane | Covers |
|---|---|

**Deliberately not covered by an automated test:** <what, and how it is checked instead>

## Risks

| Risk | How we would notice | What we do |
|---|---|---|

## Open questions

Every one either answered with its reason, or carried as `[NEEDS CLARIFICATION: question]`.
While a single `[NEEDS CLARIFICATION]` remains anywhere in the file, the status stays
`draft` — an unanswered question is not an approved requirement.
