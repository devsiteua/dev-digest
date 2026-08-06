# Insights — server

Append-only, newest first within each section. Sections, entry format, and promotion rules:
see the root [`../INSIGHTS.md`](../INSIGHTS.md).

---

## What Works

_None yet._

## What Doesn't Work

### 2026-08-06 · Seeding a new agent `enabled: true` silently repriced every "run all" review

Trigger:  L02 adds two agents (Test Quality, API Contract) to `seed.ts`; the obvious default
          for a seeded agent is enabled, and nothing in the diff looks like a cost change
Cause:    `ReviewService.resolveAgents` turns `all: true` into `agentsRepo.listEnabled(...)`,
          and "Run all enabled agents" is the primary item in the run dropdown. Two more
          enabled agents = five LLM calls per click instead of three, on a flow the change
          was not supposed to touch at all.
Takeaway: `agents.enabled` is not a UI convenience — it is the membership test for the
          fan-out, so it is a per-run cost multiplier. Seed a demo agent DISABLED and drive
          it by name; `RunReviewDropdown` runs a specific agent regardless of the flag, so
          nothing about the demo is lost. Pinned by an assertion in `skills.it.test.ts` that
          the enabled set still excludes both.
Evidence: src/modules/reviews/service.ts:50, src/db/seed.ts (seedAgents)
Status:   resolved

### 2026-08-01 · `POST /pulls/:id/review` returning `reviews: []` is correct

Trigger:  the response body looks empty even though the review runs fine
Cause:    the route creates the `agent_runs` rows, returns the runIds immediately, and fires
          `executor.executeRuns(...)` without awaiting. Results are persisted later; the
          client subscribes to `/runs/:id/events` and refetches on completion.
Takeaway: do not add an await to "fix" the empty array — it would block the request for the
          entire LLM call and break the SSE subscription window.
Evidence: src/modules/reviews/
Status:   → promoted to `CLAUDE.md` (Gotchas)

## Codebase Patterns

### 2026-08-06 · The conventions prompt and the verifier's sample map are two lists that must agree — and only one of them is observable

Trigger:  writing `buildSamplePrompt` with a `MAX_PROMPT_CHARS` backstop, while `verifyCandidates`
          takes a `Map<path, text>` of "the sampled files" and gates every candidate on membership
Cause:    the prompt is a **string**. A file dropped from its tail by the budget leaves no trace in
          the return value, yet it is still in the map — so a rule citing a file the model never saw
          would pass the membership gate and be verified against text that was not in the prompt.
          The two lists come from the same input and can only diverge through that budget, which is
          why the numbers are sized so it cannot bind: `SAMPLE_FILE_COUNT` (12) × `MAX_SAMPLE_CHARS`
          (4 000) plus the handful of configs a real repo has ≈ 68 kB, against `MAX_PROMPT_CHARS`
          80 000.
Takeaway: treat those four constants as ONE budget, not four knobs — lowering `MAX_PROMPT_CHARS` or
          raising either sample constant makes the drop routine and weakens grounding with no
          failing test. If the backstop ever has to bind, `buildSamplePrompt` must also return the
          included paths, and the service must build the verifier's map from those rather than from
          what the sampler picked.
Evidence: src/modules/conventions/helpers.ts (buildSamplePrompt); src/modules/conventions/constants.ts
Status:   open — the service that builds that map lands next session

### 2026-08-06 · A convention candidate's line range is a search hint, not an assertion — rejecting wide ranges would protect nothing

Trigger:  reviewing `verifyCandidate` and noticing that nothing bounds `end_line - start_line`
Cause:    the claimed range is never tested beyond "it exists in the file". The check searches
          `[start - SNIPPET_CONTEXT_LINES, end + SNIPPET_CONTEXT_LINES]` for the normalized snippet
          and returns the offset where it was **found**, together with the file's own text for those
          lines. A model claiming lines 1-900 for a one-line snippet therefore gets the same verdict
          as one claiming 3-3: the numbers that get stored are where the code actually is. A wide
          range buys cheaper search, never false evidence.
Takeaway: the grounding guarantee lives in the snippet match and the read-back from disk, not in the
          numbers the model sent — a max-range rule would discard good evidence and prevent nothing.
          The constant that does need care is `SNIPPET_CONTEXT_LINES`: it is drift tolerance, and
          widening it trades grounding for recall until "near line 40" stops meaning anything.
Evidence: src/modules/conventions/helpers.ts (verifyCandidate); test/conventions-helpers.test.ts
          ("accepts a snippet the model placed one line off, and corrects the numbers")
Status:   resolved

## Tool & Library Notes

### 2026-08-06 · `pnpm db:generate` blocks on a rename prompt the moment one migration both drops and adds a column — only `expect` gets past it

Trigger:  reshaping `conventions` (drop `accepted`, add six columns) in one pass; `pnpm db:generate`
          printed "Is `category` column in `conventions` table created or renamed from another
          column?" and sat there until the 120 s timeout
