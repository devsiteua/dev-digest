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
   The `Spec ID` in the header is that slug, upper-cased — `L05-SDD-PIPELINE`. A spec that
   replaces an earlier one names it in `Supersedes:`; a `done` spec is never rewritten.
2. Copy `TEMPLATE.md`. Every section stays, even if the answer is "none".
3. **`Out of scope` is the most valuable section.** It is what stops an agent from
   redesigning half the codebase on the way to a small feature.
4. Acceptance criteria must be checkable by a human or a test — not aspirations. Every
   criterion carries an **`AC-NN`** id, numbered from `AC-01` in one flat sequence across the
   whole file, and exactly one of the five EARS patterns below. The id is the thing that
   survives: the plan tags each step `Covers: AC-NN`, and `plan-verifier` returns a row per id.
   Ids are never renumbered once a plan cites them — a dropped criterion leaves its number
   behind, struck through.
5. Status transitions: `draft` → `in-progress` → `done` | `dropped`. Never delete a spec;
   history explains why the code looks the way it does. **A spec stays `draft` while a single
   `[NEEDS CLARIFICATION: …]` marker remains anywhere in it** — that marker is how an agent
   records an unanswered question instead of guessing, and an unanswered question is not an
   approved requirement. Where other write-ups say `approved`, read `in-progress`; where they
   say `implemented`, read `done`.
6. When a spec closes, remove its pointer from the relevant `CLAUDE.md` **Read when** list.

## Where plans live

A spec says *what*; a plan says *how*. They are two files, never one:

| Artefact | Path | Written by |
|---|---|---|
| spec | `specs/<slug>.md`, or `<pkg>/specs/<slug>.md` for single-package work | `spec-creator` |
| implementation plan | `specs/plans/<slug>.md`, or `<pkg>/specs/plans/<slug>.md` | `implementation-planner` |

The plan keeps the same slug as its spec and links back to it in its header. It carries the
four sections a spec does not: `Constraints in force`, `Implementation plan`, `Commit plan`
and `Handoff`.

The separation is a rule, not a preference: `implementation-planner` may never write or edit
a spec (a gap in the requirements goes back to `spec-creator`), so a plan living inside its
spec file would make planning impossible without breaking that rule. Specs written before
L05 carry their plan inline; they are a record of what was true then, not a pattern to copy.

## EARS — the shape every acceptance criterion takes

