# Insights — server

Append-only, newest first within each section. Sections, entry format, and promotion rules:
see the root [`../INSIGHTS.md`](../INSIGHTS.md).

---

## What Works

_None yet._

## What Doesn't Work

### 2026-08-07 · The first live extraction spent 3 of 20 rules on formatting a Prettier config already enforces — offering the configs did not stop it

Trigger:  first real scan of `devsiteua/dev-digest` (12 files, deepseek-v4-flash): 20 rules
          back, 19 grounded, and reading them one by one to write the quality report
Cause:    `CONFIG_FILES` is fed to the model precisely so declared rules are not re-reported as
          discovered ones (`constants.ts`: "a rule the linter enforces is one the extractor
          should not claim to have discovered"). It came back with "Use semicolons at end of
          statements", "Use 2-space indentation" and "Use trailing commas in object literals"
          anyway — all three grounded, all three provable, all three worthless, because the
          evidence check cannot tell a house DECISION from a formatter's output. Three more
          describe what the library forces rather than a choice ("Define database tables using
          pgTable", "Use uuid primary keys with defaultRandom()"). And the evidence concentrates
          hard: 7 of 19 rules cite `server/src/db/schema/core.ts`, 5 cite
          `client/src/lib/hooks/agents.ts`, three of them the identical range `6-17`.
Takeaway: budget roughly a third of a pass for formatting and library-usage noise, and do NOT
          treat it as a prompt bug to fix by tightening the wording — grounding cannot express
          "this was chosen". The structural fixes are the ones already in the spec's Future work
          (per-category quotas, a critic pass); the cheap manual one is that the accept/reject
          loop is the filter, so a pass is a success at ~1 rule in 3. Confidence is no help:
          every value came back 0.90/0.95/1.00, nothing below 0.9, so it cannot rank anything.
Evidence: src/modules/conventions/constants.ts (CONFIG_FILES, SAMPLE_FILE_COUNT);
          specs/L02-conventions-extractor.md § Future work
Status:   open — expected behaviour of one honest pass, recorded so the next reader is not surprised

### 2026-08-07 · Extraction records no cost anywhere, and the spec's Risks says the opposite

Trigger:  needing the price of one extraction pass for the L02 quality report
Cause:    `ConventionsService.extract` never reads `reply.usage` and never writes an
          `agent_runs` row — that table is written by the review executor, and extraction is
          not a review. `grep -rn "usage\|cost_usd" src/modules/conventions/` returns nothing.
          The spec's Risks nonetheless states "the run's cost is reported the same way a
          review's is", which is true of a REVIEW's cost column and false here. Nothing in the
          UI shows it either: the scan-summary line reports files, rules and discards only.
Takeaway: the only source for what a scan cost is the provider dashboard
          (openrouter.ai/activity). If a scan's cost has to be visible in-product, the change is
          to persist `reply.usage` — the port already returns it — not to look for a row that
          was never written. Do not quote the spec's Risks sentence as if it described shipped
          behaviour.
Evidence: src/modules/conventions/service.ts (extract, step c);
          specs/L02-conventions-extractor.md § Risks
Status:   open — deliberately not fixed in L02; the spec sentence is the thing that misleads

### 2026-08-07 · An assertion about the merged skill body proves nothing while the test hand-writes that body

Trigger:  re-reading `conventions.it.test.ts` — `expect(skill.body).not.toContain(RULE_CONFIG)`
          in the merge test, sitting a dozen lines under a payload whose `body` the same test
          had typed out by hand as `` `# Repo conventions\n\n- ${RULE_EARLY}\n- ${RULE_CONSTANTS}` ``
Cause:    the server has no merged-body builder — the modal composes that text and the user
          edits it before `POST .../skill` sees it, which the spec's Test plan states outright.
          So the only way the body could contain the rejected rule is if the test put it there.
          The assertion was a tautology about the test's own string literal, and it read as
          coverage of the acceptance criterion "a rejected rule must not reach a prompt".
Takeaway: when the server stores a caller's text verbatim, an assertion on that text tests the
          CALLER. Compose it in the test the way the client composes it — filter the rows the
          server just reported as `accepted`, render them — and then the same `not.toContain`
          is about the filter. Pair it with the two assertions that are genuinely the server's:
          `skill.body === body` (it does not recompose) and that the body quotes the snippet
          read back from the clone, not the model's rendition. General form: before writing an
          assertion, ask which component would have to be broken for it to fail.
Evidence: test/conventions.it.test.ts (composeSkillBody, "merges only the accepted candidates")
Status:   resolved

### 2026-08-06 · An insert-only create behind a FIXED default name is a feature that works exactly once

Trigger:  the merge modal defaults every skill to `repo-conventions`; the SECOND merge of a repo
          returned 422 `A skill named "repo-conventions" already exists.` — and it returned it
          after the user had accepted more rules and composed the whole body
Cause:    `createFromConventions` only ever INSERTed, and `assertNameFree` is workspace-scoped.
          Merging is not a one-shot act — accept three rules, merge, accept two more, merge
          again — so the second call is the normal path, not an edge case. Review missed it
          because every test merged once, which is also the shape of the happy-path demo.
Takeaway: when a create endpoint hands the caller a FIXED default name, it is an upsert whether
          or not it is written as one. `saveFromConventions(..., replaceId)` + `repo.update`
          makes a re-merge a version bump, with the old body landing in `skill_versions`. Decide
          what may be replaced from OWNERSHIP, never from the name alone: `replaceableSkillId`
          requires an `extracted` skill that this repo's own candidates already point at via
          `skill_id`, so two repos sharing a workspace still collide and rename rather than
          silently overwrite each other. The general habit: write the test for the SECOND call.
Evidence: src/modules/skills/service.ts (saveFromConventions);
          src/modules/conventions/service.ts (replaceableSkillId);
          test/conventions.it.test.ts ("re-merging the same repo versions the skill")
Status:   resolved

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

### 2026-08-06 · `no-cross-module-import` is a WARNING, so the onion guard exits 0 on the violation it is named for

Trigger:  the conventions service needs three things another module owns — `SkillsService`,
          `getFeatureModelOverride`, and (nearly) `modules/skills/constants.ts` — and the
          obvious import compiles and passes `pnpm arch:check`
Cause:    that rule alone is `severity: 'warn'`; every other rule in
          `.dependency-cruiser-onion.cjs` is `error`. depcruise's exit code counts ERRORS, so
          a planted `modules/__probe/service.ts → modules/settings/feature-models.ts` printed
          `x 1 dependency violations (0 errors, 1 warnings)` and still exited **0**. CI would
          have stayed green; only the "✔ no dependency violations found" line changes, and
          only for whoever reads the output. The baseline confirms the drift is real —
          `modules/repos/service.ts → ../repo-intel/constants.js` is already frozen in it.
Takeaway: treat that warning as an error by hand, because nothing else will. The remedy the
          rule's own comment names is the container: `container.skillsService` and
          `container.featureModelOverride()` were added for exactly this, so
          `modules/conventions/**` imports NOTHING from a sibling module. `platform/` is the
          composition root and is free to import both. Corollary for reviews: a green
          `arch:check` does not mean no new cross-module import — read the line, do not trust
          the exit code.
Evidence: server/.dependency-cruiser-onion.cjs (no-cross-module-import);
          server/src/platform/container.ts (skillsService, featureModelOverride)
Status:   open — the warn severity is deliberate, so this needs a human every time

### 2026-08-06 · A `ContainerOverrides` field typed as a service CLASS cannot be overridden by anything

Trigger:  adding `conventions` to `ContainerOverrides` so a test (or a browser flow that must
          never reach a model) can stand in a stub
Cause:    TypeScript compares classes with `private` members nominally — a private field makes
          the type satisfiable only by instances of that exact class. `conventions?:
          ConventionsService` therefore types a field whose only legal value is a real
          `ConventionsService`, which is not an override at all. Every existing override in
          that interface happens to be a port INTERFACE (`GitClient`, `RepoIntel`, …), so the
          trap never surfaced before a service was brokered there.
Takeaway: expose the verbs, not the class: `export type ConventionsApi = Pick<ConventionsService,
          'extract' | 'list' | 'update' | 'createSkill'>`, and type both the override and the
          getter with it. A dedicated interface file (repo-intel's `types.ts`) is the heavier
          alternative and buys nothing until a second implementation exists.
Evidence: server/src/modules/conventions/service.ts (ConventionsApi);
          server/src/platform/container.ts (ContainerOverrides.conventions)
Status:   resolved

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

### 2026-08-07 · `waitForPrRuns` gives up silently, so a loaded `.it.test` lane fails in an assertion nowhere near the cause

Trigger:  `pnpm exec vitest run .it.test` failed once on `skills.it.test.ts:552`
          (`expect(none.skills ?? null).toBeNull()` — a skills block after both skills were
          disabled). The same file passed alone, and the same full lane passed on the next run.
Cause:    the helper's timeout branch is `if (Date.now() - start > timeoutMs) return runs` — it
          RETURNS the rows it has instead of throwing. So when 10 s is not enough (the lane runs
          nine Testcontainers Postgres instances at once, and every file also runs migrations),
          the test proceeds against a run the executor has not finished, reads whatever
          `run_traces` holds, and fails on an assertion about prompt content. Nothing in the
          message mentions a timeout, which is why the first instinct is to look for a logic
          bug in skill rendering.
Takeaway: before debugging a `.it.test` failure about run OUTPUT, re-run that file alone. If it
          passes, the finding is timing, not logic. When a wait helper is allowed to return
          without meeting its condition, every downstream assertion becomes a liar — the fix is
          to throw with the counts (`expected N terminal runs, saw M after 10s`), and raise
          `timeoutMs` for the whole-lane run. Not changed here: it is a pre-existing helper and
          this session's diff does not touch it.
Evidence: test/helpers/runs.ts (waitForPrRuns); test/skills.it.test.ts:502-553
Status:   open — flaky under full-lane load only; both lanes are green on a repeat run

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