Cause:    drizzle-kit cannot tell a drop+add from a rename, so it asks — once per added column,
          with `create column` pre-selected. Its prompt library reads the TTY directly, so
          **nothing piped answers it**: `printf '\n\n' | pnpm db:generate` and
          `script -q /dev/null bash -c "printf '\n' | pnpm db:generate"` both leave the prompt
          exactly where it was and write no files (the run does abort cleanly — `git status
          src/db/migrations` stays empty, so a failed attempt costs nothing).
Takeaway: drive it with `expect`, which is at `/usr/bin/expect` on this machine:
          `spawn pnpm db:generate` + `expect -re {created or renamed from another column} { send
          "\r"; exp_continue }` + `eof`. Pressing return takes `create column`, which is the right
          answer for a genuine drop+add. The alternative — two generate runs, drop first then add —
          avoids the prompt but leaves two migration files for one logical change.
          `drizzle-kit generate` needs no database either way; it diffs against
          `migrations/meta/<last>_snapshot.json`.
Evidence: server/src/db/migrations/0011_violet_ken_ellis.sql; server/drizzle.config.ts
Status:   resolved

### 2026-08-06 · drizzle-kit emits `ADD COLUMN … NOT NULL` with no default and no warning

Trigger:  tightening `conventions.category`/`evidence_*` to NOT NULL, expecting `db:generate` to
          object or to ask for a backfill value
Cause:    it does neither. `0011_violet_ken_ellis.sql` line 5 is
          `ALTER TABLE "conventions" ADD COLUMN "category" text NOT NULL;` — valid SQL that
          Postgres accepts on an empty table and rejects on a populated one. The failure therefore
          lands at `pnpm db:migrate`, on whichever machine has rows, not at generate time on yours.
Takeaway: a NOT NULL column addition is only safe if the table is provably empty — check
          `select count(*)`, not the seed script, and say so in the spec. Otherwise add it
          nullable, backfill, then tighten in a second migration. Same applies to
          `ALTER COLUMN … SET NOT NULL` (lines 1-4 of the same file).
Evidence: server/src/db/migrations/0011_violet_ken_ellis.sql:1-7
Status:   resolved

### 2026-08-06 · `fflate.unzipSync`'s `filter` runs over the central directory — use it to read ONE entry

Trigger:  skill import must extract `SKILL.md` from an uploaded bundle while provably never
          reading the `install.sh` next to it
Cause:    `unzipSync(bytes)` decompresses everything up front, so "read one file" naively
          means decompressing all of them and ignoring the rest — which is exactly the claim
          the feature must not make. `unzipSync(bytes, { filter })` instead invokes the
          callback once per central-directory entry with `{ name, size, originalSize }` and
          decompresses only the entries it returns true for.
Takeaway: two passes. First `filter: () => false` — collects every name and `originalSize`
          while decompressing nothing, which is also where the zip-bomb check belongs (sum
          `originalSize` BEFORE inflating anything). Then a second call filtered to the one
          chosen name. Bytes of every other entry are never touched, and the test asserts it
          by checking a sentinel string from `install.sh` is absent from the parsed draft.
Evidence: src/modules/skills/helpers.ts (draftFromZip), test/skills-helpers.test.ts
Status:   resolved

### 2026-08-06 · A prompt that lives in two hand-synced files needs a test, not a comment

Trigger:  `server/CLAUDE.md` says an agent prompt must be mirrored between
          `docs/agent-prompts/<n>.md` and `src/db/seed-prompts.ts` "by hand"
Cause:    that instruction has no enforcement, and the two copies are a ~90-line template
          literal versus a markdown file — a drift between them is invisible in review.
Takeaway: `test/agent-prompts-mirror.test.ts` asserts each file equals its constant. It cost
          five lines and it also retro-verified that the three original prompts were already
          in sync. Any future "keep these two in sync by hand" note in this repo deserves the
          same treatment.
Evidence: test/agent-prompts-mirror.test.ts
Status:   resolved

## Recurring Errors & Fixes

### 2026-08-01 · A "running" run that never finishes is usually a dead process, not a hang

Trigger:  a run stuck at `running` in the UI with no events arriving
Cause:    `RunBus` is in-memory. If the API restarted mid-run, the executor died with it: the
          row stays `running`, the SSE stream has nothing to replay, and there is no runner
          left to cancel. `reapStaleRuns()` on the next boot is what clears these.
Takeaway: check `agent_runs.status` and `run_traces` in the DB before assuming the engine
          hung. `cancelRun` deliberately marks the row cancelled **and** completes the bus so
          orphaned runs can also be dismissed from the UI.
Evidence: src/platform/sse.ts
Status:   → promoted to `CLAUDE.md` (Gotchas)

## Session Notes

_None yet._

## Open Questions

_None yet._