**EARS** — *Easy Approach to Requirements Syntax* — is a way of phrasing a requirement that
separates the condition from the system's response. Alistair Mavin, Philip Wilkinson, Adrian
Harwood and Mark Novak, then at Rolls-Royce, presented it at the 17th IEEE International
Requirements Engineering Conference (RE'09) in 2009.

Five patterns. The trigger words are Ukrainian and `shall` stays in brackets as the marker of
an obligation — that pairing is this course's local convention, not part of EARS itself:

| Pattern | When to use it | Example |
|---|---|---|
| **Ubiquitous** | the requirement always holds | Система повинна (shall) журналювати кожну спробу автентифікації. |
| **Event-driven** | a response to something that happens | КОЛИ користувач надсилає форму входу, система повинна (shall) перевірити облікові дані. |
| **State-driven** | behaviour that holds while a state lasts | ПОКИ триває синхронізація, система повинна (shall) показувати прогрес. |
| **Unwanted behaviour** | a response to an undesirable condition | ЯКЩО перевірка тричі не вдалася за 60 секунд, ТОДІ система повинна (shall) тимчасово заблокувати обліковий запис. |
| **Optional feature** | behaviour that exists only behind an enabled option | ДЕ увімкнено MFA, система повинна (shall) вимагати TOTP-код після пароля. |

What the patterns are for, in one line: a criterion that names its trigger can be failed by a
test, and one that does not can only be argued about.

| Vague | Checkable |
|---|---|
| «має нормально працювати на великих репозиторіях» | КОЛИ репозиторій перевищує поріг індексації, система повинна (shall) будувати огляд лише з детермінованих фактів, не читаючи всі файли повністю. |
| «не має падати, якщо модель недоступна» | ЯКЩО структурований виклик моделі не вдався, ТОДІ система повинна (shall) показати детермінований огляд із причиною деградації. |
| «має підказувати, з чого почати читати» | Система повинна (shall) впорядкувати reading path за рангом файлів у графі імпортів. |

**Citation to carry across.** Alistair Mavin, Philip Wilkinson, Adrian Harwood, Mark Novak,
*Easy Approach to Requirements Syntax (EARS)*, 17th IEEE International Requirements
Engineering Conference (RE'09), Atlanta GA, 31 August – 4 September 2009, pp. 317–322. Record:
<https://research.manchester.ac.uk/en/publications/easy-approach-to-requirements-syntax-ears/>.
EARS came out of Rolls-Royce, where the authors were analysing airworthiness regulations for a
jet engine control system — which is why its patterns are built around conditions and
obligations rather than around user stories.

**The one language exception in this repository.** The acceptance-criteria table is written in
Ukrainian; every other line of a spec, and every other repo file, is English (root
`CLAUDE.md` § Conventions).

## Lesson index

Derived from the course plan in the root `README.md`. Specs are written just before the
lesson starts, not upfront.

| Lesson | Scope | Spec |
|--------|-------|------|
| L01 | Run cost badge · severity counters and filter on findings | [`L01-run-cost.md`](L01-run-cost.md) `done` · [`findings-severity-filter.md`](findings-severity-filter.md) `done` (incl. Round 2 — design parity) |
| L02 | Skills in the product · Conventions extractor | [`L02-skills.md`](L02-skills.md) `done` (incl. Round 2 — the four gaps the mentor named) · [`L02-conventions-extractor.md`](L02-conventions-extractor.md) `done` · [`pr-self-review.md`](pr-self-review.md) `done` (repo tooling, adjacent) |
| L03 | Intent layer · Smart Diff | [`L03-intent-layer.md`](L03-intent-layer.md) — Intent layer `done` (incl. Round 2 — conformance with the course brief: hunk headers, `missing_context`, link widening, token/prompt-composition logging, the scope gate, the read-only agent boundary; incl. Round 3 `done` — the mentor's three items: an English rule in `INTENT_SYSTEM_PROMPT`, amber Live Log events for the derivation's own external calls, and the `security-reviewer` subagent) · [`L03-smart-diff.md`](L03-smart-diff.md) — Smart Diff `done` (classifier + `GET /pulls/:id/smart-diff`, the seeded nine-file demo PR, the reviewer-ordered Files tab with findings badges that jump to the line; incl. Round 2 `done` — the two gaps the mentor named: `verify:l03` over `classifyFile` (and the migration it could not classify), and a line badge that opens the finding) |
| L04 | `devdigest-mcp` server · Blast Radius | [`L04-mcp-server.md`](L04-mcp-server.md) `done` — `devdigest-mcp`, a fifth package (`mcp/`) speaking stdio MCP over the API: five tools, no I/O of its own. `get_blast_radius` shipped there as a declared stub that failed loudly, and was replaced in part two; incl. Round 2 — the mentor's three items: a declared client `timeout`, `provider` off the model's surface, and a compact JSON block per tool · [`L04-blast-radius.md`](L04-blast-radius.md) `done` — part two: `GET /pulls/:id/blast` served from the index alone (no AST parse, no model call), the Blast tab with `file:line` pinned to `indexed_sha`, six honest states instead of an empty array, the stub replaced by a projection of the real contract, one optional paragraph behind a button, and `devdigest review --mode working` |
| L05 | Project Context Folder · Onboarding generator · PR Brief card | [`L05-sdd-pipeline.md`](L05-sdd-pipeline.md) `draft` — the spec-driven pipeline itself (`spec-creator`, `implementation-planner`, `plan-verifier`, `/implement`, `/workflow-retro`); the two feature specs are written **by** that pipeline |
| L06 | Eval pipeline · Secret/Phantom gates · Plan Verifier · Export to CI | — |
| L07 | Multi-agent review · Run Trace / Live Log · Persistent memory | — |
| L08 | Plugin export/import · Agent performance dashboard · weekly digest | — |

## Module-local specs

`server/`, `client/`, and `reviewer-core/` each have their own `specs/` folder for work that
touches only that package. Anything spanning two or more packages — which most lessons do —
belongs here at the root.
