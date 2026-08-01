# Insights — cross-package

Append-only. One entry per thing that surprised us, cost us time, or turned out not to be
what it looked like. Package-specific findings go in that package's `INSIGHTS.md`; this file
is only for what spans packages or the repo as a whole.

Written and read by the `engineering-insights` skill — see
[`.claude/skills/engineering-insights/SKILL.md`](.claude/skills/engineering-insights/SKILL.md).

## Sections

Every `INSIGHTS.md` in this repo carries the same seven sections, in this order. An empty one
stays, marked `_None yet._`, so there is always a place to append.

| Section | For |
|---|---|
| What Works | an approach that was tried and held up — reuse it |
| What Doesn't Work | a dead end or antipattern. **Most valuable, most often left empty** |
| Codebase Patterns | a convention or architectural decision the code does not announce |
| Tool & Library Notes | a quirk of a dependency, CLI, or the local environment |
| Recurring Errors & Fixes | a symptom seen more than once, with its fix |
| Session Notes | a dated summary, only when no single entry captures the session. Sparingly |
| Open Questions | left unresolved, so the next session does not re-derive it |

## Entry format

Newest first within a section.

```markdown
### YYYY-MM-DD · One-line title
Trigger:  what we were doing / what we saw
Cause:    what was actually going on
Takeaway: what to do differently next time
Evidence: path/to/file.ts:LINE
Status:   open | resolved | → promoted to <file>
```

An entry must be **non-obvious**, **specific** (names a file, symbol, or number),
**actionable cold**, and **durable**. "Be careful with async" is noise, not a lesson.

**Promotion rule:** an entry that saves us twice becomes a one-line rule in the relevant
`CLAUDE.md` and is marked `→ promoted` here. Keep each file under ~250 lines; once promoted
entries pile up, move them to `docs/insights-archive.md`.

---

## What Works

_None yet._

## What Doesn't Work

### 2026-08-01 · Docs drift found during the first full repo walkthrough

Trigger:  onboarding pass over the whole repository
Cause:    three statements in committed docs no longer match the code —
          (1) `README.md` and `server/README.md` say `DEVDIGEST_CLONE_DIR` defaults to
              `./clones`, but `server/src/platform/config.ts` defaults to
              `~/.devdigest/workspace`;
          (2) `TESTING.md` says `server/package.json` is `skip-worktree`, but no
              skip-worktree flag is set (`git ls-files -v` is clean);
          (3) `.gitignore` carries exceptions for `agent-runner/dist/`, and that package
              does not exist in the starter (it returns in L06).
Takeaway: treat prose in READMEs as a hypothesis, verify against code before acting on it.
          None of these are blocking, but each can burn twenty minutes.
Evidence: server/src/platform/config.ts
Status:   open — fix opportunistically when touching those files

## Codebase Patterns

### 2026-08-01 · A contract that also serializes a persisted jsonb doc needs `.nullish()`, not `.nullable()`

Trigger:  adding `cost_usd` to `RunStats` for L01, mirroring how the pre-removal code
          (commit `d45ab0d`) had declared it as `z.number().nullable()`
Cause:    `RunStats` is not only a response shape — it is the `stats` block **inside** the
          jsonb document stored in `run_traces.trace`, and rows written before the field
          existed have no `cost_usd` key at all. `.nullable()` requires the key to be
          present, so `GET /runs/:id/trace` would have 500'd on every historical run. The
          old code got away with `.nullable()` only because that field had been written
          since day one. Same trap waits on any future `RunStats`/`RunTrace` field.
Takeaway: before tightening or adding a field on `contracts/trace.ts`, ask whether old rows
          in `run_traces` carry it. If not, `.nullish()`. Response-only contracts read
          straight from a table (e.g. `RunSummary`) are free to use `.nullable()`.
Evidence: server/src/vendor/shared/contracts/trace.ts (RunStats.cost_usd);
          server/test/contracts.test.ts ("RunTrace parses a LEGACY stats block")
Status:   resolved — guarded by the legacy-stats fixture test

### 2026-08-01 · The two `vendor/shared` trees have already diverged

Trigger:  comparing `server/src/vendor/shared` with `client/src/vendor/shared`
Cause:    there is no workspace and no build step keeping them in sync — they are two
          physical copies. Five files differ today. The server copy is ahead: it has
          `sessionId` on LLM options, `openrouter` in the `LLMProvider.id` union,
          `CommitFiles`, `AgentManifest`, and `AgentVersionConfig`.
Takeaway: harmless right now (the drift is confined to server-only ports the client never
          imports), but a contract edit **must** be applied to both copies. Diff them before
          committing anything under `vendor/shared`.
Evidence: server/src/vendor/shared vs client/src/vendor/shared
Status:   → promoted to `CLAUDE.md` (Gotchas)

### 2026-08-01 · An empty table in the schema is a future lesson, not dead code

Trigger:  `db/schema/` defines ~35 tables while the starter reads maybe a third of them
Cause:    the schema is intentionally complete from day 1 so lessons L01–L08 only ever add
          columns, never restructure. Same idea in `reviewer-core`: the `skills`, `memory`,
          and `specs` prompt slots exist and are simply never filled by the starter.
Takeaway: never "clean up" an unused table, contract, or prompt slot. Check the lesson table
          in `README.md` first.
Evidence: server/src/db/schema/
Status:   → promoted to `CLAUDE.md` (Gotchas)

## Tool & Library Notes

### 2026-08-01 · `pnpm db:seed` creates zero `agent_runs` — run-related UI cannot be eyeballed

Trigger:  booting `./scripts/dev.sh` to visually confirm the new run-cost column, timeline
          badge, and trace Stats tile
Cause:    the seed populates repos, PRs, agents, reviews, and findings, but **no** runs —
          `select count(*) from agent_runs` on a freshly seeded dev DB is 0. So the PR-list
          COST column, the Agent-runs timeline, and the run trace drawer all render their
          empty state no matter what you changed. Filling them needs a real review, which
          means a real API key and a billable model call.
Takeaway: for anything keyed off `agent_runs` or `run_traces`, the `*.it.test.ts` lane
          (testcontainers + `MockLLMProvider`, which reports usage and cost) is the
          verification — not a browser click-through. Don't burn time booting the stack.
Evidence: server/src/db/seed.ts; server/test/reviews.it.test.ts
Status:   open — seeding a demo run would make run UI reviewable without a model call

### 2026-08-01 · `skills-lock.json` does not describe the skills that are actually on disk

Trigger:  authoring the first hand-written skill, and needing to know whether editing
          anything under `.claude/skills/` breaks the "vendored from GitHub by hash" rule
Cause:    the lock and the tree have drifted in both directions. On disk but **not** locked:
          `mermaid-diagram`, `react-best-practices`, `react-testing-library`, `security`.
          Locked but **not** on disk: `architecture-patterns`, `github-workflow-automation`.
          Nothing inside a skill directory says which of the two it is.
Takeaway: `skills-lock.json` is the only authority on what is vendored — never infer it from
          the directory listing. Re-vendoring a skill silently overwrites hand edits, so a
          hand-authored skill must stay out of the lock.
Evidence: skills-lock.json vs .claude/skills/
Status:   open — the lock is stale in both directions; left untouched on purpose

## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

_None yet._
