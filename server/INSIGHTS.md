# Insights — server

Append-only, newest first within each section. Sections, entry format, and promotion rules:
see the root [`../INSIGHTS.md`](../INSIGHTS.md).

---

## What Works

_None yet._

## What Doesn't Work

### 2026-08-28 · Adding a file to the `.it.test` lane is a LOAD change, so a green baseline does not predict a green lane

Trigger:  adding `pulls-lookup.it.test.ts` (the 12th integration file) turned
          `skills.it.test.ts > "puts linked+enabled skills in the prompt"` red once with
          `TypeError: Cannot read properties of undefined (reading 'skills')` — in a file the
          change never touched. Removing the new file: 103/103 green. Adding it back: one
          failure, then two consecutive 110/110 passes.
Cause:    not shared-DB interference — every integration file starts its OWN Postgres
          container (`test/helpers/pg.ts`), so a 12th file is a 12th container and pure
          resource contention. `runAndReadAssembly` (`test/skills.it.test.ts:767`) calls
          `waitForPrRuns` and then immediately reads `/runs/:id/trace`, returning
          `trace.prompt_assembly`. `waitForPrRuns` returns the rows it has when its timeout
          expires (`server/INSIGHTS.md` 2026-08-07), so under load the trace is not persisted
          yet, `prompt_assembly` is `undefined`, and the next line dereferences it.
Takeaway: when a new integration file makes an unrelated one fail, do not reach for "flake" —
          and do not assume interference either. Remove the new file and re-run: that separates
          a real regression from a load-exposed race in two commands. The 2026-08-07 lesson has
          a second half this proves: a caller of a bounded wait helper must assert the condition
          it waited for, or the timeout resurfaces as a `TypeError` three lines later instead of
          as "the run never finished".
Evidence: server/test/skills.it.test.ts:767 (runAndReadAssembly); server/test/helpers/pg.ts (startPg);
          server/test/helpers/runs.ts (waitForPrRuns)
Status:   open — not fixed; `skills.it.test.ts` was outside the L04 spec's file list

> **Correction, 2026-08-29.** The diagnostic in Takeaway gives a false negative, because the
> failure is not caused by the new file. Adding a 14th file (`project-context.it.test.ts`) and
> running the lane nine times: 2 failures. Running it five times with that file **excluded** —
> back to 13 containers: 1 failure, same test, same `TypeError`. The race is ~20% at both 13 and
> 14, so "remove the new file and re-run" passing once proves nothing; at that rate a single
> clean run happens 80% of the time by luck. Re-run the reduced lane **at least five times**
> before concluding the new file caused anything. The load reading still holds; the attribution
> to the newest file does not.

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

> Archived 2026-08-29 → [`../docs/insights-archive.md`](../docs/insights-archive.md), verbatim
> under this section: 2026-08-23, 2026-08-22, 2026-08-12, 2026-08-07, 2026-08-06 ×2,
> 2026-08-01. What stays here is `open`, plus any resolved entry an open one points at.

## Codebase Patterns

### 2026-08-29 · A new key in a PERSISTED-SNAPSHOT contract needs `.default()`, or every existing row 500s — and no test in this repo can see it

Trigger:  adding `project_context: z.boolean()` to `AgentVersionConfig`, exactly as a live-row
          DTO field would be added.
Cause:    `toAgentVersionDto` parses the stored blob strictly — `AgentVersionConfig.parse(row.configJson)`
          — and its own doc comment says a drifted snapshot "throws here rather than leaking an
          unvalidated blob to the client". Every snapshot written before the migration lacks the
          new key, so `GET /agents/:id/versions` throws on any database with history. Measured on
          the live dev DB: `select count(*), count(config_json->'project_context'),
          count(config_json->'repo_intel') from agent_versions` → `1|0|1`.
Takeaway: split the rule by what the schema parses. A field on a **live-row DTO** may be bare; a
          field on a contract that `.parse()`s **persisted JSON** carries `.default()`, or its
          step owns a backfill. The check is one SQL line — `select count(*),
          count(config_json->'<key>') from agent_versions`. Do not expect a test to catch it:
          `agents-versions.it.test.ts` seeds an empty database, so the lane stays green while the
          endpoint is broken for every real user.
