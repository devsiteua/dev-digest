# Docs — how things work, and why they were decided that way

An index of `docs/`. Every file here is **permanent**: it describes a mechanism that
exists and the reasoning behind it. If a document stops being true, it gets corrected —
it does not get archived.

## Not to be confused with

`specs/README.md` draws these lines; this table repeats only the shape of them.

| Place | Answers | Lifetime |
|---|---|---|
| `docs/` | how something works and **why** it was decided that way | permanent |
| `specs/` | what should exist when the work is done | short-lived — `draft` → `done`, then unlinked |
| `<pkg>/README.md` | what a package is and how to run it | permanent, human-facing |
| `INSIGHTS.md`, `<pkg>/INSIGHTS.md` | what we learned the hard way | append-only journal |
| `<pkg>/docs/` | how to author one thing inside that package | permanent, package-local |
| `e2e/specs/` | agent-browser flow definitions — **unrelated** to lesson specs | data |

## Index

| Document | The question it answers | Owned by |
|---|---|---|
| [`architecture.md`](architecture.md) | How does a review actually run, end to end — packages, sequence, the five invariants, the two background mechanisms, tenancy | whoever changes the flow |
| [`glossary.md`](glossary.md) | What does this word mean here — review objects, pipeline terms, repo intelligence, platform, course terms | whoever introduces the term |
| [`agent-prompts/`](agent-prompts/README.md) | How a reviewer agent's `system_prompt` becomes the messages a model sees, and what belongs in a skill instead of a prompt | see the warning below |
| [`skills-control-experiment.md`](skills-control-experiment.md) | How do you demonstrate that a skill changes what an agent finds | a one-off writeup; extend rather than repeat |
| [`insights-archive.md`](insights-archive.md) | Which entries were moved out of an active `INSIGHTS.md` to keep it short | the `engineering-insights` skill, in the main session |

Package-local authoring guides live with their package, not here:

| Document | Covers |
|---|---|
| `server/docs/module-anatomy.md` | the files a backend module is made of |
| `client/docs/component-anatomy.md` | the files a component folder is made of |
| `reviewer-core/docs/prompt-contract.md` | what the engine promises the model, and back |
| `e2e/docs/flow-authoring.md` | writing a deterministic `*.flow.json` |
| `TESTING.md` (repo root) | the suite map, the lane split, and what each suite covers |

## Two rules with owners you cannot borrow

- **`agent-prompts/*.md` are mirrors, not documents.** Each of the five reviewer prompts is
  byte-identical to its constant in `server/src/db/seed-prompts.ts`, enforced by
  `server/test/agent-prompts-mirror.test.ts`. Editing one is a **product change**. Only
  `agent-prompts/README.md` is prose you may edit as documentation.
- **`insights-archive.md` belongs to `engineering-insights`.** Nothing else writes there, for
  the same reason nothing else writes to `INSIGHTS.md`: two writers, one append-only file.

## There is no ADR convention here

No `docs/adr/`, no `docs/decisions/`. A decision is recorded in the "why" part of the
document it affects, or as an `Open questions` entry in the spec that raised it. If a proper
decision log is ever wanted, that is its own decision — do not start one file at a time.

## Adding a document

1. Extend an existing document if one already covers the topic. A rival file on the same
   subject is how `docs/` starts contradicting itself.
2. Every claim about a mechanism carries a `file:line`. Prose in a README is a hypothesis
   until you check it — root `INSIGHTS.md` records three committed statements that had
   already stopped being true.
3. Use the vocabulary in `glossary.md`. A missing word is a glossary entry, not an
   improvisation in your own text.
4. Add the file to the index above, and add a pointer line to the **Read when** list of the
   `CLAUDE.md` that should send a reader here.
