# Implementation plan — Eval Pipeline

Spec: [`../eval-pipeline.md`](../eval-pipeline.md) · Spec ID `EVAL-PIPELINE` · Branch: `lesson-06`

Fourteen steps, fourteen commits. The tree is clean at `2038e95` (`git status --porcelain`
empty), so nothing below works around uncommitted work.

**Baselines measured while this plan was written, at `2038e95`.** Every `Verify:` line below is
a delta against these, not a guess:

| Gate | Today |
|---|---|
| `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | 28 files / 497 tests passed, 1.76 s, no Docker |
| `cd server && pnpm typecheck` | clean |
| `cd server && pnpm arch:check` | `✔ no dependency violations found (189 modules, 650 dependencies cruised)` + 16 known ignored |
| `cd server && pnpm verify:l03` | 35 tests / 226 ms — the shape `verify:l06` copies |
| `cd client && pnpm test` | 42 files / 321 tests passed, 4.19 s |
| `cd client && pnpm typecheck` | clean |
| `diff server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts` | **3** change commands (`3c3`, `144,172d143`, `249c220`), **33** lines starting `<` or `>` |

---

## Requirements review

Everything below was checked against the tree at `2038e95`. `file:line` is where it was
checked. **Nothing here edits the spec.** Items marked → `spec-creator` are returned for a
decision; the reading I took is stated so a reviewer can disagree with me rather than with the
spec.

### Gaps

- **AC-01 vs `In scope` — the seed must create eval *cases*, not only decided findings.**
  AC-01's check is *"інтеграційний тест лічить `eval_cases` для засіяного агента"* and its
  manual half is *"вкладка Evals показує ≥8 рядків"*. `In scope` promises only *"a seeded
  workspace carries at least eight findings with real decisions"*, and AC-09 likewise. Under
  the narrow reading nothing ever writes `eval_cases` during `db:seed`, so the manual check
  needs eight hand-clicks and the e2e flows of AC-22/AC-23 have nothing to render on a
  hermetic stack (`scripts/e2e.sh` boots an **ephemeral** Postgres — "empty every run").
  **I take the wide reading:** `db:seed` writes ≥8 decided findings **and** ≥8 `eval_cases` for
  the seeded agent. It is the only reading under which AC-01's own manual half, AC-22's e2e
  half and AC-23's e2e half are executable. → `spec-creator`: `In scope`'s seed bullet should
  say so out loud.

- **The demo review carries no agent, so a case created from a seeded finding has no owner.**
  `eval_cases.owner_id` is `notNull` (`server/src/db/schema/eval.ts:13`), and every seeded
  finding hangs off the review inserted at `server/src/db/seed.ts:445-458`, which sets
  `workspaceId, prId, kind, verdict, summary, score, model` and **not** `agentId`
  (verified — `grep -n "agentId" src/db/seed.ts` returns only `:683`, `:694`, `:786`, none of
  them a `reviews` insert). "Seeded agent" in AC-01 therefore has no referent today.
  **I take:** Step 4 backfills `reviews.agent_id` on the demo review to the seeded
  *General Reviewer*, guarded on its own absence, using the lookup that already exists in the
  `agent_runs` backfill (`seed.ts:783-787`). → `spec-creator`, as a note, not a blocker.

- **No criterion covers a finding whose review has no agent.** The spec has AC-03 (no
  decision) and AC-04 (case already exists) but nothing for "there is no agent to own this
  case". **I took:** the creation route refuses with a named reason, same shape as AC-06's
  refusal. No new `AC-NN` was invented here — it was recorded as a decision.
  **Closed at `2378d54`: the caller made it `AC-30`**, on the ground that `reviews.agent_id`
  is nullable (`server/src/db/schema/reviews.ts:28`, verified) while `eval_cases.owner_id` is
  `notNull` (`schema/eval.ts:13`), so the case is reachable by any review written before an
  agent existed — not only by the demo row Step 4 backfills. It is now covered by Step 5.

- **AC-20 requires denominators to be persisted, and nothing today can hold them.**
  `eval_runs` has `recall`, `precision`, `citation_accuracy`, `duration_ms`, `cost_usd`, `pass`
  and no denominator column (`schema/eval.ts:29-34`); `EvalRun`
  (`contracts/knowledge.ts:58-66`) and `EvalRunRecord` (`contracts/eval-ci.ts:33-45`) have
  none either. The spec leaves the run batch's columns to me, so this is planned, not
  reported: denominators live on the batch (Step 1) and in the batch contract (Step 2).

### Contradictions

- **The `e2e` row of § Test plan cannot be run as written.** It asks for *"Finding → case →
  run → metrics, end to end on the hermetic stack"*. A run makes a real model call, and
  `e2e/run.ts:17-18` states the opposite as the package's contract — *"Specs target read-only
  seeded data, so nothing here triggers an LLM call or needs an API key"* — while
  `scripts/e2e.sh` exports no provider key and stubs no LLM (it boots Postgres, the real API
  and the real web app). The two cannot both hold.
  **I take:** the e2e flow stops at `finding → case → Evals tab → sidebar → Eval Dashboard`,
  all of which are model-free; the `→ run → metrics` half is exactly what AC-26's manual live
  run already owns and what § Test plan already excludes from automation. Step 13 plans the
  first; Step 14 plans the second. → `spec-creator`: the `e2e` row overpromises.

### Ambiguities

- **AC-19's denominator, against a two-gate pipeline.** The spec cites
  `reviewer-core/src/grounding.ts:52` and `ReviewOutcome.dropped`, but `ReviewOutcome` carries
  **two** drop lists — `dropped` (grounding) and `scopeDropped` (the scope gate) — and
  `review.findings` is what survived **both** (`reviewer-core/src/review/run.ts:104-118`). So
  "the fraction of findings that survived the grounding gate" has two readings, and
  `review.findings.length / (review.findings.length + dropped.length)` is the wrong one: it
  charges the scope gate's drops to citation accuracy.
  **I take:** `citation_accuracy = (kept) / (kept + dropped.length)` where
  `kept = review.findings.length + scopeDropped.length` — i.e. everything grounding let
  through, whether or not the scope gate later removed it. Pinned by a unit test in Step 3 that
  goes red if `scopeDropped` is folded into the wrong side.

- **AC-16 — a cap or a refusal?** *"Один прогін повинен охоплювати не більше ніж 50 кейсів."*
  Silently taking the first 50 would make the denominator a function of ordering, which is the
  same defect the spec's `Out of scope` uses to rule out a per-case run ("a one-case run would
  produce a batch that cannot be compared with any other").
  **I take:** refuse the run with the limit named, symmetric with AC-06. An agent with 51
  cases cannot run until cases are deleted — deliberate, and visible.

- **AC-23's e2e half reads "три метрики" as values.** On a hermetic stack no run has ever
  happened, so all three denominators are empty and the cards render `—` (AC-21).
  **I take:** the flow asserts the three metric **labels** plus the `—` values. That is AC-21
  exercised in a browser, and it is honest about a workspace with no runs. Seeding a fake
  `eval_run_batch` to make the numbers non-empty was rejected: fabricated metrics on a
  dashboard whose entire purpose is trustworthy metrics.

- **AC-01 says "≥8", AC-09 says "≥8", and a case built from a decided finding consumes one.**
  If the seed decides exactly 8 findings and turns all 8 into cases, AC-02's integration test
  ("create a case from an accepted finding") has no un-cased decided finding to use and AC-04's
  ("do not create a second") has no clean fixture either.
  **I take:** the seed decides **10** findings and turns **8** of them into cases, leaving two
  — one accepted, one dismissed — as the fixtures AC-02 needs. Both ≥8 criteria hold.

### Unverifiable as written — replaced with gates that run

- **AC-17's `grep`** (*"grep по модулю скорингу на відсутність імпорту провайдера"*) and
  **AC-28's `grep`** (*"grep … на відсутність запису літерала `'skill'`"*) are the shape root
  `INSIGHTS.md` (2026-08-30) records as unreachable when written with a positive count. Both
  are planned as **zero-count** greps, which cannot confuse an import line with a call site
  because zero means no line at all. Both were executed today:
  - AC-17 shape, proven against an existing pure module:
    `grep -cE "LLMProvider|completeStructured|container|\.complete\(" reviewer-core/src/grounding.ts` → **0**
  - AC-28 shape, proven across the current server tree:
    `grep -rnE "ownerKind: *['\"]skill['\"]|owner_kind: *['\"]skill['\"]" server/src | wc -l` → **0**

- **AC-27's `diff`** (*"розбіжність лише в `AgentManifest` і `ConformanceInput.provider`"*) is
  prose, and the line numbers in `diff`'s output **shift** the moment the eval section grows,
  so any gate quoting `144,172d143` breaks on a correct edit. Replaced by two counts that are
  invariant under a line shift and that were measured today:
  `diff … | grep -cE '^[0-9]'` → **3** and `diff … | grep -c '^[<>]'` → **33**. A verbatim
  mirror keeps both; any drift changes one or both.

### Verified rather than assumed

- **The `.default()` producer sweep comes back empty.** The sweep root `INSIGHTS.md`
  (2026-08-29) prescribes —
  `grep -rnE ": *(EvalCaseInput|EvalCase|EvalRunRecord|EvalRun|EvalDashboard|EvalTrendPoint|EvalPerTrace) *= *\{" server/src server/test client/src`
  — returns **0**, and those symbols have **0** uses anywhere outside `vendor/shared`
  (`server/src`, `server/test`, `client/src`, `mcp/src`, `e2e`). So no object literal exists to
  break today. The first producers are created by **this** stream, in Step 4 (the seed) and
  Step 5 (the service), which is why Step 2 precedes both.
- **Both eval tables are unwritten by any code.** `grep -rn "evalCases\|evalRuns" server/src`
  hits only `db/schema.ts:43,81,82` and `db/schema/eval.ts`. There are no legacy rows in any
  environment, which is what makes bare (non-`.default()`) fields on the expectation schema
  safe here despite the persisted-JSON rule in `server/INSIGHTS.md` (2026-08-29). Recorded so
  the next field addition re-applies that rule rather than copying this exemption.
- **The eval section of the contract mirror is already in sync**, as the spec's Context table
  claims: the only divergences are `AgentManifest` (absent client-side, with its `Provider` /
  `CiFailOn` imports) and `ConformanceInput.provider`. Re-run today.
- **`activeKeyFor` already routes `/eval*` to the `eval` nav key**
  (`client/src/components/app-shell/helpers.ts:35`). Choosing `/eval` as the dashboard route
  means the sidebar highlights correctly with **no** edit to that file.
- **`client/messages/en/eval.json` already exists, fully written, and promises behaviour this
  spec excludes.** It is not listed in the spec's Context table. It carries
  `caseEditor.save` / `caseEditor.runCase`, `evalsTab.run` / `evalsTab.edit` and
  `dashboard.metricTrend` — a manual case editor, a per-case Run and a trend chart, all three
  in `Out of scope`. Per `client/INSIGHTS.md` (2026-08-29), a message file is the one place a
  removed feature still makes a factual claim to the user, so it is **rewritten**, not adopted
  (Step 9). Nothing in code reads the namespace today (`grep -rn "useTranslations(\"eval\")"`
  → 0), so the rewrite breaks nothing.
- **`server/src/db/seed.ts` writes exactly 4 findings, all inside `if (!pr)`, none decided.**
  `grep -n "acceptedAt\|dismissedAt" src/db/seed.ts` → no match; `grep -n "t.findings"` → one
  insert at `:460`.
- **PR #482 has 9 files, 8 with real `patch` text** (`package-lock.json` is `patch: null`), so
  there are eight genuine locations to hang the seeded findings and expectations on.
- **Integration tests call `seed(db)` directly** — `test/integration.it.test.ts:7,47,69-71`
  and `test/agents-versions.it.test.ts:6`. This is the fact the whole ordering below turns on
  (see § Ordering constraints).
- **`getPrFiles` returns rows in planner order** — `src/modules/reviews/repository/pull.repo.ts:28-33`,
  no `orderBy`, exactly as `server/INSIGHTS.md` (2026-08-30) records. Anything that serialises a
  PR's diff to a byte-stable string must sort its own inputs.
- **`MockLLMProvider` has exactly one throw path** and it is per-`schemaName`, not per-call
  (`src/adapters/mocks.ts:94`). AC-14 needs a provider that fails **one** case of a set;
  `server/CLAUDE.md:21` forbids hand-rolling a replacement. Planned as an additive, default-off
  option on `MockLLMOptions` in Step 6, in the same commit as the test that needs it.
- **`arch:check` allows `src/db/** → src/modules/**`.** The rule
  `db-schema-only-in-data-layer` (`.dependency-cruiser-onion.cjs:37-44`) forbids the reverse
  direction only. So the seed **may** import a pure helper from `modules/evals/helpers.ts`,
  which is how AC-11's byte-equality survives having two writers of a snapshot.
- **Exactly one e2e flow asserts a seed-derived *count*, and Step 4 changes it.** A sweep of
  every `"--text"` literal in all ten flows
  (`grep -o '"--text", "[^"]*"' e2e/specs/*.flow.json`) returns one number:
  `e2e/specs/04-pr-findings.flow.json:14` waits for **`"4 findings"`**, the seeded review's
  accordion header, and the same string appears in that file's `description` at `:3`. Six more
  findings on that review make it read `10 findings` and **flow 04 fails**. Every other literal
  in every other flow is a title or a name this stream does not rename — including flow 09's
  `"Extract the magic number 3600 into a named constant"`, which only gains a decision.
  One further collision to avoid: `09-pr-smart-diff.flow.json:15` clicks
  `"Open the suggestion on line 28 in the Findings tab"`, a per-line aria-label, so no new
  seeded finding may sit on `src/middleware/ratelimit.ts:28` (`e2e/INSIGHTS.md` 2026-08-23 —
  a repeated control must be labelled by what it points at, and the fix belongs in the
  component, not the flow).
- **`check:vendor-ui` fires CRITICAL on any `client/src/vendor/ui/**` path**
  (`scripts/pr-self-review-checks.sh:91-100`) — Step 11 will trip it, and the override door was
  repaired on 2026-08-30 (root `INSIGHTS.md`, § Tool & Library Notes).

### Ordering constraints the spec implies but does not state

These are the `Depends:` lines below, and they exist because of root `INSIGHTS.md`
(2026-08-30, *"A plan's own dependency graph can encode an ordering that cannot be executed"*).

1. **Every integration lane in this spec reads `db:seed` output.** `test/integration.it.test.ts`
   imports `seed` and runs it (`:7,47`), and each integration file starts its own empty
   container (`test/helpers/pg.ts`). So AC-02's *"create a case from a decided finding"* cannot
   run before the seed writes a decided finding, and AC-10/AC-13/AC-14/AC-15's *"run the set"*
   cannot run before the seed writes a case set. **The seed step (Step 4) therefore precedes
   the creation step (Step 5) and the run step (Step 6)** — the reverse of the order the spec's
   `In scope` list happens to be written in.
2. **The seed needs the table and the contract before it can write a row** → Step 4 depends on
   Steps 1 and 2.
3. **The seed needs the diff serialiser** so that a seeded case and a created case are the same
   bytes → Step 4 depends on Step 3.
4. **A nav entry must not precede its route.** `client/src/vendor/ui/nav.ts:28-30` states it as
   a rule the file already follows: *"a nav entry to a route that does not exist is worse than
   no entry"*. So Step 11 (nav) follows Step 10 (the page).
5. **The e2e flow reads the hermetic stack's seeded rows and clicks the finished screens** →
   Step 13 depends on Steps 4 and 8–11.

---

## Constraints in force

| Constraint | Source | What it forbids here |
|---|---|---|
| SQL only in `repository.ts`, HTTP only in `routes.ts`, pure transforms in `helpers.ts`, literals in `constants.ts` | `server/CLAUDE.md:27-28` · `onion-architecture` | scoring or matching inside `routes.ts`; a Drizzle call in `service.ts` |
| Dependencies come from `container`, never by importing a concrete class | `server/CLAUDE.md:33-34` | `new OpenRouterProvider()` in the eval executor; tests could not swap it |
| A new module is `modules/<name>/routes.ts` **plus one line** in `modules/index.ts` | `server/CLAUDE.md:29-30` · `src/modules/index.ts:31-45` | a second registration mechanism |
| Route schemas come from `@devdigest/shared`; invalid input is 422 **before** the handler | `server/CLAUDE.md:37-38` | a hand-rolled `.parse(req.body)`; and any AC naming a status other than 422 must throw `AppError` from the service (`server/INSIGHTS.md`, 2026-08-29) — that is AC-06, AC-13 and AC-16 |
| `no-cross-module-import` is `severity: 'warn'`, so `arch:check` **exits 0** on it | `server/INSIGHTS.md` 2026-08-06 · root `INSIGHTS.md` 2026-08-22 · `.dependency-cruiser-onion.cjs:96-103` | gating on the exit code. Every `Verify:` below reads the **output** line |
| `src/modules/** (not repository) → src/db/**` is an `error`; the reverse is unruled | `.dependency-cruiser-onion.cjs:37-44` | a service importing `db/schema.js`. It **permits** `seed.ts → modules/evals/helpers.ts` |
| `reviewer-core` is zero-I/O and is reused unchanged | root `CLAUDE.md` § Map · `.dependency-cruiser-onion.cjs:77-94` | putting eval scoring in `reviewer-core`: it knows nothing of eval cases |
| A contract lives in `@devdigest/shared` and the client copy is a mirror | root `CLAUDE.md` § Gotchas · `client/CLAUDE.md:39-41` | a contract edit on one side only. `check:contract-mirror` compares changed **lines** |
| A `.default()` field is optional on input and **required** on `z.infer` | root `INSIGHTS.md` 2026-08-29 | adding one without owning every literal in the same commit — here, the seed's |
| A test that touches the DB **must** be `*.it.test.ts` | root `CLAUDE.md` § Conventions · `check:it-test-lane` | a Postgres test inside `verify:l06` |
| `verify:l06` runs no Docker, no Postgres, no network | AC-29 · `server/package.json:15` | listing an `.it.test.ts` file in the script |
| Migrations are generated, never hand-edited, and never run on boot | `server/CLAUDE.md:62` · `check:migration-edit` · `check:schema-migration` | writing SQL by hand — except drizzle-kit's own commented placeholder, which `server/INSIGHTS.md` (2026-08-30) says to complete **visibly** |
| `defaultNow()` is the **transaction's** timestamp | root `CLAUDE.md` § Gotchas | ordering a batch's rows by `ran_at`; every "latest per group" read needs a second key |
| A seed addition guarded inside `if (!pr)` is invisible on an existing database | root `INSIGHTS.md` 2026-08-02 · `seed.ts:516-524,758-766,808-816` | putting the decided findings or the cases inside that block |
| The seed never converges on **rename** | root `INSIGHTS.md` 2026-08-06 | keying a seeded row on a name and expecting a later rename to clean up |
| Editing `seed.ts` obliges a grep of `e2e/specs/*.json` for the changed literals | root `CLAUDE.md` § Gotchas · `check:e2e-contract` | changing a seeded string that a flow asserts |
| `client/src/vendor/ui/**` is do-not-touch, one authorised exception | root + `client/CLAUDE.md` · caller · `check:vendor-ui` | anything in `nav.ts` beyond the single `eval` item |
| No `fetch` inside a component; a new endpoint is a new hook in `src/lib/hooks/` | `client/CLAUDE.md:28-29` · `check:component-fetch` | calling the eval API from `FindingCard` |
| Component folder shape follows `client/docs/component-anatomy.md:20`, not `CLAUDE.md:25-27` | `client/INSIGHTS.md` 2026-08-05 | inventing six files where two carry content |
| `@testing-library/user-event` is **not installed** | `client/INSIGHTS.md` 2026-08-22 | `userEvent` in any new test — use `fireEvent`, and assert around disabled state rather than assuming a click implies interactability |
| `noUncheckedIndexedAccess` is on in `client/` and `pnpm test` cannot see it | `client/INSIGHTS.md` 2026-08-30 | calling a client step done on `pnpm test` alone |
| `pnpm typecheck` does not see `server/test/**` | `server/INSIGHTS.md` 2026-08-29 | trusting the server typecheck to catch a broken server fixture |
| `waitForPrRuns` returns silently on timeout | `server/INSIGHTS.md` 2026-08-07, 2026-08-28 | copying it for the eval-run wait. The new helper **throws with counts** |
| `@fastify/rate-limit` is not registered under `NODE_ENV=test` | `server/INSIGHTS.md` 2026-08-30 | asserting a per-route limit in an ordinary integration test |
| e2e flows trigger no LLM call and need no API key | `e2e/run.ts:17-18` · `scripts/e2e.sh` | an e2e flow that runs an eval |
| `design-reference` runs **before** the code on any UI surface | this plan's Step 8 policy | writing an Evals tab and then checking it against the design |

### Gate discipline

Inherited from `specs/plans/L05-project-context-folder.md` § Gate discipline and
`specs/plans/L05-pr-brief.md`, where each rule was paid for once:

1. **A step whose `Verify` runs a whole-package gate owns, in its `Files:`, everything that
   gate covers.** No step below ships a known red — the producer sweep at § Verified came back
   empty, which is what makes every `pnpm typecheck` line here honest.
2. **A shared-contract edit owns its producer sweep in the same step.** Step 2 runs the sweep
   before writing the field, not after the gate goes red.
3. **Read `pnpm arch:check`'s output, never its exit code.**
4. **Never run a whole-tree `diff -r` over `vendor/shared`.** Three file pairs differ before
   this work starts (`adapters.ts`, `contracts/eval-ci.ts`, `contracts/productionize.ts`).
   AC-27 is the two counts on **one** pair.
5. **A `Verify` with a hard-coded number states where the number came from.** The four in this
   plan (3, 33, 0, 0) were executed at `2038e95` and are quoted with their command.

---

## Implementation plan

### Step 1 — the run batch becomes a table   ·   package: server
Files:    `server/src/db/schema/eval.ts` (edit — `evalRuns`; new `evalRunBatches`) ·
          `server/src/db/schema.ts` (one import + one barrel entry, mirroring `:43,81-82`) ·
          `server/src/db/migrations/00NN_*.sql` + journal + snapshot (generated, never hand-edited)
Skills:   drizzle-orm-patterns, postgresql-table-design
Do:       Add `eval_run_batches`: `id` uuid pk `defaultRandom()`; `workspaceId` → `workspaces`
          `onDelete: 'cascade'`; `agentId` uuid `notNull` **with no FK**, mirroring
          `evalCases.ownerId` (`schema/eval.ts:13`) so a batch is a snapshot that outlives its
          agent exactly as a case outlives its PR — a deliberate asymmetry, flagged here so a
          reviewer can disagree; `systemPromptSnapshot` / `modelSnapshot` / `providerSnapshot`
          text `notNull` and `agentVersion` integer `notNull` (AC-10, and the design's
          "Version" column); `status` text enum `['running','done','partial','failed']` `notNull`
          default `'running'` (AC-13, AC-14); `startedAt` / `finishedAt` timestamptz;
          `recall` / `precision` / `citationAccuracy` doublePrecision **nullable** (null while
          running); `recallDenominator` / `precisionDenominator` / `citationDenominator`
          integer (AC-20); `casesTotal` / `casesRan` integer (AC-14's honest denominator,
          AC-24's two denominators); `durationMs`, `costUsd`, `error`.
          A **partial** `uniqueIndex` on `(agentId)` `where status = 'running'` — AC-13 as a
          constraint rather than a check-then-insert race.
          `evalRuns` gains `batchId` uuid `notNull` → `evalRunBatches` `onDelete: 'cascade'`
          (safe as `notNull`: the table has no writer anywhere in the tree — verified),
          `status` text enum `['passed','failed','errored']`, `error` text,
          `matchedCount` / `expectedCount` integer for AC-24's per-case list. `caseId`'s
          existing `onDelete: 'cascade'` (`:24-26`) is AC-08's half and is **not** touched.
          Then `pnpm db:generate` **once**, and `pnpm db:migrate` by hand.
Verify:   `cd server && pnpm db:generate` adds exactly one `.sql` under `src/db/migrations/` ·
          **read that file as a gate that can fail** (`server/INSIGHTS.md` 2026-08-30): confirm
          the partial unique index carries its `WHERE status = 'running'`, that the `batch_id`
          FK cascade is present, and that drizzle-kit left no commented `"<constraint_name>"`
          placeholder — if it did, complete it visibly and say so in the commit body ·
          `cd server && pnpm db:migrate` · `cd server && pnpm typecheck` (legal: this step
          touches no contract and no producer) ·
          `cd server && pnpm arch:check` — output must still read `✔ no dependency violations found`
Covers:   none — enabling work for AC-08, AC-10, AC-13, AC-14, AC-20, AC-24
Depends:  none
Commit:   `feat(db): an eval run is a batch that snapshots the prompt it ran under`

### Step 2 — the expectation and the batch, in both contract copies   ·   package: server + client
Files:    `server/src/vendor/shared/contracts/eval-ci.ts` (edit — **eval section only**) ·
          `client/src/vendor/shared/contracts/eval-ci.ts` (verbatim mirror)
Skills:   zod, onion-architecture
Do:       **The sweep first** (Gate discipline 2), and record that it is empty:
          `grep -rnE ": *(EvalCaseInput|EvalCase|EvalRunRecord|EvalRun|EvalDashboard|EvalTrendPoint|EvalPerTrace) *= *\{" server/src server/test client/src`
          → 0 at `2038e95`.
          In the eval section, above `EvalCaseInput`: `EvalExpectationKind =
          z.enum(['must_find','must_not_flag'])`; `EvalExpectation = z.object({ kind, file,
          start_line, end_line })` with the two lines `z.number().int()`; `EvalCaseMeta =
          z.object({ source_finding_id, pr_id, pr_number, created_from: z.literal('finding') })`
          — AC-05's provenance. Narrow `EvalCaseInput.expected_output` from `z.unknown()` to
          `EvalExpectation`, and `input_meta` to `EvalCaseMeta.nullish()`.
          **No `.default()` on any new field**, and the reason in a doc comment: both eval
          tables have zero rows in every environment (verified), so the persisted-JSON rule of
          `server/INSIGHTS.md` (2026-08-29) has no legacy row to protect, while a `.default()`
          would make the key required on `z.infer` in the seed literal Step 4 writes. A later
          field re-applies that rule rather than copying this exemption.
          Add `EvalRunBatchStatus`, `EvalRunBatch` (every column of Step 1, with
          `recall|precision|citation_accuracy` `z.number().nullable()` and the three
          denominators `z.number().int()`), `EvalRunBatchDetail` (batch + its `EvalRunRecord[]`)
          and `EvalRunComparison` (two batches + a per-case list carrying
          `case_id`, `name`, `before`, `after` each `'pass'|'fail'|'absent'|'skipped'`) —
          AC-24's per-case state change and AC-25's incompleteness marker.
          `EvalRunRecord` gains `batch_id`, `status`, `matched_count`, `expected_count`.
          **Untouched, in both copies:** everything from `// ===== Compose Review` down, and
          `AgentManifest` / `ConformanceInput` in particular. Neither barrel needs an edit —
          both already export `eval-ci.js` (`index.ts:25` in each).
Verify:   `diff server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts | grep -cE '^[0-9]'`
          → **3** · `… | grep -c '^[<>]'` → **33**. Both measured at `2038e95` and invariant
          under the line shift this step causes; any other number means the mirror drifted or
          the `AgentManifest` section moved ·
          `cd server && pnpm typecheck` · `cd client && pnpm typecheck` ·
          `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — still 28 files / 497 tests ·
          `cd client && pnpm test` — still 42 files / 321 tests
Covers:   AC-27
Depends:  Step 1
Commit:   `feat(shared): an eval expectation is a file and a line range, mirrored both sides`

### Step 3 — the pure core, and `verify:l06`   ·   package: server
Files:    `server/src/modules/evals/helpers.ts` (new) ·
          `server/src/modules/evals/constants.ts` (new) ·
          `server/src/modules/evals/scoring.ts` (new) ·
          `server/src/modules/evals/scoring.test.ts` (new) ·
          `server/src/modules/evals/helpers.test.ts` (new) ·
          `server/package.json` (one script line)
Skills:   typescript-expert, onion-architecture, zod
Do:       `constants.ts`: `MAX_INPUT_DIFF_CHARS = 100_000` (AC-06), `MAX_CASES_PER_RUN = 50`
          (AC-16), and the two `AppError` codes their callers throw.
          `helpers.ts`, all pure: `expectationFromFinding(finding)` — `accepted_at` → `must_find`,
          `dismissed_at` → `must_not_flag`, neither → throw (AC-02, AC-03's server half);
          `serializeDiff(diff: UnifiedDiff): string` — **sorts files by path before emitting**,
          because `getPrFiles` returns planner order (`pull.repo.ts:28-33`;
          `server/INSIGHTS.md` 2026-08-30) and AC-11's byte-equality must be a property of this
          function, not of a query it does not own; `caseSetForRun(cases)` — filters
          `owner_kind === 'agent'` and refuses above `MAX_CASES_PER_RUN` (AC-28, AC-16's
          boundary).
          `scoring.ts`, pure and **importing nothing from `adapters/`, `platform/` or any LLM
          port**: `rangesOverlap(a, b)` and `matches(finding, expectation)` — same `file`,
          intersecting `[start_line, end_line]` (AC-18); `scoreCase`, `scoreBatch` returning
          the three ratios **with their denominators**, `1` on an empty denominator (AC-20);
          `citationAccuracy({ findings, dropped, scopeDropped })` =
          `(findings.length + scopeDropped.length) / (findings.length + scopeDropped.length + dropped.length)`
          — the reading taken in § Ambiguities, with the doc comment explaining why
          `scopeDropped` sits on the numerator side (AC-19).
          Tests: a table for AC-18 (edges touching, nested, adjacent-but-disjoint, other file),
          an AC-19 case built from a real `groundFindings` result
          (`reviewer-core/src/grounding.ts:52`) **plus** one with a non-empty `scopeDropped`
          that goes red under the wrong reading, empty denominators for all three (AC-20), both
          limits (AC-06, AC-16), and AC-17's exploding provider: hand `scoreBatch` an object
          whose every method throws, and assert it returns.
          `package.json`: `"verify:l06": "vitest run src/modules/evals/scoring.test.ts src/modules/evals/helpers.test.ts"`
          — the `verify:l03` shape (`:15`), unit files only, so it stays Docker-free.
Verify:   `cd server && pnpm verify:l06` — green, and finishes in the `verify:l03` order of
          magnitude (226 ms there) ·
          `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — 28 → 30 files, 497 → 497+N ·
          **AC-17's zero-count gate:**
          `grep -cE "LLMProvider|completeStructured|container|\.complete\(|adapters/" server/src/modules/evals/scoring.ts`
          → **0**. Zero-count, not a positive count, precisely so it cannot confuse an import
          line with a call site (root `INSIGHTS.md` 2026-08-30). The shape was executed today
          against `reviewer-core/src/grounding.ts` and returned 0 ·
          `cd server && pnpm typecheck` · `cd server && pnpm arch:check` — output reads
          `✔ no dependency violations found`
Covers:   AC-17, AC-18, AC-19, AC-20, AC-29
Depends:  Step 2
Commit:   `feat(evals): scoring is file equality plus line overlap, and it calls no model`

### Step 4 — the seed carries a decided history and a case set   ·   package: server + e2e
> Two packages, deliberately. The `e2e` file is not new work — it is one literal that the
> `server` change invalidates the moment it lands, and splitting them leaves the e2e lane red
> in between (root `CLAUDE.md` § Gotchas).
Files:    `server/src/db/seed.ts` (edit — three new guarded blocks, all **outside** `if (!pr)`) ·
          `server/src/db/seed-evals.ts` (new — the ten findings and eight expectations as data) ·
          `server/test/evals-seed.it.test.ts` (new) ·
          `e2e/specs/04-pr-findings.flow.json` (edit — **two** occurrences of `4 findings`, at
          `:3` and `:14`)
Skills:   drizzle-orm-patterns, postgresql-table-design, onion-architecture
Do:       Three blocks, each guarded on **its own absence** and outside `if (!pr)` — the shape
          `seed.ts:758-766` already uses, and the trap root `INSIGHTS.md` (2026-08-02) records:
          (a) **backfill `reviews.agent_id`** on the demo review (`model = 'seed'`) to the
          seeded *General Reviewer*, `where agent_id is null`, reusing the lookup at
          `seed.ts:783-787`. Without it `eval_cases.owner_id` (`notNull`,
          `schema/eval.ts:13`) has no agent to name — see § Gaps.
          (b) **ten decided findings.** The four that exist (`seed.ts:460`) are decided in
          place `where accepted_at is null and dismissed_at is null` — which converges on a
          re-seed and never overwrites a user's own judgement — and six more are inserted
          if-absent, keyed on `(review_id, file, start_line, title)`. All ten point at files and
          lines inside the eight `PR_482_FILES` patches (verified: 8 files carry real `patch`
          text), because an expectation citing a file the diff does not contain can never be
          matched and would make `recall` structurally 0. Six accepted, four dismissed.
          **None of the six new findings may sit on `src/middleware/ratelimit.ts:28`** — the
          per-line aria-label there is what `09-pr-smart-diff.flow.json:15` clicks by name, and
          a second finding on that line makes the locator mean "whichever the runner picks
          first" (`e2e/INSIGHTS.md` 2026-08-23).
          The review's accordion header count moves 4 → 10, so
          `e2e/specs/04-pr-findings.flow.json` is edited **in this same commit**: the
          `"4 findings"` wait at `:14` and the same string in its `description` at `:3`. That is
          the obligation root `CLAUDE.md` § Gotchas names, and `check:e2e-contract` is what
          catches it if it is skipped.
          **Rename caveat**, per root `INSIGHTS.md` (2026-08-06): these rows are keyed by title,
          so a later rename leaves the old row behind — stated in a comment at the block, not
          solved here.
          (c) **eight eval cases** for the General Reviewer, built from eight of the ten
          (leaving one accepted and one dismissed finding un-cased as AC-02's and AC-04's
          fixtures — see § Ambiguities), guarded on `eval_cases` being empty for that owner.
          `input_diff` comes from `serializeDiff()` **imported from
          `src/modules/evals/helpers.js`** — a value import, not the type-only one at
          `seed.ts:5-9`. `arch:check` permits it (no rule constrains `^src/db/` as a source;
          verified against `.dependency-cruiser-onion.cjs:37-44`), and one shared assembler is
          the only way a seeded case and a created case can be the same bytes, which is what
          AC-11 asserts. Extend the file's own comment at `:5-9` by one sentence saying so.
          `expected_output` literals are typed `EvalExpectation` (type-only import) and
          `input_meta` `EvalCaseMeta`.
          The integration test: `seed(db)` twice, then assert ≥8 findings carrying a decision
          and that the count does **not** double (AC-09), ≥8 `eval_cases` for the seeded agent
          (AC-01), that the demo review's `agent_id` is **non-null** after both runs — the third
          population AC-09 names since `2378d54` — and that every seeded `expected_output`
          parses under `EvalExpectation`, which is what keeps the seed's literal and the
          service's writer one shape.
Verify:   `cd server && pnpm exec vitest run .it.test` (Docker) — the new file green, and
          `test/integration.it.test.ts`'s existing idempotence case (`:69-71`) still green.
          AC-09 now names three populations, so the lane asserts three counters, not one:
          decided findings ≥8, `eval_cases` ≥8, and the demo review's `agent_id` non-null —
          none of them doubling on the second seed ·
          `cd server && pnpm db:seed && pnpm db:seed` on a live database, then re-run the lane —
          AC-09's own two-run check ·
          **e2e literal gate, obliged by root `CLAUDE.md` § Gotchas.** Before the edit,
          `grep -c '4 findings' e2e/specs/04-pr-findings.flow.json` → **2** (measured at
          `2038e95`: the `description` at `:3` and the `wait --text` at `:14`). After it, the
          same grep → **0** and `grep -c '10 findings' …` → **2**. Then re-sweep the whole
          package for any other seed-derived count:
          `grep -o '"--text", "[^"]*"' e2e/specs/*.flow.json | grep -E '[0-9]+ finding'`
          → **1** line, and it is the one just edited ·
          `cd e2e && pnpm e2e:hermetic` — flow 04 in particular ·
          `cd server && pnpm typecheck` · `cd server && pnpm verify:l06` ·
          `cd server && pnpm arch:check` — output reads `✔ no dependency violations found`
Covers:   AC-01, AC-09
Depends:  Step 3
Commit:   `feat(seed): ten decided findings and the eight-case set they build`

### Step 5 — a finding becomes a case   ·   package: server
Files:    `server/src/modules/evals/repository.ts` (new) ·
          `server/src/modules/evals/service.ts` (new) ·
          `server/src/modules/evals/routes.ts` (new) ·
          `server/src/modules/index.ts` (one import + one entry) ·
          `server/test/evals-cases.it.test.ts` (new)
Skills:   onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns
Do:       `POST /eval-cases` with body `{ finding_id }`; `GET /agents/:id/eval-cases`;
          `DELETE /eval-cases/:id`. Service: load the finding and its review, refuse when the
          review has no `agent_id` (AC-30), derive the expectation with
          `expectationFromFinding` (AC-02), assemble the **whole** PR diff through
          `loadDiff(container, repo, ws, pull, repoRow)` — the same path a review takes
          (`src/modules/reviews/diff-loader.ts:12`) — then `serializeDiff` it (AC-05), refuse
          above `MAX_INPUT_DIFF_CHARS` **without truncating** (AC-06), and return the existing
          case instead of creating a second when `input_meta->>'source_finding_id'` already
          matches (AC-04).
          The owner refusal is AC-30 and takes the same shape as AC-06's oversize refusal:
          `reviews.agent_id` is nullable (`server/src/db/schema/reviews.ts:28`) while
          `eval_cases.owner_id` is `notNull` (`schema/eval.ts:13`), so when the finding's review
          names no agent the service throws
          `AppError('eval_case_no_owner', <message naming the missing agent>, 409)` **before any
          write** — the same `AppError(code, message, statusCode)` route AC-06 reports through,
          for the same reason (a Zod route schema can only ever answer 422), and no case is
          created without an owner.
          Every rejection is `AppError(code, message, statusCode)` thrown from the **service**,
          not the route schema — `server/INSIGHTS.md` (2026-08-29): a Zod route schema can only
          ever answer 422. Document the exception in the route, in the service class comment
          and here.
          Every query is scoped by `workspaceId` from `getContext(container, req)`
          (`server/CLAUDE.md:31-32`). `eval_cases` keeps **no** FK to the PR or the finding —
          it already has none (`schema/eval.ts:7-20`), which is AC-07 by construction.
          Integration test, on the seeded workspace: create from the un-cased accepted finding
          → `must_find`; from the un-cased dismissed one → `must_not_flag` (AC-02); two calls
          → one row (AC-04); the stored `input_diff` equals a freshly serialised whole-PR diff
          and `input_meta.source_finding_id` is the finding's id (AC-05); a fabricated
          >100 000-char PR is refused and stores nothing (AC-06); delete the PR, re-read the
          set — the case is still there (AC-07); delete a case that has `eval_runs` rows and
          both disappear (AC-08).
          **AC-30 brings its own fixture and must not undo Step 4.** After Step 4 the seeded
          workspace has no agent-less review left — the backfill is `where agent_id is null`,
          so it removes exactly the row this lane needs. The test therefore *inserts* one:
          a `reviews` row on the seeded PR with `agentId` omitted, plus one finding on it. That
          is the ordinary fixture idiom in this lane, already used at
          `test/reviews.it.test.ts:417,461`, `test/smart-diff.it.test.ts:147` and
          `test/skills.it.test.ts:574`. Assert the route refuses **and** that
          `select count(*) from eval_cases` is unchanged across the call.
Verify:   `cd server && pnpm exec vitest run .it.test` (Docker) — the new file green and
          the lane no worse than before. If an **unrelated** integration file goes red, re-run
          the reduced lane **at least five times** before concluding anything: the
          `skills.it.test.ts` race is ~20% at 13–14 containers regardless of the newest file
          (`server/INSIGHTS.md` 2026-08-28 + its 2026-08-29 correction) ·
          **AC-30's case explicitly**: with a locally inserted agent-less review, the route
          returns the refusal and the message names the missing agent, and `eval_cases` holds
          the same number of rows after the call as before it — counted on both sides of the
          request, not merely "no new row for this finding" ·
          `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` ·
          `cd server && pnpm verify:l06` · `cd server && pnpm typecheck` ·
          `cd server && pnpm arch:check` — output reads `✔ no dependency violations found`;
          a `warn no-cross-module-import` line is a **failure** here even though the exit code
          is 0 (`server/INSIGHTS.md` 2026-08-06)
Covers:   AC-02, AC-04, AC-05, AC-06, AC-07, AC-08, AC-30
Depends:  Step 4
Commit:   `feat(evals): a decided finding becomes a frozen case in one call`

### Step 6 — the run   ·   package: server
Files:    `server/src/modules/evals/run-executor.ts` (new) ·
          `server/src/modules/evals/service.ts` (edit) ·
          `server/src/modules/evals/repository.ts` (edit) ·
          `server/src/modules/evals/routes.ts` (edit) ·
          `server/src/modules/evals/helpers.test.ts` (edit — AC-11's byte-equality case) ·
          `server/src/adapters/mocks.ts` (edit — one additive option) ·
          `server/test/helpers/evals.ts` (new — a wait helper that **throws**) ·
          `server/test/evals-runs.it.test.ts` (new)
Skills:   onion-architecture, fastify-best-practices, typescript-expert
Do:       `POST /agents/:id/eval-runs` → insert the batch with the prompt, provider, model and
          `agents.version` read **at run start** (AC-10), then return the batch id
          immediately and execute with `void this.executor.run(...).catch(...)` — the
          fire-and-forget shape `src/modules/reviews/service.ts:133` already uses (AC-15).
          `GET /eval-runs/:id` and `GET /agents/:id/eval-runs` are the state reads AC-15
          requires, modelled on `GET /pulls/:id/runs/active`
          (`src/modules/reviews/routes.ts:143`).
          The executor: `caseSetForRun` (Step 3) selects `owner_kind === 'agent'` only and
          refuses above 50 (AC-28, AC-16); per case, `parseUnifiedDiff(case.input_diff)` and
          `runReview` from `@devdigest/reviewer-core` with the **agent's own** model and the
          `llm` taken from `container` (§ Non-functional requirements: never a cheaper pinned
          one); score with Step 3's pure functions; write one `eval_runs` row per case, then
          the batch's aggregates and denominators (AC-20).
          A case that throws is caught, written as `status: 'errored'`, and the batch finishes
          as `status: 'partial'` with `casesRan < casesTotal` (AC-14). The second concurrent
          request is refused by the partial unique index from Step 1, surfaced as an
          `AppError` naming the reason — never queued (AC-13).
          `mocks.ts`: add `failStructuredOnCall?: number[]` to `MockLLMOptions`, default
          undefined, throwing on the listed 1-based `completeStructured` calls. Additive and
          off by default, so no existing test changes; `server/CLAUDE.md:21` forbids
          hand-rolling a replacement, which is why the shared mock grows instead.
          `test/helpers/evals.ts`: a bounded wait that **throws with the counts it saw** —
          `waitForPrRuns` returning its rows on timeout is what turns a slow lane into an
          assertion three lines away from the cause (`server/INSIGHTS.md` 2026-08-07).
          AC-11's unit test lives in `helpers.test.ts` and so enters `verify:l06`: build the
          run input for one seeded-shaped case fixture twice and assert string equality.
Verify:   `cd server && pnpm verify:l06` — now carries AC-11 and AC-16 ·
          `cd server && pnpm exec vitest run .it.test` (Docker) — AC-10 (edit
          `agents.system_prompt` between two **sequential** runs; both snapshots differ and each
          matches the prompt at its own start), AC-13, AC-14 (with `failStructuredOnCall`),
          AC-15 (the POST resolves before the batch reaches a terminal status, and the state is
          readable from the second endpoint), AC-20's persisted denominators ·
          `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` ·
          **AC-28's zero-count gate:**
          `grep -rnE "ownerKind: *['\"]skill['\"]|owner_kind: *['\"]skill['\"]" server/src | wc -l`
          → **0**. Executed at `2038e95` and returned 0, so the gate is a real regression check
          from the first commit onward ·
          `cd server && pnpm typecheck` · `cd server && pnpm arch:check` — output reads
          `✔ no dependency violations found`
Covers:   AC-10, AC-11, AC-13, AC-14, AC-15, AC-16, AC-28
Depends:  Step 5
Commit:   `feat(evals): a run is a batch over the frozen set, and a failed case is not a failed run`

### Step 7 — the read surfaces the screens need   ·   package: server
Files:    `server/src/modules/evals/repository.ts` (edit) ·
          `server/src/modules/evals/service.ts` (edit) ·
          `server/src/modules/evals/routes.ts` (edit) ·
          `server/test/evals-reads.it.test.ts` (new)
Skills:   onion-architecture, fastify-best-practices, drizzle-orm-patterns
Do:       `GET /evals/dashboard` → `EvalDashboard` for the workspace: `cases_total`, the three
          `current` metrics from the newest terminal batch per agent, `delta` against the one
          before it, `recent_runs`, `trend: []` and `alert: null` — both deliberately unfilled
          (`Out of scope`), with a doc comment saying they are a later stream's slot rather than
          an oversight.
          `GET /eval-runs/compare?a=&b=` → `EvalRunComparison`: two batches with their
          denominators, and the per-case list with `before` / `after` in
          `pass | fail | absent | skipped` — `absent` is a case present in one run's set and not
          the other, which is how two runs of different set sizes stay comparable (spec
          § Edge cases).
          **`ran_at` alone cannot order these rows.** `defaultNow()` is the transaction's
          timestamp (root `CLAUDE.md` § Gotchas), so a batch's `eval_runs` all share one
          microsecond; every "latest per group" read sorts by `(started_at desc, id desc)` and
          says so in a comment.
Verify:   `cd server && pnpm exec vitest run .it.test` (Docker) — two batches over one seeded
          set, one of them `partial`, read back through both endpoints; a case added between
          them appears as `absent` on the earlier side ·
          `cd server && pnpm verify:l06` · `cd server && pnpm typecheck` ·
          `cd server && pnpm arch:check` — output reads `✔ no dependency violations found`
Covers:   none — enabling work for AC-21, AC-22, AC-23, AC-24, AC-25
Depends:  Step 6
Commit:   `feat(evals): the dashboard aggregate and the two-run comparison`

### Step 8 — the eval control on a finding   ·   package: client
Files:    `client/src/lib/hooks/evals.ts` (new) ·
          `client/src/lib/hooks/index.ts` (one export line) ·
          `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` (edit) ·
          `.../FindingCard/constants.ts` (edit) · `.../FindingCard/styles.ts` (edit) ·
          `.../FindingCard/FindingCard.test.tsx` (edit) ·
          `.../FindingsPanel/FindingsPanel.tsx` (edit — wires the mutation, as it already wires
          accept/dismiss) ·
          `client/messages/en/prReview.json` (edit — the control's copy and its disabled reason)
Skills:   design-reference *(run **before** the code)*, react-best-practices, next-best-practices, react-testing-library, typescript-expert
Do:       `design-reference` first: the spec's § Design analysis records that the `FindingCard`
          artboards carry **no** eval control at all, so this surface is *derived*. Read the
          artboard for the card's action row before inventing a third button, and match its
          `Button kind`/`size` rather than guessing.
          A "Turn into eval case" control in the existing action row beside Accept and Dismiss
          (`FindingCard.tsx:119-139`). Its `disabled` is derived **inside** `FindingCard` from
          `f.accepted_at` / `f.dismissed_at` — the same two fields the card already reads at
          `:79-80` — with the reason as its title/aria text, so a component test can see all
          three states (AC-03). `FindingCard` calls `onCreateEvalCase?.()`, never `fetch`
          (`client/CLAUDE.md:28-29`, `check:component-fetch`); the mutation and the "go to the
          existing case" navigation live in `FindingsPanel` and `lib/hooks/evals.ts`.
          `useCreateEvalCase` invalidates the agent's eval-case key on success.
          Tests use `fireEvent`, not `userEvent` — the package does not ship it
          (`client/INSIGHTS.md` 2026-08-22) — and assert the `disabled` attribute rather than
          "the click did nothing".
Verify:   `cd client && pnpm test` — 42 → 42 files, 321 → 321+N, the three AC-03 states each a
          named case · `cd client && pnpm typecheck` — **required**: `noUncheckedIndexedAccess`
          is on and vitest cannot see it (`client/INSIGHTS.md` 2026-08-30) ·
          `grep -rn "fetch(" client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/FindingCard/` → **0**
Covers:   AC-03
Depends:  Step 5
Commit:   `feat(web): a decided finding offers to become an eval case`

### Step 9 — the Evals tab   ·   package: client
Files:    `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (edit — one `TABS` entry) ·
          `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` (edit — one branch) ·
          `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/` (new folder) ·
          `.../EvalsTab/_components/MetricRow/` (new — the `—` rule, reused by Steps 10 and 12) ·
          `client/src/lib/hooks/evals.ts` (edit) ·
          `client/messages/en/eval.json` (**rewrite**) ·
          `client/src/app/agents/[id]/page.test.tsx` (new — only if the tab list proves to be
          filtered in the page's callback rather than in `TABS`)
Skills:   design-reference *(run **before** the code)*, frontend-architecture, react-best-practices, react-testing-library
Do:       `design-reference` first: the `agent-evals` artboard is a **bare case list** with no
          metrics and no run history (spec § Design analysis), so the history section is
          *derived* and follows `skill-evals` where an analogue exists. Read both before
          writing either.
          A third tab, `{ key: "evals", labelKey: "editor.tabs.evals", icon: "Gauge" }`.
          `TAB_KEYS` is derived from `TABS` (`constants.ts:22-23`), so the route's allow-list
          follows for free — the file says why a second hand-written copy is a trap.
          The tab renders the case list (name, expectation badge, source file:line,
          view-and-delete only — **no Edit, no per-case Run**, both `Out of scope`) and the run
          history, each row carrying its own metrics, `casesRan/casesTotal` and an explicit
          incomplete marker. `Run all` is **disabled with a reason** on an empty set (AC-12).
          `MetricRow` renders `—` whenever the metric's denominator is 0, never a rounded `1`
          (AC-21) — the design's cards do `Math.round(value * 100)` with no such branch
          (spec § Design analysis 2).
          **`messages/en/eval.json` is rewritten, not adopted.** It already exists, is fully
          written, and promises three things this spec excludes — `caseEditor.save` /
          `caseEditor.runCase` (a manual editor), `evalsTab.run` / `evalsTab.edit` (a per-case
          run and edit) and `dashboard.metricTrend` (a trend chart). Per `client/INSIGHTS.md`
          (2026-08-29) a message file is the one place a removed feature still makes a factual
          claim to the user. Nothing reads the namespace today, so deleting those keys breaks
          nothing.
Verify:   `cd client && pnpm test` — empty-set disabled Run (AC-12), the list + history render
          (AC-22), `—` on both a metric card and a history row (AC-21) ·
          `cd client && pnpm typecheck` ·
          `grep -c "runCase\|metricTrend\|\"edit\"" client/messages/en/eval.json` → **0** — the
          excluded-feature copy is gone rather than left to be discovered later ·
          `git diff --stat client/src/vendor/ui/` → **empty** (this step touches no vendored file)
Covers:   AC-12, AC-21, AC-22
Depends:  Step 7
Commit:   `feat(web): the Evals tab lists a set and the runs over it`

### Step 10 — the Eval Dashboard page   ·   package: client
Files:    `client/src/app/eval/page.tsx` (new) ·
          `client/src/app/eval/_components/EvalDashboardView/` (new folder) ·
          `client/src/lib/hooks/evals.ts` (edit) · `client/messages/en/eval.json` (edit)
Skills:   design-reference *(run **before** the code)*, frontend-architecture, next-best-practices, react-best-practices, react-testing-library
Do:       Route `/eval`, chosen so that `activeKeyFor` highlights the sidebar entry with **no**
          edit — it already returns `"eval"` for `pathname.startsWith("/eval")`
          (`client/src/components/app-shell/helpers.ts:35`, verified).
          Three metric cards (RECALL / PRECISION / CITATION ACCURACY) through Step 9's
          `MetricRow`, plus the recent-runs table. The `skill-evals` artboard is the layout
          source; it is scoped to a **skill**, so this page is *derived* — label it as such in
          the component's header comment so a later reader can tell it from a drawn screen.
          The trend chart and the alert banner the artboard carries are **not** built:
          `Out of scope`, and `EvalDashboard.trend` / `.alert` stay `[]` / `null`.
          The empty state — no run has ever happened — is derived too, and is what a hermetic
          stack renders.
Verify:   `cd client && pnpm test` — the page renders the three metric labels, the `—` values
          on an empty workspace, and a populated recent-runs table on a fixture (AC-23's
          component half) · `cd client && pnpm typecheck` ·
          `git diff --stat client/src/vendor/ui/` → **empty**
Covers:   AC-23
Depends:  Step 9
Commit:   `feat(web): an Eval Dashboard for the workspace's agents`

### Step 11 — the one authorised nav entry   ·   package: client
Files:    `client/src/vendor/ui/nav.ts` (edit — **one** item, nothing else)
Skills:   frontend-architecture
Do:       Add `{ key: "eval", label: "Eval Dashboard", icon: "Gauge", href: "/eval" }` to the
          `SKILLS LAB` group. `Gauge` is a real `IconName` (`icons.tsx:58,140`, verified).
          **No `gKey`**, and no new `SHORTCUTS` row: the design gives the item no shortcut, and
          the file already sets the precedent of omitting one deliberately with a comment
          (`nav.ts:48-49`). **No new section** — the design's GLOBAL group is a later lesson
          and adding it would be more than one entry. Update the file's own comment at
          `:27-30`, which currently says the `eval` item is absent because it is a later
          lesson: that sentence becomes false with this commit.
          This step comes **after** Step 10 because `nav.ts:29-30` states the rule itself — *"a
          nav entry to a route that does not exist is worse than no entry"*.
Verify:   `git diff client/src/vendor/ui/nav.ts | grep -c '^+' ` → the added item plus the
          comment edit and nothing more; **read the whole diff** — the risk this step exists to
          contain is drift beyond one entry (spec § Risks) ·
          `cd client && pnpm test` · `cd client && pnpm typecheck` ·
          **Expect `check:vendor-ui` to fire CRITICAL** at PR time
          (`scripts/pr-self-review-checks.sh:91-100` matches any `client/src/vendor/ui/` path
          and cannot see that the caller authorised this one). Clear it with
          `/pr-self-review --override` **with a reason** — section 3 now reads the override
          before it blocks, repaired 2026-08-30 (root `INSIGHTS.md`), and the override retires
          itself on the next edit because it is keyed to the diff digest
Covers:   AC-23
Depends:  Step 10
Commit:   `feat(ui): the Eval Dashboard takes its place in the sidebar`

### Step 12 — comparing two runs   ·   package: client
Files:    `client/src/app/eval/compare/page.tsx` (new) ·
          `client/src/app/eval/compare/_components/RunComparison/` (new folder) ·
          `client/src/lib/hooks/evals.ts` (edit) · `client/messages/en/eval.json` (edit)
Skills:   design-reference *(run **before** the code)*, frontend-architecture, react-best-practices, react-testing-library
Do:       `design-reference` first, and expect nothing: **no artboard exists anywhere for a
          side-by-side comparison** (spec § Design analysis). This whole screen is *derived*;
          it borrows `skill-evals`' metric-card and table vocabulary and invents the rest. Say
          so in the component's header comment.
          Route `/eval/compare?a=&b=` — still under `/eval`, so the sidebar stays highlighted
          with no `helpers.ts` edit. Two metric columns with the delta between them, each metric
          showing **its own denominator** so two runs of different set sizes are never reduced
          to one percentage (spec § Edge cases). The per-case list shows every case's
          `before → after` including `absent` and `skipped` (AC-24); a `partial` batch is
          labelled incomplete **next to its metrics**, not in a footnote (AC-25).
          Entry point: a compare control on Step 9's run-history rows.
Verify:   `cd client && pnpm test` — a fixture pair of batches renders two columns, a delta and
          a per-case state change (AC-24); a fixture with one `partial` batch shows the
          incompleteness marker beside its metrics (AC-25) ·
          `cd client && pnpm typecheck` · `git diff --stat client/src/vendor/ui/` → **empty**
Covers:   AC-24, AC-25
Depends:  Step 11
Commit:   `feat(web): two runs side by side, with the cases that changed state`

### Step 13 — the browser flow   ·   package: e2e
Files:    `e2e/specs/11-eval-pipeline.flow.json` (new)
Skills:   typescript-expert *(`*.ts` only — this step adds JSON, so the lane is repo rules)*
Do:       One flow, model-free by construction: open the seeded PR, expand an accepted finding,
          click **Turn into eval case**; open the same PR's dismissed finding and repeat;
          navigate to `/agents/<seeded>?tab=evals` and wait for the seeded case rows; click the
          sidebar's **Eval Dashboard** and wait for the three metric labels and the `—` values.
          **It stops short of running an eval.** `e2e/run.ts:17-18` states the package's
          contract — no LLM call, no API key — and `scripts/e2e.sh` supplies neither; the
          run-and-read-metrics half is AC-26's manual live run (Step 14). See § Contradictions.
          Express every expectation as a `wait` step with a descriptive label — the runner fails
          the step on a non-zero exit, and an assertion layer on top is redundant
          (`e2e/INSIGHTS.md`, promoted). Use `find role button click --name` for the eval
          control, never `find text … click` (`e2e/INSIGHTS.md` 2026-08-06), and give the
          control a name that names the finding it acts on, because the seeded PR renders ten
          of them (`e2e/INSIGHTS.md` 2026-08-23 — fix it in the component, not the flow). Put a
          `wait --text` before the first click on any fetched screen (`e2e/INSIGHTS.md`
          2026-08-02).
Verify:   `cd e2e && pnpm e2e:hermetic` — flows 01–11 green on the isolated 5433/3101/3100
          stack. On a step failure read `test-results/11-*-fail.png` before suspecting the code:
          a skeleton in the screenshot means a missing wait ·
          `cd e2e && pnpm typecheck`
Covers:   AC-02, AC-22, AC-23
Depends:  Step 12
Commit:   `test(e2e): finding to case to dashboard, without a model call`

### Step 14 — the live run that AC-26 asks for   ·   package: — (manual, no code)
Files:    none — this step produces artefacts, not commits to source
Skills:   none
Do:       The one criterion the spec itself excludes from automation, because asserting it
          against `MockLLMProvider` would test the mock (§ Test plan). `./scripts/dev.sh`, a
          real provider key, the seeded eight-case set:
          (1) run the set on the current system prompt; (2) edit `agents.system_prompt`
          deliberately — remove one class of finding the set expects — and run again;
          (3) open `/eval/compare?a=&b=` and read the delta column and the per-case list.
          Budget the wall clock honestly: a healthy call is **14–28 s** and OpenRouter
          intermittently stalls one outright (root `INSIGHTS.md` 2026-08-06, five consecutive
          live runs), so eight whole-PR cases is minutes, not seconds. That is why the run is
          not held on an HTTP request (AC-15) and why a stalled case fails the case rather than
          the run (AC-14) — both already built.
Verify:   the comparison screen shows a visible `recall` or `precision` difference between the
          two runs, and the per-case list names which cases changed state. **Artefacts:** the
          comparison screenshot and the screencast, which the spec names as the submission's
          deliverables
Covers:   AC-26
Depends:  Step 13
Commit:   none — no source change. If the run exposes a defect, it opens a new step, it does
          not amend this one

---

## Coverage

Built from the spec's ids, in order — not from the steps.

| AC | Step | AC | Step |
|---|---|---|---|
| AC-01 | 4 | AC-16 | 6 *(boundary unit test written in 3)* |
| AC-02 | 5, 13 | AC-17 | 3 |
| AC-03 | 8 | AC-18 | 3 |
| AC-04 | 5 | AC-19 | 3 |
| AC-05 | 5 | AC-20 | 3, 6 |
| AC-06 | 5 *(boundary unit test written in 3)* | AC-21 | 9 |
| AC-07 | 5 | AC-22 | 9, 13 |
| AC-08 | 5 *(cascade in 1, UI row in 9)* | AC-23 | 10, 11, 13 |
| AC-09 | 4 | AC-24 | 12 |
| AC-10 | 6 | AC-25 | 12 |
| AC-11 | 6 *(serialiser written in 3)* | AC-26 | 14 |
| AC-12 | 9 | AC-27 | 2 |
| AC-13 | 6 *(index in 1)* | AC-28 | 6 |
| AC-14 | 6 | AC-29 | 3 *(re-run by every later server step)* |
| AC-15 | 6 | AC-30 | 5 |

**30 of 30 criteria have a step. Uncovered: none.**

**Reverse sweep.** No step's `Covers:` names an id the spec does not carry. Steps 1, 7 and 14
were checked hardest: 1 and 7 claim `none — enabling work` rather than borrowing a criterion
they only make possible, and 14 claims only AC-26, which the spec itself marks unautomatable.
Re-run over Step 5 after the `2378d54` amendment: `AC-30` **is** in the spec (`:199`), so
Step 5's enlarged `Covers:` invents nothing. AC-01 and AC-09 were re-read against their new
wording — both still land on the steps that already held them, and AC-09's third population
(`reviews.agent_id` non-null) is work Step 4 already did, now also asserted by its lane.

**Data-versus-lane sweep** — the check root `INSIGHTS.md` (2026-08-30) says the three coverage
directions do not perform. Every integration lane below, matched to the step that writes the
rows it reads:

| Lane, and the step that owns it | Data it asserts against | Step that writes that data | Arrow |
|---|---|---|---|
| Step 4 — AC-01, AC-09 | `seed()` output | Step 4 | self ✓ |
| Step 5 — AC-02, AC-04, AC-05, AC-06, AC-07, AC-08 | seeded **decided findings** | Step 4 | 5 depends on 4 ✓ |
| Step 5 — **AC-30** | a review with `agent_id` **null** | **no step — the test inserts it** | see below ✓ |
| Step 6 — AC-10, AC-13, AC-14, AC-15, AC-20 | seeded **eval case set** | Step 4 | 6 depends on 5 depends on 4 ✓ |
| Step 7 — the two read endpoints | batches written by Step 6's executor | Step 6 | 7 depends on 6 ✓ |
| Step 13 — the e2e flow | the hermetic stack's seed + the finished screens | Steps 4, 8–12 | 13 depends on 12 ✓ |
| Steps 3, 8, 9, 10, 12 | pure fixtures only, no persisted row | — | no dependency to invert ✓ |

The seed is Step **4**, not Step 10 — that inversion is the whole reason it sits third from the
front rather than where `In scope` lists it.

**AC-30's row is the one that needed thought, and it inverts in an unusual direction.** Step 4
backfills the demo review `where agent_id is null`, so it *destroys* the only agent-less review
the seeded workspace would otherwise have had. A lane that read seeded data here would be
unrunnable after the step it depends on — the mirror image of the L05 trap, and invisible to a
sweep that only asks "which step writes this row". The resolution keeps both: **AC-30's lane
depends on no step for its fixture**, because it inserts its own agent-less `reviews` row, as
four existing integration files already do. Step 4 stays exactly as written, and nothing about
the demo workspace is weakened to make a test pass.

---

## Commit plan

Thirteen commits, one per step; Step 14 produces no commit. The boundaries are defensible on
three rules, each of which is a rule this repository already enforces:

1. **A contract edit and its mirror are one commit** (Step 2). `check:contract-mirror` compares
   changed lines, and a tree split across two commits is broken in between — root `CLAUDE.md`
   § Gotchas.
2. **A schema change and its generated migration are one commit** (Step 1).
   `check:schema-migration` fires CRITICAL on a `server/src/db/schema/` change whose diff adds
   no new `.sql` (`scripts/pr-self-review-checks.sh:170-178`).
3. **The `nav.ts` entry is a commit of its own** (Step 11), because the caller made it the
   single authorised exception to a do-not-touch rule and an exception is only auditable when
   it is alone in its diff.

A fourth, specific to this feature: **the seed edit and the e2e flow it invalidates are one
commit** (Step 4). `e2e/specs/04-pr-findings.flow.json` asserts the seeded review's finding
count, and a tree where the seed says 10 and the flow says 4 is a tree whose e2e lane is red at
every commit in between — root `CLAUDE.md` § Gotchas states the pairing, `check:e2e-contract`
enforces it.

Two more that follow from the plan rather than from a script: the `mocks.ts` option ships in
the same commit as the test that needs it (Step 6), so no commit adds a mock capability nothing
uses; and `messages/en/eval.json`'s rewrite ships with its first real consumer (Step 9), so no
commit leaves the tree with copy that promises a screen that does not exist — which is the
state the tree is in **today**, and Step 9 is what ends it.

---

## Handoff

```
Plan file:      specs/plans/eval-pipeline.md
Entry point:    Step 1
Execution mode: single-agent pass
Verification:   server        cd server && pnpm verify:l06
                              cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
                              cd server && pnpm exec vitest run .it.test          (Docker)
                              cd server && pnpm typecheck
                              cd server && pnpm arch:check                        (read the OUTPUT)
                client        cd client && pnpm test && cd client && pnpm typecheck
                e2e           cd e2e && pnpm e2e:hermetic && cd e2e && pnpm typecheck
                contracts     diff server/src/vendor/shared/contracts/eval-ci.ts \
                                   client/src/vendor/shared/contracts/eval-ci.ts
                              → 3 change commands, 33 lines starting < or >
Closing step:   Step 14's manual live run, its screenshot and its screencast. Then flip the
                spec's Status draft → in-progress the moment this plan exists (specs/README.md
                § Rules 5, and the spec's own Status note says so), and to `done` when Step 14's
                artefacts exist. Before the pull request: /pr-self-review, which will fire
                check:vendor-ui on Step 11's nav entry — clear it with --override and a reason,
                not by reverting the authorised edit.
Deviation policy: stop at the step, report the divergence, finish the independent steps.
                  Do not re-plan, and do not amend the spec — a gap goes to `spec-creator`.
```

**Why single-agent.** Steps 1 → 2 → 3 → 4 → 5 → 6 → 7 is a strict chain: the migration defines
the columns the contract names, the contract types the literal the seed writes, the seed writes
the rows every later integration lane reads, and the run cannot exist before the case. Steps
8 → 9 → 10 → 11 → 12 are a second strict chain in `client/`, each consuming the endpoint or the
component the step before it created, and all five depend on Step 7. The only genuinely
parallel pair is Step 8 (which needs only Step 5) against Steps 6–7 — one step's worth of
concurrency across thirteen. Paying for parallel contexts that then serialise anyway costs more
than it saves, and every context would have to re-derive the same seven `INSIGHTS.md` entries
this plan already carries. **Reversible:** if Step 8 is started early in a second context, its
only prerequisite is Step 5's route contract.

---

## Recommendations

Proposals. None of these is a requirement, and none should be implemented as one.

1. **Sort the comparison's per-case list by state change, not by name.** The spec's own
   § Design analysis raises it as a proposal (*"a list ordered by name buries the three rows the
   experiment was run to see"*). It is nearly free inside Step 12 and it is the difference
   between a screen that answers AC-26's question and one that makes a human scroll for it.
2. **Label each metric card with its denominator inline — `recall 6/8`.** The spec proposes it;
   Step 1 persists the denominators anyway, so the data is already on the wire. A ratio without
   its denominator is exactly the failure mode this feature exists to remove one level up.
3. **Show the two prompt snapshots' difference on the comparison screen**, not just their
   versions. Step 1 stores both prompts in full, so this is a rendering decision, not a data
   one — and "which edit moved this" is the question AC-26 is answered with.
4. **Make Step 3 the step that is written last, mentally.** Its five pure functions are the only
   thing in this plan a later stream will import, and they are the only thing `verify:l06`
   protects. Time spent on their signatures before Step 4 exists is cheaper than time spent
   changing them once the seed, the service and the executor all call them.
5. **Do not seed a fabricated `eval_run_batch` to make the dashboard non-empty.** It would make
   Step 10's screen look finished and AC-23's e2e flow read three numbers instead of three
   dashes — and it would put invented metrics on the one screen whose entire premise is that its
   numbers are earned. The `—` empty state is the honest demo, and it exercises AC-21 for free.
6. **Consider a follow-up entry for `INSIGHTS.md` on the ordering finding**, once this ships:
   *every integration lane in this repository reads `seed()`, so any plan step whose lane
   asserts persisted rows depends on the seed step, whatever its subject is.* That is the
   general form of the L05 trap and it would have caught this plan's original ordering.
   Recording it is the main session's job, not the implementer's.