Evidence: server/src/modules/agents/helpers.ts:42-48; server/src/vendor/shared/contracts/knowledge.ts:407-419;
          server/test/agents-versions.it.test.ts
Status:   resolved — shipped with `.default(true)`, which reads an old snapshot as "on", matching `run-executor`'s `!== false`

### 2026-08-29 · A Zod route schema can only ever answer 422, so an acceptance criterion naming any other status moves the check into the service

Trigger:  AC-05 to AC-08 of the project-context spec demand 400, 413, 409 and 400. `server/CLAUDE.md:37`
          says invalid input is rejected with **422 before the handler runs**. Both cannot hold.
Cause:    the route schema is the 422 boundary; it validates or it does not, and it has no
          vocabulary for "too large" versus "too many" versus "wrong extension".
Takeaway: when a criterion names a status other than 422, the body schema goes deliberately
          loose (shape only) and the named rejections are thrown from the service as
          `AppError(code, message, statusCode)`. Draw the exception tightly: document it in the
          route, in the service class comment and in the plan, and keep sibling routes on
          ordinary validation — otherwise the next module reaches for `AppError` in place of a
          schema for convenience and the 422 convention quietly dies.
Evidence: server/src/modules/context/service.ts:110-142; server/src/modules/context/routes.ts:20-29;
          server/src/vendor/shared/contracts/platform.ts:299-303
Status:   resolved

### 2026-08-23 · A test file may sit in any module — the onion cruise never sees it

Trigger:  the L03 checklist mandates `server/src/modules/pulls/classifier.test.ts` for a
          function that lives in `modules/smart-diff/`, which reads like a forced
          cross-module import
Cause:    `.dependency-cruiser-onion.cjs` sets `options.exclude: { path: '\\.test\\.ts$' }`,
          so `depcruise src` never walks a test file and never scores its imports. Checked
          both directions with planted files: a PRODUCTION `modules/pulls/_probe.ts`
          re-exporting from `../smart-diff/helpers.js` printed
          `warn no-cross-module-import`, and the same import from a `.test.ts` at the same
          path printed "✔ no dependency violations found".
Takeaway: a test may live wherever it is most findable and import across module lines
          freely — the architecture is not an argument against a test's location. It is an
          argument against a PRODUCTION re-export file placed only to make an import look
          local, which is what was almost written here. See the warn-severity entry below
          for why that warning still has to be read by a human.
Evidence: server/.dependency-cruiser-onion.cjs (options.exclude);
          server/src/modules/pulls/classifier.test.ts
Status:   resolved

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

> Archived 2026-08-29 → [`../docs/insights-archive.md`](../docs/insights-archive.md), verbatim
> under this section: 2026-08-28, 2026-08-25 ×2, 2026-08-06 ×2. What stays here is `open`,
> plus any resolved entry an open one points at.

## Tool & Library Notes

### 2026-08-29 · `pnpm typecheck` does not see `server/test/**`, so a broken server fixture surfaces only at vitest runtime

Trigger:  sweeping the producers of a changed contract, and wondering why only *client* test
          fixtures appeared in the typecheck output.
Cause:    `server/tsconfig.json` has `include: ["src/**/*.ts"]`. The client's `tsc --noEmit` has
          no such narrowing and does check its tests, which is why three client fixtures went red
          and a server one would not have.
Takeaway: after a contract change, `grep` the server's test tree by hand — the typecheck gate
          will not do it for you. A green `pnpm typecheck` on the server says nothing about
          whether `server/test/**` still compiles.
Evidence: server/tsconfig.json
Status:   open

_None yet._

> Archived 2026-08-29 → [`../docs/insights-archive.md`](../docs/insights-archive.md), verbatim
> under this section: 2026-08-06 ×4. What stays here is `open`, plus any resolved entry an
> open one points at.

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

> Archived 2026-08-29 → [`../docs/insights-archive.md`](../docs/insights-archive.md), verbatim
> under this section: 2026-08-01. What stays here is `open`, plus any resolved entry an open
> one points at.

## Session Notes

_None yet._

## Open Questions

_None yet._
