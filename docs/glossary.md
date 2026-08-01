# Glossary

The domain words this codebase uses in a specific, non-obvious way. When a term here
conflicts with your intuition, this file wins.

## Review objects

**Agent** — a configured reviewer: name, provider, model, `system_prompt`, `strategy`,
`ci_fail_on` gate, `repo_intel` toggle. Rows in `agents`. Editing an agent snapshots the old
config into `agent_versions`, so past runs stay reproducible.

**Run** — one agent's single attempt at one PR. Row in `agent_runs` with
`status ∈ {running, done, failed, cancelled}`, timings, token counts, grounding summary.
The `run_id` exists **before** any LLM call so the UI can subscribe to its SSE stream.

**Review** — the persisted *result* of a run: verdict, summary, score, model. Row in
`reviews`, linked to its `run_id`. One run produces at most one review; a failed run
produces none.

**Finding** — a single issue: file, line range, severity, title, rationale, optional `kind`.
Only findings that survived grounding are persisted.

**Run trace** — one JSON document per run in `run_traces`: the full `prompt_assembly`
(section by section), tool calls, raw model output, and the complete event log. Written even
when the run fails or is cancelled — it is the only durable record of *why*.

## Pipeline terms

**Grounding / citation gate** — the mechanical check that a finding cites a line actually
present in the diff. Ungrounded findings are dropped, never softened. Summary format is
`kept/total passed`, e.g. `3/4 passed`.

**Score** — 0–100, recomputed from the findings that survived grounding. The number the model
returns is discarded.

**Verdict** — the model's overall opinion (`approve` / `comment` / `request_changes`). It is
displayed, but it never drives gating.

**Blocker** — a finding whose severity meets or exceeds the agent's `ci_fail_on` policy
(`never` / `critical` / `warning` / `any`). Blockers, not the verdict, decide whether a
review would fail a CI check.

**Single-pass vs map-reduce** — the review strategy. `auto` picks map-reduce only when the
diff is both large (>400 changed lines) **and** multi-file; otherwise one LLM call for the
whole diff.

**Untrusted block** — any external text wrapped in `<untrusted source="…">`: the diff, the PR
description, the repo map, caller signatures, spec chunks. Data, never instructions.

**Injection guard** — the fixed security paragraph appended to every agent's system prompt.
It states that untrusted content cannot descope the review, in any language.

## Repo intelligence

**Indexed** — the repo has been walked, its symbols and import graph extracted, file rank
computed, and a repo map cached. Drives the *Indexed* badge and every `repoIntel.*` answer.

**Repo map / skeleton** — a token-budgeted digest of the top-ranked symbols by signature,
injected into the prompt as `## Repo skeleton`.

**File rank** — PageRank over the import graph combined with git hotness. A changed file in
the top 5% earns a "high blast risk" note in the task line.

**Blast radius** — the set of symbols and callers impacted by a change. Facade method exists;
the product feature arrives in L04.

**Degraded** — a `repoIntel` answer returned when the feature is off or the repo is not
indexed. Empty result, no exception, prompt section omitted.

## Platform

**Workspace** — the tenancy boundary. Every domain row carries `workspace_id`; MVP has
exactly one, resolved by `LocalNoAuthProvider`.

**Container** — the DI composition root (`server/src/platform/container.ts`). Holds config,
db, job runner, run bus, and lazily built adapters. Tests swap adapters via
`ContainerOverrides`.

**Adapter / port** — an interface in `@devdigest/shared/adapters.ts` (LLM, GitHub, git, code
index, secrets, auth, embedder) with a real implementation under `server/src/adapters/` and a
mock in `server/src/adapters/mocks.ts`.

**Job** — background work through `JobRunner`: clone, index, refresh, poll. Mirrored into the
`jobs` table. Reviews are **not** jobs.

**Run bus** — the in-memory SSE event bus. Lives only in the current process.

## Course terms

**Starter** — what ships on day 1: import a repo, import PRs, run an agent review.

**Lesson (L01–L08)** — one increment that adds back a deliberately removed feature. The DB
schema already contains every table those lessons will fill.

**Slot** — an optional prompt section `reviewer-core` already accepts but the starter does not
feed: `skills` (L02), `specs` (L05), `memory` (L07). An unfilled slot must produce a
byte-identical prompt.
