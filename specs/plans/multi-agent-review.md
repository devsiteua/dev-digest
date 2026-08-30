# Implementation plan — Multi-Agent Review

Spec: [`../multi-agent-review.md`](../multi-agent-review.md) · Spec ID `MULTI-AGENT-REVIEW` ·
Branch: `feat/multi-agent-review` · Base: `lesson-07` · Stream L07-A · worktree `dev-digest-l07a`

Thirteen steps, twelve commits. The tree is clean at `9ed6231` (`git status --porcelain` empty,
`git diff --name-only lesson-07...HEAD` → `specs/multi-agent-review.md` alone), so nothing below
works around uncommitted code.

Every claim in this file was checked against the tree at `9ed6231`, not remembered. `file:line`
is where it was checked. Every gate carrying a hard-coded number was **executed today**, against
the current tree, even where the code it will check does not exist yet — root `INSIGHTS.md`
2026-08-30 (`grep -c` cannot tell an import from a call).

---

## Requirements review

Nothing here edits the spec. Where a gap is closed by a decision, it is recorded as **my**
decision so a reviewer can disagree with me rather than with the requirement.

### Contradictions — returned to `spec-creator`, planned around explicitly

- **AC-07 needs a contract file the spec does not allocate — `contracts/review-api.ts`.**
  AC-07 requires `POST /pulls/:id/review`'s response to carry `multi_agent_run_id`. That
  response is `ReviewRunResponse`, and it lives at
  `server/src/vendor/shared/contracts/review-api.ts:64-69`, **not** in `platform.ts`. The spec's
  § Shared contracts and their owners grants this stream `observability.ts` and `platform.ts`
  § `RunRequest` only, and § Owned directories and files says "Anything not on this list is a
  boundary breach and should be raised rather than edited". AC-32 likewise names only two files
  as the mirror-checked pair.
  **Raised, and the plan takes the only reading that builds:** Step 2 edits `review-api.ts` in
  **both** copies, in the same commit as the other two pairs, and extends the `cmp -s` gate to
  three pairs instead of two — covering more than AC-32 asks, which is the acceptable direction.
  Checked before deciding: `cmp -s` says the two `review-api.ts` copies are **byte-identical
  today**, and worktree B's diff (`git -C ../dev-digest-l07b diff --name-only lesson-07...HEAD`)
  touches `agent-runner/**` and `specs/export-to-ci.md` and nothing else, so this is not a
  collision with B. The ownership table needs the third row; that is `spec-creator`'s edit.

- **The spec's § Context claims parallel execution, and `run-executor.ts` is sequential.**
  Row 1 of § Context reads *"N agents run in parallel from one request"*, and § Non-goals says
  *"Parallel execution … exist in `run-executor.ts`"*. Both are false as written.
  `run-executor.ts:122-129` is `for (const { agent, runId } of jobs) { … await
  this.runOneAgent(…) }` — one `await` per agent, in order. There is no `Promise.all`, no
  `allSettled`, no queue and no `p-queue` anywhere in the file
  (`grep -n 'Promise\|for (' server/src/modules/reviews/run-executor.ts`). What *is* shared is
  the pre-work: the diff (`:106`) and the intent (`:120`) are prepared once for the whole batch,
  and per-agent failures are isolated (`:129-142`). Error isolation is real; parallelism is not.
  **Consequences the plan carries, none of which change a criterion:**
  1. **AC-35 is unaffected and was written correctly.** It requires "a record with four measured
     numbers per run", explicitly *"із явною згадкою, що співвідношення не зобов'язане бути 3×"*.
     Sequential execution is one more true reason the ratio is not 3×, and Step 12's ledger row
     says so in one line rather than pretending.
  2. **AC-24 still holds.** Every `agent_runs` row is created *before* the response returns
     (`service.ts:114-137`), so all N columns read `running` from the first render regardless of
     which one the executor is actually working on. The SSE fan-out is real: `RunLogger` is
     constructed over **every** queued run id (`run-executor.ts:64-69`).
  3. **Nothing in this plan fixes it.** § Out of scope forbids changing the execution model and
     AC-34 forbids the file appearing in the diff at all. Reported, not touched.
  Returned to `spec-creator` as two false rows; the same two rows are false in
  `reference/lessons/kickoff/L07A.md` § "Що вже є в коді".

### Unverifiable as written

- **AC-30's `How it is checked` cannot be executed by an e2e flow.** The cell says
  *"e2e `11-multi-agent-review.flow.json`: запуск → перехід геть → повернення"*. `запуск` means
  starting a multi-agent run from the browser, and `e2e/CLAUDE.md` § Conventions is explicit:
  *"Flows only touch read-only seeded data … so no step can trigger a model call"*, and the
  hermetic stack has no provider key. A flow that presses the start button either spends money
  or produces three `failed` columns whose content is a network error — neither is deterministic,
  and the cell's own closing assertion ("нуль нових `agent_runs`") contradicts the run it just
  asked for.
  **Reading taken:** the criterion's obligation is *"КОЛИ рецензент повертається на сторінку …
  застосунок повинен показати ОСТАННІЙ мультизапуск і кнопку `Start New Review`"* — it says
  nothing about who started that run. Step 10's flow uses AC-36's **seeded** multi-agent run as
  the "already ran" state, navigates away, returns, and asserts the columns and
  `Start New Review` are there and that no new run was created. Same obligation, executable,
  deterministic. The wording that would make the cell checkable: replace "запуск" with "засіяний
  мультизапуск (AC-36)".

### Ambiguities, each with the reading taken

- **AC-09 — "404 повинен означати тільки це".** `GET /pulls/:id/multi-agent` can 404 for two
  reasons: the pull request does not exist, or it has no multi-agent run. Both are 404 in this
  codebase (`NotFoundError`, `platform/errors.ts`). **Reading:** the two are distinguished by
  their **code and message**, not by their status — `no_multi_agent_run` for the criterion's
  case, `Pull request not found` for the other, on the precedent of
  `modules/brief/routes.ts:39`. Step 11's integration case asserts the code, not just the status.

- **AC-10 — "другим детермінованим ключем".** `multi_agent_runs` carries only
  `id · workspace_id · pr_id · ran_at` (`schema/runs.ts:47-56`), and § Non-functional
  requirements caps this work at **one** new column. **Reading:** the second key is
  `id DESC`. `id` is `defaultRandom()`, so it is not chronological — but AC-10's own check asks
  only that two rows written in one transaction produce *"однаковий результат при повторних
  читаннях"*, which `id DESC` guarantees absolutely. A `serial seq` column would be a second new
  column and would need its own justification the NFR table does not give it.

- **AC-23 / § Simplicity review §5 — where the estimate is computed.** §5 says "computed in the
  multi-agent service", and the caller's brief says the source is the existing
  `GET /pulls/:id/runs`. Those are the *source* and the *place*, not two designs. But
  `GET /pulls/:id/multi-agent` 404s until the first run exists (AC-09), so the estimate cannot
  ride on it — and AC-22/AC-23 both name `multi-agent.it.test.ts` as a lane, which only a server
  route can satisfy. **Reading:** one extra read route,
  `GET /pulls/:id/multi-agent/estimate`, in the same module, returning **one entry per agent in
  the workspace** with `runs_sampled`, `avg_duration_ms` and `avg_cost_usd` (both nullable). The
  picker sums the ticked ones client-side; per-agent nulls are what makes AC-22's "no data yet"
  per-agent rather than a single blanket message. No query parameters — parsing an `agentIds`
  list into a cache key buys nothing when the whole list is ten rows.

- **AC-33 — "рівно один новий пункт `NAV`".** `SHORTCUTS` (`nav.ts:73-83`) is a different
  export from `NAV`, and every existing `gKey` has a row in it. **Reading:** Step 9 adds one
  `NAV` item **and** its `SHORTCUTS` row (`g m`), because a `gKey` that the palette does not
  document is a half-shipped shortcut. This is stated here so `plan-verifier` does not read the
  second line as scope creep. `m` is free — today's `gKey`s are `p`, `s`, `a`, `c` and `,`.

### Gaps closed by decision

- **Where the route lives, and how `RunTraceDrawer` is reached.** The spec leaves this open
  (§ Design analysis, last bullet) and names the risk: *"Reusing `RunTraceDrawer` from a new
  route drags PR-page internals into a shared location"*. Three options were weighed against the
  ownership list, which does **not** contain `client/src/components/**` — so creating a shared
  home there is itself a boundary breach.
  **Decision: one new route at `client/src/app/repos/[repoId]/multi-agent/page.tsx`, keyed by
  `?pr=<number>`, importing `RunTraceDrawer` and `MultiAgentPicker` from the PR route's
  `_components/` by relative path. Nothing is promoted and nothing under
  `client/src/components/` is touched.** Reasons: `activeKeyFor` (`components/app-shell/
  helpers.ts:28`) already maps any path containing `/multi-agent` to the key `multi-agent`, and
  `shell.json:26` already carries its label — the shell was built for this href. `nav.ts` can
  template `:repoId` and nothing else (`resolveHref`, `nav.ts:85-88`), so a PR-scoped route
  could not be a nav destination, while a repo-scoped one can and gives the landing state a repo
  whose pulls `usePulls(repoId)` already lists. The cost is two cross-route imports; the
  alternative cost is moving a shipped six-component drawer that the PR page depends on, on the
  same branch as a new feature. Reversible: if `architecture-reviewer` rejects the cross-route
  import, promoting the drawer is a mechanical move plus one import line in
  `pulls/[number]/page.tsx:18` — but it is a boundary breach against the spec's file list and is
  therefore a **deviation to report, not a fix to apply**.

- **Who writes the `multi_agent_runs` row.** `no-cross-module-import` is `severity: 'warn'`
  (`.dependency-cruiser-onion.cjs:96`), so a reach from `modules/reviews` into
  `modules/multi-agent` would exit 0 and still be wrong. The brokered alternative
  (`container.multiAgent`, on the `BlastApi` pattern of `container.ts:227`) costs an edit to
  `server/src/platform/container.ts`, which the spec's own table calls
  *"shared, append-only"* between the two streams — i.e. a merge-conflict surface with B.
  **Decision: the write lives in `modules/reviews/repository/run.repo.ts` (already ours), the
  read lives in `modules/multi-agent/repository.ts`.** One table, one writer, one reader, no
  container edit, no cross-module import, no `arch:check` warning. The trade-off is stated out
  loud: `multi_agent_runs` is conceptually the multi-agent module's aggregate, and the module
  that creates `agent_runs` is writing it. It is the same module that must set
  `agent_runs.multi_agent_run_id` in the same insert, so the alternative splits one write across
  two modules to satisfy a naming intuition.

- **The similarity rule is built here, not integrated.** § Open questions §1 already settles
  that nothing in the tree implements it; I re-checked the two near-neighbours it names —
  `helpers.ts:263,279` in `modules/conventions` normalises **convention rules**, and
  `reviewer-core/src/review/reduce.ts:43-55` concatenates findings with no dedupe. **Decision,
  bounded by AC-15 … AC-17 and by the zero-model-call limit:** two findings join the same group
  when they are in the same `file`, their line ranges overlap or sit within
  `GROUP_LINE_WINDOW` lines of each other, **and** the Jaccard similarity of their normalised
  title token sets is at least `GROUP_TITLE_SIMILARITY`. Grouping is the transitive closure of
  that relation (union-find), which is what makes "exactly one group per finding" (AC-16) a
  property rather than a hope. Both constants live in
  `server/src/modules/multi-agent/constants.ts`. The function **sorts its own inputs** by
  `(file, start_line, id)` before grouping — `server/INSIGHTS.md` 2026-08-30 records that
  `getPrFiles` returns planner order, and a pure function whose determinism is load-bearing
  (AC-17) may not inherit ordering from a query it does not own.

- **The conflict rule (AC-18, AC-19, AC-37).** A *place* is `(file, line window)`, the same
  window the grouper uses. For each place at least one agent flagged: `flaggers` are the agents
  with a finding there; `silent` are the agents whose column status is exactly `done` and who
  have no finding there. It is a conflict when `silent` is non-empty **or** the flaggers assigned
  two or more distinct severities. `takes` = one per flagger (`verdict` = its severity) plus one
  per silent `done` agent (`verdict: 'ignored'`). An agent whose run is `failed`, `cancelled` or
  `running` never produces a take, in either list (AC-19). AC-37's line is
  `agents_considered` (columns with status `done`) of `agent_count`, computed in the same pass.

- **The seed's convergence guard (AC-36).** `seed.ts:768-772` guards its existing single
  `agent_run` on *"this PR has no runs yet"*. After Step 10 that guard is false forever, so the
  new block **must carry its own guard** — on the absence of a `multi_agent_runs` row for the
  demo PR — or `pnpm db:seed` twice stops converging, which is exactly what AC-36 asks to run.

- **AC-22's integration case needs a PR that is not #482.** `seed.ts:783` gives PR #482 one
  `done` run with `durationMs: 8_420` and `costUsd: 0.0041`, so on a seeded database its estimate
  is never empty. The "no completed run" case belongs on one of `SEED_DEMO_PRS` (which get
  `pr_files` and commits but no runs) or on a PR created inside the test.

### Verified rather than assumed

- **Producer sweep for every contract this work touches — empty.** Run today:
  `grep -rn -e ': RunRequest = {' -e ': AgentColumn' -e ': MultiAgentRun' -e ': Conflict' -e ': ConflictTake' -e ': AgentColumnFinding' server/src server/test client/src`
  → zero hits. `AgentColumn`, `MultiAgentRun`, `ConflictTake` have no consumer outside
  `vendor/shared` at all. `ReviewRunResponse` is used once
  (`client/src/lib/hooks/reviews.ts:161`) as a **type argument to `api.post<>`**, never as an
  object literal, so a `.nullish()` field added to it breaks nothing. **Step 2 therefore carries
  no fixture tail** — and this sentence is why its `pnpm typecheck` gate is honest rather than a
  gate it cannot pass (root `INSIGHTS.md` 2026-08-29).
- **Mirror state today.** `cmp -s` per file: `observability.ts` identical, `platform.ts`
  identical, `review-api.ts` identical. `diff -rq server/src/vendor/shared
  client/src/vendor/shared` reports three drifted files — `adapters.ts`,
  `contracts/eval-ci.ts`, `contracts/productionize.ts` — **none of them ours**. Never run the
  tree-wide diff as a gate; three pairs is what AC-32 covers plus the one this plan adds.
- **`llmCalls: 0` as a literal in a route log is an existing convention**, not an invention —
  `modules/brief/routes.ts:52` does exactly this, with a comment saying why. AC-08's check reads
  against it.
- **Integration files run the real seed.** `await seed(pg.handle.db)` appears in `beforeAll` of
  `agents-versions`, `blast`, `brief`, `conventions`, `integration`, `pulls-comments`,
  `pulls-detail-refresh` and others, so AC-36's seeded rows are assertable in
  `multi-agent.it.test.ts` and not only through the browser.
- **A throwing LLM provider already has a shape to copy** — `throwingLLM(id)` is defined
  **locally in three files** (`blast.it.test.ts:39`, `brief.it.test.ts:40`,
  `smart-diff.it.test.ts:40`). Copy the shape into the new file; do not promote it to
  `test/helpers/`, which would edit three shipped test files for no criterion.
  `MockLLMProvider` (`src/adapters/mocks.ts:58`) has **no** per-agent failure option and
  `src/adapters/mocks.ts` is **not** on this stream's file list — the per-agent failure of AC-13
  is produced by a test-local subclass, or by writing the `agent_runs` rows directly, which is
  what the read-path criteria actually need.
- **`Sidebar.tsx` lives under `client/src/vendor/ui/` and maps `NAV` itself** (`shell/
  Sidebar.tsx:45`), so one `nav.ts` entry needs no second UI file. AC-33's "no other file under
  `vendor/ui/`" is achievable exactly because of this.
- **Scaffold sweep, per root `INSIGHTS.md` 2026-08-02 and `client/INSIGHTS.md` 2026-08-29.**
  `client/messages/en/runs.json` already carries multi-agent copy. Two halves, treated
  differently:
  - **Accurate and reusable:** `viewTrace` ("View trace"), `column.noFindings`,
    `column.findingsCount`, `conflicts.title` ("Where agents disagree"), `conflicts.onlyConflicts`
    ("Show only conflicts"), `conflicts.didNotFlag` ("did not flag"), `tabs.noSummary`. These are
    the literal strings AC-29 asks for. Steps 7–8 **read** them; no edit.
  - **Dead and factually wrong:** the `page` namespace (`runs.json:110-134`) promises
    `"{count} agents · fan-out via p-queue · …"` — there is no p-queue in this repository — and
    `"Run all agents"` / `"this PR through every enabled agent in parallel"`, which is the exact
    behaviour this feature replaces with a subset picker. Nothing renders it today. It is
    **left untouched** because the spec's file list limits `client/messages/**` to *new copy
    keys only*, and it is raised in § Recommendations instead. This is the second sighting of
    the `client/INSIGHTS.md` 2026-08-29 class.
- **Today's counts, for the gates below.** `server/src/db/migrations/*.sql` → **16**.
  `server/test/*.it.test.ts` → **15**. `NAV` items carrying an `href` in `nav.ts` → **6**.
  `git diff --name-only lesson-07...HEAD | grep -c '^client/src/vendor/ui/'` → **0** (and
  `grep -c` **exits 1** on zero matches — never put one in an `&&` chain).

### Ordering constraints the spec implies but does not state

- **The migration is first**, and it is the single point of conflict with worktree B
  (§ Merge order). Worth recording: B's own spec asserts *"L07-A needs none [no migration], since
  `multi_agent_runs` already exists"* (`../dev-digest-l07b/specs/export-to-ci.md:416`). That is
  wrong — `agent_runs` has no parent column (`schema/runs.ts:7-36`) — and B plans a migration of
  its own on `ci_runs`. Both streams will generate one. A goes first, as A's spec says; B's
  premise for why the collision is cheap is false, and B should be told.
- **The nav entry comes after the route exists.** `nav.ts:26-30` states the rule in its own
  comment: *"a nav entry to a route that does not exist is worse than no entry"*.
- **Seed before the flow and before any lane that reads it.** Root `INSIGHTS.md` 2026-08-30:
  a step that *reads* data depends on the step that *writes* it. Step 11's AC-36 case
  `Depends: Step 10`, not the other way round. Every other case in Step 11 creates its own rows
  through the API and depends on Steps 3 and 5.
- **`pnpm db:migrate` is manual and does not run on boot** (root `CLAUDE.md` § Commands), and it
  is needed again on the integration database after each of merge-order steps 2 and 4.

---

## Constraints in force

| Constraint | Source | What it forbids here |
|---|---|---|
| SQL only in `repository.ts`, HTTP only in `routes.ts`, pure transforms in `helpers.ts`, literals in `constants.ts` | `server/CLAUDE.md` § Conventions | a Drizzle query in `modules/multi-agent/service.ts`; `GROUP_LINE_WINDOW` inline in `helpers.ts` |
| Dependencies come from `container`, never by importing a sibling module | `server/CLAUDE.md`; `onion-architecture` skill | `modules/multi-agent/**` importing `modules/reviews/**` — the PR lookup comes from `container.reviewRepo.getPull` (`container.ts:209`) |
| `no-cross-module-import` is `severity: 'warn'`, so `arch:check` **exits 0 on it** | root `INSIGHTS.md` 2026-08-22; `.dependency-cruiser-onion.cjs:96-98` | trusting the exit code — read the output; never append to `.dependency-cruiser-known-violations.json` |
| `routes-are-a-leaf`: only `modules/index.ts`, `app.ts` or the module's own barrel may import a `routes.ts` | `.dependency-cruiser-onion.cjs:66-75` | any inward import of the new `routes.ts` |
| A new module is `modules/<name>/routes.ts` plus **one appended line** in `modules/index.ts` | `server/CLAUDE.md`; `modules/index.ts:31-45`; `WORKING-ORDER.md` § Спільні файли | inserting the entry anywhere but the end of the list — the list is a merge surface with B |
| Every route opens with `getContext(container, req)`; every query is workspace-scoped | `server/CLAUDE.md` § Conventions | resolving a PR any way but `container.reviewRepo.getPull(workspaceId, prId)` |
| A Zod route schema can only ever answer 422, so a criterion naming another status moves the check into the service | `server/INSIGHTS.md` 2026-08-29; AC-02's own cell | validating the three mutually-exclusive `RunRequest` forms in the schema — AC-02's 400 and AC-03's 404 are `AppError`/`NotFoundError` from the service |
| A contract edit in `server/src/vendor/shared` requires the mirror edit in `client/src/vendor/shared`, diffed before committing | root `CLAUDE.md` § Gotchas; AC-32 | splitting the mirror across two steps or two commits |
| After editing an enum in `vendor/shared`, grep the other contract files for its **member names**, not the symbol | root `CLAUDE.md` § Gotchas | assuming an import search found every inline re-declaration of `AgentColumn.status` |
| `.default()` is optional on input and **required** on `z.infer`, so a contract edit owns the sweep of every literal it invalidates | root `INSIGHTS.md` 2026-08-29; spec § Risks | a `.default()` on `agentIds` — deliberately absent; the sweep was run and came back empty |
| Never run a whole-tree `diff -r` over `vendor/shared` | `scripts/pr-self-review-checks.sh:140-145`; three pairs already drift | a tree-wide mirror gate that fires forever on files this work never opens |
| `server/src/db/migrations/**` is generated; new migration = `pnpm db:generate`, applied manually | root + `server/CLAUDE.md` § Do not touch | hand-writing SQL; assuming boot migrates |
| Reading the generated `.sql` is a gate that can fail, not documentation | `server/INSIGHTS.md` 2026-08-30 | committing a `db:generate` output nobody applied |
| A DB test carries the `*.it.test.ts` suffix | root `CLAUDE.md`; `TESTING.md` | putting the route cases in the unit lane |
| Each `.it.test.ts` file starts its **own** Postgres container; 15 today, 16 after | `server/INSIGHTS.md` 2026-08-28 + its 2026-08-29 correction | reading one unrelated red as a regression — re-run the reduced lane **five times** before concluding |
| `pnpm typecheck` does not compile `server/test/**` | `server/INSIGHTS.md` 2026-08-29 | treating a green server `tsc` as evidence the new fixtures compile |
| `@fastify/rate-limit` is not registered under `NODE_ENV=test` | `server/INSIGHTS.md` 2026-08-30; `app.ts:95` | an integration case about the run trigger's limit — the spec's own NFR table already excludes it |
| No `fetch` in a component; a new endpoint means a new hook in `client/src/lib/hooks/`, exported through `hooks/index.ts` | `client/CLAUDE.md` § Conventions | the results view calling `/pulls/:id/multi-agent` |
| No hardcoded copy — strings live in `client/messages/en/` | `client/CLAUDE.md` § Map | inline English in the empty state, the estimate label or `did not flag` |
| Only `<Name>.tsx` and `index.ts` are mandatory in a component folder | `client/docs/component-anatomy.md:20`; `client/INSIGHTS.md` 2026-08-05 | empty `constants.ts` / `helpers.ts` to satisfy the wider rule |
| `@testing-library/user-event` is **not installed** | `client/INSIGHTS.md` 2026-08-22 | `userEvent` anywhere — drive interaction with `fireEvent` |
| `noUncheckedIndexedAccess` is on in `client/` and `pnpm test` cannot see it | `client/INSIGHTS.md` 2026-08-30 | calling a client step green on `pnpm test` alone |
| A rule living in a callback the page hands down is only visible to a **page** test | `client/INSIGHTS.md` 2026-08-30 | proving AC-25's drawer wiring with a grep |
| `client/src/vendor/ui/**` is do-not-touch **except** `nav.ts`, granted for L07 | root `CLAUDE.md`; spec § Owned directories and files; AC-33 | any second file under `vendor/ui/` — including `Sidebar.tsx`, which needs none |
| `defaultNow()` is the transaction's timestamp | root `CLAUDE.md` § Gotchas | ordering the latest multi-agent run by `ran_at` alone — AC-10 is this rule as a criterion |
| After editing `seed.ts`, grep `e2e/specs/*.json` for the changed literals | root `CLAUDE.md` § Gotchas | a seed change in one commit and the flow that asserts it in another |
| `wait --text` / `wait --url` **are** the assertions; the AI `chat` command is forbidden; flows touch read-only seeded data only | `e2e/CLAUDE.md` § Conventions | a flow step that could trigger a model call — see AC-30 above |
| `test-writer` does not write e2e flows — `e2e/specs/*.flow.json` are data | `.claude/agents/test-writer.md` § description | leaving the flow to Step 11 |
| The design lives at `reference/devdigest-design/` and is never committed or pointed at from a tracked file | user memory; `reference/devdigest-design/CLAUDE.md` | quoting an artboard path into a repo file |

---

## Implementation plan

### Gate discipline

Inherited from `specs/plans/L05-pr-brief.md` § Gate discipline, where each rule was paid for
once:

1. **A step whose `Verify` runs a whole-package gate must own, in its `Files:`, everything that
   gate covers.** In this plan no step ships a known red — the producer sweep at Step 2 came back
   empty, which is what makes every gate below honest.
2. **A shared-contract edit owns the producer sweep in the same step**, before the field is
   written, not after the gate goes red.
3. **Read `pnpm arch:check`'s output, never its exit code.** The rule that would catch
   `modules/multi-agent → modules/reviews` is `warn`, and depcruise exits 0 on warnings.
4. **Never run a whole-tree `diff -r` over `vendor/shared`.** Per-file `cmp -s`, three pairs.

Three more, specific to this run:

5. **Every gate below carrying a number was executed against the tree today**, and the current
   value is written beside it. A gate whose arithmetic is "N today, N+1 after" says both numbers.
6. **The implementer writes no tests** (`reference/lessons/kickoff/L07A.md` § Дисципліна
   прогону). Every `Verify:` in Steps 1–10 therefore passes **without** any file from Step 11.
   Where a criterion's only real proof is a test, the step says so and points at Step 11.
7. **A step that reads data depends on the step that writes it** (root `INSIGHTS.md`
   2026-08-30). Checked in both directions for every lane in Step 11.

---

### Step 1 — `agent_runs` learns which multi-agent run it belongs to   ·   package: server

Files:    `server/src/db/schema/runs.ts` (edit — `agentRuns`) ·
          `server/src/db/migrations/*.sql` + `meta/` (new, **generated**)
Skills:   drizzle-orm-patterns, postgresql-table-design
Do:       One column on `agentRuns`: `multiAgentRunId: uuid('multi_agent_run_id')
          .references(() => multiAgentRuns.id, { onDelete: 'set null' })` — **nullable**, no
          `.notNull()`, mirroring how `agentId` is declared at `schema/runs.ts:13`. `set null`
          rather than `cascade`: deleting a parent must not delete the child runs whose traces
          and findings are the durable record. `multiAgentRuns` is declared *after* `agentRuns`
          in the same file (`:47`), so the reference is a lazy arrow — it already is for
          `agents` and `pullRequests`. Then `pnpm db:generate`, **read the emitted SQL**, then
          `pnpm db:migrate`. Nothing else in this step: no table, no index, no second column.
Verify:   `cd server && pnpm db:generate` → `ls src/db/migrations/*.sql | wc -l` goes **16 → 17**
          (16 today) ·
          `grep -c 'CREATE TABLE' src/db/migrations/<new>.sql` → **0** (AC-14: this work adds no
          table) ·
          `grep -ci 'not null' src/db/migrations/<new>.sql` → **0** (AC-06) ·
          the file contains exactly one `ALTER TABLE "agent_runs" ADD COLUMN` and no commented-out
          placeholder — drizzle-kit emits one when it cannot name a constraint
          (`server/INSIGHTS.md` 2026-08-30); if it does, complete it visibly and say so ·
          `cd server && pnpm db:migrate` exits 0 ·
          `cd server && pnpm typecheck`
Covers:   AC-06, AC-14 (the "no new tables" half)
Depends:  none
Commit:   `feat(db): agent_runs learns which multi-agent run it belongs to`

---

### Step 2 — the contracts, three mirrored pairs   ·   package: server + client

Files:    `server/src/vendor/shared/contracts/platform.ts` (edit) ·
          `client/src/vendor/shared/contracts/platform.ts` (edit) ·
          `server/src/vendor/shared/contracts/observability.ts` (edit) ·
          `client/src/vendor/shared/contracts/observability.ts` (edit) ·
          `server/src/vendor/shared/contracts/review-api.ts` (edit) ·
          `client/src/vendor/shared/contracts/review-api.ts` (edit)
Skills:   zod, typescript-expert
Do:       **The sweep first**, per Gate discipline 2 — it is recorded in § Verified rather than
          assumed and came back empty, so nothing outside these six files changes. Then:

          `platform.ts` § `RunRequest` (`:320-324`) gains
          `agentIds: z.array(z.string()).optional()`. **No `.default()`** — a defaulted field is
          optional on input and required on `z.infer`, which breaks every literal in both
          packages (root `INSIGHTS.md` 2026-08-29; the spec's § Risks names this too). The
          object stays three optional fields; mutual exclusion is the **service's** job
          (AC-02), because a route schema can only answer 422 (`server/INSIGHTS.md` 2026-08-29)
          and AC-02 names 400.

          `review-api.ts` § `ReviewRunResponse` (`:64-69`) gains
          `multi_agent_run_id: z.string().nullish()` — `nullish`, not required, because the
          single-agent path must keep answering without it (AC-07's second sentence). See
          § Requirements review for why this file is edited at all.

          `observability.ts`:
          - the header comment's promise of `POST /pulls/:id/multi-agent-run` (`:9`) and the
            same claim on `MultiAgentRun` (`:74`) are corrected to name
            `POST /pulls/:id/review` and `GET /pulls/:id/multi-agent` — § Open questions §7
            says the stale comment is fixed as part of this edit;
          - `AgentColumn.status` (`:41`) widens from three values to
            `z.enum(['running', 'done', 'failed', 'cancelled'])` (AC-12). **Then grep the other
            contract files for the member names**, not for `AgentColumn` — shapes are re-declared
            inline in this tree (root `CLAUDE.md` § Gotchas);
          - `AgentColumn` gains `error: z.string().nullable()` (AC-12, carrying
            `agent_runs.error`);
          - `AgentColumnFinding` gains `end_line`, `rationale`, `suggestion` (nullable) and
            `confidence` — AC-27 needs confidence and the suggested fix on the card, and today
            the shape carries neither (`:23-31`);
          - new `FindingGroup`: `{ key, file, start_line, title, severity, members:
            FindingGroupMember[] }` where a member is
            `{ finding_id, agent_id, agent_name, run_id }` **plus the original
            `title`/`rationale`/`suggestion`/`severity`/`confidence` verbatim** — AC-15 requires
            the originals to be reachable and unaltered, so they are carried, not referenced;
          - `MultiAgentRun` gains `groups: z.array(FindingGroup)`, `agents_considered`
            (`z.number().int()`, the count of `done` columns) and keeps `agent_count` as the
            total — the two numbers AC-37 renders as "2 of 3";
          - new `RunEstimate`: `{ agent_id, agent_name, enabled, runs_sampled: z.number().int(),
            avg_duration_ms: z.number().int().nullable(), avg_cost_usd: z.number().nullable() }`,
            and `RunEstimateResponse = z.array(RunEstimate)`. `null` means "no completed run to
            average" (AC-22) and is deliberately distinct from `0`, which is the product's
            existing null-vs-zero convention for cost (root `INSIGHTS.md` 2026-08-02;
            `schema/runs.ts:22-27`).
          - `AgentStats` and `CuratorResult` are **not touched** (§ Simplicity review §8).

          Both copies byte-identical. `vendor/shared/index.ts` already re-exports all three
          files (`index.ts:26`) — no barrel edit is expected in either package.
Verify:   `cmp -s server/src/vendor/shared/contracts/platform.ts client/src/vendor/shared/contracts/platform.ts` ·
          `cmp -s server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts` ·
          `cmp -s server/src/vendor/shared/contracts/review-api.ts client/src/vendor/shared/contracts/review-api.ts`
          — all three silent (all three are identical **today**, so a failure is this step's) ·
          `cd server && pnpm typecheck` · `cd client && pnpm typecheck && pnpm test` ·
          `grep -c 'default(' server/src/vendor/shared/contracts/platform.ts` unchanged from its
          pre-edit value — the widening adds no default
Covers:   AC-01 (the contract half), AC-07 (the contract half), AC-12 (the contract half),
          AC-15 (the shape half), AC-27 (the shape half), AC-32, AC-37 (the shape half)
Depends:  none
Commit:   `feat(shared): a run request that names a set, and columns that can fail`

---

### Step 3 — the write path: a named set, and the run that owns it   ·   package: server

Files:    `server/src/modules/reviews/service.ts` (edit — `resolveTargets`, `runReview`) ·
          `server/src/modules/reviews/repository/run.repo.ts` (edit — `createAgentRun`, new
          `createMultiAgentRun`) ·
          `server/src/modules/reviews/repository.ts` (edit — compose the new method) ·
          `server/src/modules/reviews/routes.ts` (edit — pass `agentIds`, return the id)
Skills:   onion-architecture, fastify-best-practices, zod
Do:       `resolveTargets` (`service.ts:46-57`) becomes a three-form resolver, and **counts the
          forms before it does anything**: `[agentId, agentIds, all].filter(present).length !== 1`
          → `AppError('invalid_run_request', …, 400)`, and `agentIds: []` is not "present" — the
          empty array is one of AC-02's four rejected cases. `agentIds` resolves through
          `this.agents.getById(workspaceId, id)` **for every id, before any run row exists**; a
          single miss throws `NotFoundError` (404) and no `agent_runs` row is written (AC-03 —
          this is why resolution happens in `resolveTargets`, upstream of `runReview`, not
          inside the creation loop). The `{ agentId }` and `{ all: true }` branches keep their
          exact current behaviour (AC-01).

          `runReview` (`service.ts:103-137`) takes a new `multiAgent: boolean` argument and,
          when it is true, calls `this.repo.createMultiAgentRun({ workspaceId, prId })` **once**
          before the loop, then passes the returned id into every `createAgentRun` call. For
          `{ agentId }` it is not called and the column stays `null` (AC-05). The return type
          gains `multi_agent_run_id: string | null`. Nothing else about the ordering changes: the
          rows still exist before the response returns (`:114-137`), which is what lets the
          browser subscribe immediately.

          `run.repo.ts`: `createAgentRun` takes an optional `multiAgentRunId` and inserts it;
          new `createMultiAgentRun` inserts one `multi_agent_runs` row and returns its id. This
          is the **only** writer of that table — see § Gaps closed by decision.

          `routes.ts:29-45`: forward `body.agentIds` alongside the two existing fields (same
          conditional-spread shape already there), set `multiAgent` from the form, and return
          `multi_agent_run_id` next to `runs`.

          `run-executor.ts` is **read, never modified** (AC-34). It is unaware of the parent row
          and does not need to be.
Verify:   `cd server && pnpm typecheck` ·
          `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — the existing unit lane
          stays green ·
          `cd server && pnpm arch:check` — **read the output; empty output is the pass** ·
          `grep -c 'agentIds' server/src/modules/reviews/service.ts` → at least **2** (the
          parameter type and the branch); arithmetic stated rather than pinned, because
          `grep -c` counts lines and a destructure may share one ·
          `grep -n 'createMultiAgentRun' server/src/modules/reviews/repository/run.repo.ts server/src/modules/reviews/repository.ts server/src/modules/reviews/service.ts`
          → one definition, one composition, one call site ·
          `git diff --name-only lesson-07...HEAD | grep -c 'run-executor.ts'` → **0** (exits 1;
          run it alone)
Covers:   AC-01, AC-02, AC-03, AC-04, AC-05, AC-07
Depends:  Step 1, Step 2
Commit:   `feat(reviews): a review request can name a set, and the set becomes one run`

---

### Step 4 — the rules, with no I/O: grouping, conflicts, estimate   ·   package: server

Files:    `server/src/modules/multi-agent/constants.ts` (new) ·
          `server/src/modules/multi-agent/helpers.ts` (new)
Skills:   onion-architecture, typescript-expert, zod
Do:       Every decision this feature makes without a database, a clock or a network. No import
          of Drizzle, Fastify or the container in either file — that is what makes the unit lane
          the right gate and `arch:check` meaningful.

          `constants.ts`: `GROUP_LINE_WINDOW`, `GROUP_TITLE_SIMILARITY`, `ESTIMATE_MAX_SAMPLES`,
          and the `TERTIARY` stopword list the title normaliser drops. Numbers live here, not
          inline (`server/CLAUDE.md` § Conventions).

          `helpers.ts`, all pure:
          - `normaliseTitle(title): string[]` — lowercase, non-alphanumerics to spaces, collapse,
            drop stopwords, return sorted unique tokens. No model, no embedding (AC-17).
          - `groupFindings(findings): FindingGroup[]` — sorts its inputs by
            `(file, start_line, id)` **itself** (see § Gaps closed by decision), then union-find
            over "same file ∧ line ranges within `GROUP_LINE_WINDOW` ∧ Jaccard ≥
            `GROUP_TITLE_SIMILARITY`". Returns groups in input order; every member carries its
            original `title`, `rationale`, `suggestion`, `severity`, `confidence`, `agent_id`,
            `agent_name`, `run_id` and `finding_id` **unmodified** — nothing is rewritten,
            shortened or merged (AC-15). The union of the groups is the input set and their
            pairwise intersections are empty, by construction (AC-16); a single finding is a
            valid group of one.
          - `detectConflicts(groups, columns): { conflicts, agents_considered }` — the rule in
            § Gaps closed by decision. An agent contributes a take only when its column status is
            exactly `done` (AC-19), and `agents_considered` is the count of such columns (AC-37).
          - `estimateFor(runs): RunEstimate['runs_sampled' | 'avg_duration_ms' | 'avg_cost_usd']`
            — averages the **completed** (`status === 'done'`) runs handed to it, over at most
            `ESTIMATE_MAX_SAMPLES`, and returns `null` for a mean it has no sample for. It never
            returns `0` for "unknown" (AC-22, AC-23).
Verify:   `cd server && pnpm typecheck` ·
          `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — green, with no new
          test files (Step 11 writes them) ·
          `cd server && pnpm arch:check` — read the output ·
          `grep -rn "drizzle-orm\|fastify\|container" server/src/modules/multi-agent/helpers.ts server/src/modules/multi-agent/constants.ts`
          → **no output**: these two files are the zero-I/O half of the module
Covers:   AC-15, AC-16, AC-17, AC-18, AC-19 (the rule half), AC-23 (the arithmetic half),
          AC-37 (the count)
Depends:  Step 2
Commit:   `feat(multi-agent): the grouping rule, the conflict rule, and the estimate`

---

### Step 5 — the module: one repository, one service, two reads   ·   package: server

Files:    `server/src/modules/multi-agent/repository.ts` (new) ·
          `server/src/modules/multi-agent/service.ts` (new) ·
          `server/src/modules/multi-agent/routes.ts` (new) ·
          `server/src/modules/index.ts` (edit — one import, one **appended** entry)
Skills:   onion-architecture, fastify-best-practices, drizzle-orm-patterns, zod
Do:       `repository.ts` is the only SQL in this module and it **reads only**:
          `latestForPull(workspaceId, prId)` selects from `multi_agent_runs` ordered
          `desc(ranAt), desc(id)` — the second key is the whole of AC-10 and the reason is
          `defaultNow()` being the transaction's timestamp (root `CLAUDE.md` § Gotchas);
          `runsFor(multiAgentRunId)` joins `agent_runs` left-join `agents` for the columns, in a
          stable order (`agent_runs.ran_at`, then `agent_runs.id` — same reasoning, and AC-11
          asks for the order to survive a second GET); `findingsFor(runIds)` joins
          `reviews` → `findings` and carries `reviews.agent_id` / `reviews.run_id` through, which
          is the attribution that already exists (`schema/reviews.ts:28-30`) and that this work
          does not change; `completedRunsForPull(workspaceId, prId)` and
          `recentCompletedRunsForAgent(workspaceId, agentId)` feed the estimate — the PR's own
          history first, the workspace's recent runs for that agent as the fallback
          (§ Simplicity review §5). It writes nothing, ever (AC-14).

          `service.ts` composes: repository rows → columns (status straight from
          `agent_runs.status`, `error` from `agent_runs.error`, `verdict`/`score`/`summary` from
          the run's `reviews` row, `duration_ms`/`cost_usd` from the run) → `groupFindings` →
          `detectConflicts` → the `MultiAgentRun` object. Zero model calls; it does not have an
          `LLMProvider` in scope at all. `read` returns `undefined` when the PR has no parent
          row. `estimate(workspaceId, prId)` maps every agent in the workspace through
          `estimateFor`. The PR itself is resolved through
          `container.reviewRepo.getPull(workspaceId, prId)` — the container, never a reach into
          `modules/reviews` (AC-08's workspace scoping and the onion rule in one line).

          `routes.ts`, on the shape of `modules/brief/routes.ts:29-60`:
          - `GET /pulls/:id/multi-agent` → 200 `MultiAgentRun`, or `NotFoundError` with the code
            `no_multi_agent_run` when the PR has none (AC-09; the "PR does not exist" 404 keeps
            its own message — see § Ambiguities). The completion log line carries
            `llmCalls: 0` **as a literal**, exactly as `brief/routes.ts:52` does and for the same
            reason: it is the line AC-08 is read against, and the day someone adds a model call
            here it becomes a lie a reviewer catches by reading one route.
          - `GET /pulls/:id/multi-agent/estimate` → 200 `RunEstimateResponse`.
          - Neither carries a rate-limit override: they spend queries, not money — the same
            reasoning `GET /pulls/:id/brief` records. The global limit still applies.
          The service is constructed in the route file rather than brokered on `Container`,
          which is what `modules/brief` and `modules/smart-diff` do and for the stated reason:
          nothing else consumes it. It also keeps `platform/container.ts` — a file the spec calls
          append-only and shared with worktree B — out of this diff entirely.

          `modules/index.ts`: one import and one entry, **appended at the end** of the map
          (`WORKING-ORDER.md` § Спільні файли — B appends its own there after the merge).
Verify:   `cd server && pnpm typecheck` ·
          `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` ·
          `cd server && pnpm arch:check` — **read the output; empty is the pass**. This is the
          gate for the two rules that matter here, and both are silent on the exit code:
          `no-cross-module-import` is `warn`, and `routes-are-a-leaf` would fire if anything
          imported the new `routes.ts` ·
          `grep -rn "modules/reviews" server/src/modules/multi-agent/` → **no output** ·
          `grep -c "llmCalls: 0" server/src/modules/multi-agent/routes.ts` → **1** ·
          `grep -rn "insert(\|update(\|delete(" server/src/modules/multi-agent/repository.ts`
          → **no output** (AC-14: the read path writes nothing) ·
          `grep -c "multiAgent" server/src/modules/index.ts` → **2** (one import line, one map
          entry) ·
          `cd server && pnpm dev` (or `./scripts/dev.sh`) answers `GET /pulls/<id>/multi-agent`
          with 404 `no_multi_agent_run` on a PR that has none — the cheapest proof the route is
          registered, before any test exists
Covers:   AC-08, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14, AC-19 (the take-suppression half),
          AC-22 (the server half), AC-23 (the server half), AC-37
Depends:  Step 3, Step 4
Commit:   `feat(multi-agent): the latest run of a PR, as columns, groups and conflicts`

---

### Step 6 — the client's data path and its copy   ·   package: client

Files:    `client/src/lib/hooks/multi-agent.ts` (new) ·
          `client/src/lib/hooks/index.ts` (edit — one export line) ·
          `client/messages/en/multiAgent.json` (new)
Skills:   react-best-practices, frontend-architecture, typescript-expert
Do:       One hook file over the three endpoints, shaped exactly like `lib/hooks/brief.ts`:
          `useMultiAgentRun(prId)` over `GET /pulls/:id/multi-agent` (a 404 is a **state**, not
          an error toast — AC-09 and AC-30 both land on it, so `retry: false` and the caller
          reads `isError` as "no run yet"); `useRunEstimate(prId)` over
          `GET /pulls/:id/multi-agent/estimate`; `useStartMultiAgentRun()` posting
          `{ agentIds }` to `POST /pulls/:id/review` and returning `ReviewRunResponse`.

          **No `refetchInterval` on any of the three.** `usePrRuns` and `usePrActiveRuns`
          (`hooks/reviews.ts:33,46`) poll, and copying that here is what AC-24 forbids: column
          status comes from `useRunEvents(runIds)` (`hooks/reviews.ts:201-219`), and
          `useMultiAgentRun` is refetched once, when the streams end. There are **4**
          `refetchInterval`/`setInterval` occurrences in `client/src` today; this step adds none.

          Types come from `@devdigest/shared`, never hand-written (`component-anatomy.md`
          § A data hook).

          `multiAgent.json` carries only what does not already exist: the picker's labels
          (`Run multi-agent review ({count})`, the estimate's qualifier word — AC-23 requires the
          label to *say* it is an estimate — and the "no data yet" string of AC-22), the two mode
          names, `Start New Review`, the two honest-stub messages naming L06 and L07's memory
          half (AC-28), the AC-37 line, and the empty states of AC-31. The accurate keys already
          in `runs.json` are **read, not duplicated**: `viewTrace`, `column.noFindings`,
          `column.findingsCount`, `conflicts.title`, `conflicts.onlyConflicts`,
          `conflicts.didNotFlag`, `tabs.noSummary`. `runs.json` § `page` is left untouched — see
          § Recommendations.
Verify:   `grep -n 'multi-agent' client/src/lib/hooks/index.ts` → the new export line ·
          `grep -rn 'refetchInterval\|setInterval' client/src/lib/hooks/multi-agent.ts` →
          **no output** ·
          `cd client && pnpm typecheck && pnpm test`
Covers:   none — enabling work for AC-20 … AC-31
Depends:  Step 2 (types), Step 5 (the routes it calls)
Commit:   `feat(web): the multi-agent hooks, and the copy the screens need`

---

### Step 7 — Configure run: one picker, two mount points   ·   package: client

Files:    `client/src/app/repos/[repoId]/pulls/[number]/_components/MultiAgentPicker/**` (new:
          `MultiAgentPicker.tsx`, `styles.ts`, `constants.ts`, `helpers.ts`, `index.ts`) ·
          `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
          (edit — mount it)
Skills:   **design-reference first, before any code**, then frontend-architecture,
          react-best-practices, next-best-practices
Do:       Read the design before writing: screen key `multi-agent-review`, and note what
          § Design analysis already establishes — **`Configure run` has no artboard at all**, so
          every decision here is derived and the spec's decisions are the ones to follow, not an
          invented layout.

          One component, two mount points (§ Open questions §2). Props:
          `{ prId: string | null; prControl?: React.ReactNode }`. It renders a checkbox per agent
          from `useAgents()` — **every** agent, with a `disabled` marker on the ones whose
          `enabled` is false, which is exactly what `RunReviewDropdown.tsx:52-60` already does
          and for the same reason (AC-20; the seed has five, three enabled,
          `seed.ts:565-623`). Beside each, its estimate from `useRunEstimate(prId)`: duration and
          cost when `runs_sampled > 0`, and the "no data yet" string when the averages are `null`
          — never a zero and never a dash (AC-22). A total line above the button sums the ticked
          agents and carries the qualifier word that marks it an estimate (AC-23). The button
          reads `Run multi-agent review (N)` with the live count, and is `disabled` with zero
          ticked — and **the mutation is not called** in that state, which is the half of AC-21 a
          `disabled` attribute alone does not prove. An empty agent list renders the empty state
          with a CTA to `/agents` (AC-31).

          On success it navigates to `/repos/${repoId}/multi-agent?pr=${number}` — the results
          route of Step 8. `repoId`/`number` come from `useParams()` inside the component, so
          `OverviewTab`'s props do not change shape; the only edit to `OverviewTab.tsx` is the
          mount.

          Interaction is driven by `fireEvent` in the tests of Step 11 —
          `@testing-library/user-event` is not installed (`client/INSIGHTS.md` 2026-08-22) — so
          the checkboxes must be real inputs with accessible names, not divs with click handlers.
Verify:   `cd client && pnpm typecheck && pnpm test` — the typecheck is the gate that matters
          here, because `noUncheckedIndexedAccess` is on and `pnpm test` cannot see it
          (`client/INSIGHTS.md` 2026-08-30) ·
          `grep -rn 'useTranslations' client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/MultiAgentPicker/`
          → present; `grep -rnE '>[A-Z][a-z]+ [a-z]' …/MultiAgentPicker/MultiAgentPicker.tsx` →
          no hardcoded English sentence ·
          `git diff --name-only lesson-07...HEAD | grep -c '^client/src/vendor/ui/'` → still
          **0** at this step (1 only after Step 9; exits 1 on zero, run it alone)
Covers:   AC-20, AC-21, AC-22 (the client half), AC-23 (the client half), AC-31 (the picker's
          half)
Depends:  Step 6
Commit:   `feat(web): pick the agents, see what it will cost, start them in one action`

---

### Step 8 — the results route: two modes over one fetch   ·   package: client

Files:    `client/src/app/repos/[repoId]/multi-agent/page.tsx` (new) ·
          `client/src/app/repos/[repoId]/multi-agent/_components/ColumnsView/**` (new) ·
          `client/src/app/repos/[repoId]/multi-agent/_components/TabsDetailView/**` (new) ·
          `client/src/app/repos/[repoId]/multi-agent/_components/DisagreeBlock/**` (new)
Skills:   **design-reference first**, then frontend-architecture, react-best-practices,
          next-best-practices
Do:       Read the design first: artboards `ma-cols`, `ma-tabs`, `e-ma`. Carry across what is
          there and **do not** carry the mock's hardcoded `"fan-out via worktrees"` meta phrase
          (§ Design analysis says so explicitly), and render an unpriced model's cost by the
          product's null-vs-zero rule rather than as `$0.00`.

          `page.tsx` is the container and owns the data: it resolves `?pr=<number>` → `prId`
          through `usePulls(repoId)` exactly as `pulls/[number]/page.tsx:38-40` does, calls
          `useMultiAgentRun(prId)` **once**, and holds the mode in `React.useState`. Switching
          modes re-renders two presentational children over the same object and issues **no**
          second request (AC-26) — one container, two children, one toggle
          (§ Simplicity review §4). With no `?pr` it renders `MultiAgentPicker` with a PR control
          (a select over `usePulls(repoId)` — the cheapest possible control, § Simplicity
          review §7). With a `?pr` whose run 404s, it renders `MultiAgentPicker` with that PR
          fixed and the "no run yet" empty state; with no enabled agents at all, the `/agents`
          CTA (AC-31). With a run, it renders the results **and** `Start New Review`, which
          re-opens the picker — never an auto-start (AC-30).

          `ColumnsView` — one column per `AgentColumn`, header carrying the agent name, provider,
          model and a status chip. A `running` column shows **elapsed time and the chip only**;
          score, duration and cost stay empty until the run is terminal (§ Design analysis,
          decided 2026-08-30). A `failed` column carries `error` (AC-12) and the other columns
          still render their findings (AC-13). Each column has `View trace`, which opens the
          existing `RunTraceDrawer` — imported from
          `../../pulls/[number]/_components/RunTraceDrawer` — with **that column's** `run_id`
          (AC-25). Live status comes from `useRunEvents(runIds)` keyed per run, so one column's
          event changes one column (AC-24).

          **`LiveLogStream` is reused, and only through the drawer.** The brief asks for both
          primitives back (`kickoff/L07A.md`); `RunTraceDrawer` already renders `LiveLogStream`
          on its Live log tab (`RunTraceDrawer.tsx:10,102`), so `View trace` delivers the live
          log per column with no new code. **Do not add a log panel to the page** — a panel
          beside a `View trace` that opens the same stream renders it twice. `RunStatus`
          (`_components/RunStatus/RunStatus.tsx:38`), the PR page's own direct use of the
          primitive, is not touched and not imported here.

          `TabsDetailView` — one tab per agent, and a detail card per finding carrying
          `confidence`, the suggested fix, and Accept · Dismiss · Learn · `Turn into eval case`
          (AC-27). Accept and Dismiss go through the existing finding-action hook. **Learn and
          `Turn into eval case` do not call anything**: they render a visible, non-dismissable
          error naming the lesson that owns the endpoint — L07's memory half and L06 — in the
          honest-stub form L04 used for `get_blast_radius` (AC-28). Calling the route instead
          would be a 404/400 dressed as an outage; the failure has to *say* it is unbuilt. A card
          whose finding belongs to a group of more than one carries a badge naming the agents
          that flagged the same place, expanding to each member's original text **verbatim**
          (§ Design analysis, decided 2026-08-30 — a badge, not a third block; AC-15).

          `DisagreeBlock` — the `Where agents disagree` section over `conflicts`, with the
          `Show only conflicts` switch (AC-29) and the `did not flag` label on an `ignored` take.
          One line reports `agents_considered` of `agent_count` whenever they differ (AC-37).
          Its heading, switch label and `did not flag` string come from `runs.json`'s existing
          `conflicts` namespace.
Verify:   `cd client && pnpm typecheck && pnpm test` ·
          `grep -rn 'refetchInterval\|setInterval' client/src/app/repos/\[repoId\]/multi-agent/`
          → **no output** (AC-24) ·
          `grep -rn "fetch(\|api\.get\|api\.post" client/src/app/repos/\[repoId\]/multi-agent/`
          → **no output**: every call goes through a hook (`client/CLAUDE.md` § Conventions) ·
          `grep -rn "findings/.*learn\|eval" client/src/app/repos/\[repoId\]/multi-agent/_components/TabsDetailView/`
          → no request URL — the stubs must not call an endpoint (AC-28) ·
          `git diff --name-only lesson-07...HEAD | grep -cE '^(ci/|agent-runner/|reviewer-core/|mcp/)'`
          → **0** (exits 1 on zero; run it alone)
Covers:   AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30 (the client half), AC-31, AC-37
          (the rendering half)
Depends:  Step 6, Step 7
Commit:   `feat(web): the multi-agent results — columns, groups, and where the agents disagree`

---

### Step 9 — one nav entry, and nothing else under `vendor/ui/`   ·   package: client

Files:    `client/src/vendor/ui/nav.ts` (edit — one `NAV` item, one `SHORTCUTS` row)
Skills:   frontend-architecture
Do:       Add a third `NavGroup`, `GLOBAL`, holding exactly one item:
          `{ key: "multi-agent", label: "Multi-Agent Review", icon: <an existing IconName>,
          href: "/repos/:repoId/multi-agent", gKey: "m" }`. The key is fixed by two files that
          already exist and are **not** edited: `activeKeyFor` maps any path containing
          `/multi-agent` to `"multi-agent"` (`components/app-shell/helpers.ts:28`) and
          `shell.json:26` already carries the label under that key. The icon name must exist in
          `client/src/vendor/ui/icons.tsx` — check it, do not guess.

          A new section is safe: both consumers flatten `NAV`
          (`useGlobalShortcuts.ts:45`, `useShellCommands.ts:21`) and `nav.ts:31-32` says so in
          its own comment. Creating `GLOBAL` now rather than parking the item under `WORKSPACE`
          is deliberate — it is where the design puts it, and it is the section worktree B
          appends CI Runs to after the merge, which makes B's rebase an append rather than a
          re-file.

          Add the matching `SHORTCUTS` row `{ keys: "g m", label: "Go to Multi-Agent Review",
          group: "Navigation" }` — `m` is free (today's are `p`, `s`, `a`, `c`, `,`) and a `gKey`
          the palette does not document is half a shortcut. See § Ambiguities for why this is not
          scope creep against AC-33.

          The stale comment at `nav.ts:26-30` — *"The design's third group (GLOBAL: Memory,
          Multi-Agent Review, Agent Performance, CI Runs) … are later lessons, so they are
          absent"* — becomes false with this edit and is corrected in the same commit, naming
          which of the four now exists and which three still do not.

          **Nothing else under `client/src/vendor/ui/` is opened.** `Sidebar.tsx` renders `NAV`
          on its own (`shell/Sidebar.tsx:45`) and needs no change.
Verify:   `git diff --name-only lesson-07...HEAD | grep '^client/src/vendor/ui/'` → exactly one
          line, `client/src/vendor/ui/nav.ts` (**0 lines today**) ·
          `grep -c 'href: "' client/src/vendor/ui/nav.ts` → **7** (6 today) ·
          `grep -c 'gKey:' client/src/vendor/ui/nav.ts` → one more than today ·
          `cd client && pnpm typecheck && pnpm test` ·
          the app renders the entry and `g m` navigates — one manual click, since the sidebar is
          vendored and its own tests are not ours
Covers:   AC-33 (the entry half)
Depends:  Step 8 — `nav.ts:26-30` states the rule this ordering obeys: a nav entry to a route
          that does not exist is worse than no entry
Commit:   `feat(web): Multi-Agent Review joins the nav, in the design's GLOBAL group`

---

### Step 10 — the seed, and the flow that reads it   ·   package: server + e2e

Files:    `server/src/db/seed.ts` (edit) · `e2e/specs/11-multi-agent-review.flow.json` (new)
Skills:   drizzle-orm-patterns, typescript-expert
Do:       **One step, because the flow asserts the seed's literals** and root `CLAUDE.md`
          § Gotchas makes that pairing a rule: split, one of the two commits is red by
          construction.

          Seed: one **completed** `multi_agent_runs` row for demo PR #482 from the three enabled
          agents (AC-36), with one `agent_runs` row per agent carrying `multi_agent_run_id`,
          plausible `duration_ms` / `cost_usd` / `findings_count` / `status: 'done'`, one
          `reviews` row per agent with its `agent_id` and `run_id` set, and findings arranged so
          the page has something true to show: **at least one place two agents flagged with
          near-identical titles** (a group of more than one, AC-15's badge) and **at least one
          place one agent flagged that another `done` agent did not** (a conflict with a
          `did not flag` take, AC-18/AC-29). The existing four seeded findings
          (`seed.ts:460-511`) stay exactly as they are — they belong to the `model: 'seed'`
          review that flow 04 and the run-cost badge assert against.

          **Its own guard.** The existing run block is guarded on *"this PR has no runs yet"*
          (`seed.ts:768-772`), which is false forever after this step. The new block guards on
          the absence of a `multi_agent_runs` row for the demo PR, or `pnpm db:seed` twice stops
          converging — which is precisely what AC-36 asks to run. Prefer one transaction per
          parent run, on the shape `seed.ts:648-666` already uses, so a crash cannot leave a
          parent with no children.

          Flow `11-multi-agent-review.flow.json`: open the app root, follow the redirect to the
          first repo, land on PR #482, navigate to `/repos/<id>/multi-agent?pr=482`, assert the
          three seeded agent names and a seeded finding title are on screen, `find role button
          --name "Start New Review"` is present, navigate away (to the PR list) and back, and
          assert the same columns return. **No step starts a run** — see § Unverifiable as
          written; `wait --text` / `wait --url` are the assertions and the AI `chat` command is
          forbidden (`e2e/CLAUDE.md`). Every asserted string is a seed literal or a
          message-file literal, and every button is located by a name unique on the page
          (`e2e/INSIGHTS.md` 2026-08-23).
Verify:   `cd server && pnpm db:seed && pnpm db:seed` — twice, and the second changes nothing:
          `select count(*) from multi_agent_runs` = **1** after both, and
          `select count(*) from agent_runs where multi_agent_run_id is not null` = **3** after
          both ·
          `grep -rn "$(the literals changed)" e2e/specs/*.json` — this step adds literals rather
          than changing any, so the expected result is **no existing flow references them**; run
          it and say so rather than assuming (root `CLAUDE.md` § Gotchas) ·
          `cd e2e && pnpm e2e:hermetic` — all eleven flows, on ports 5433/3101/3100 ·
          `cd server && pnpm typecheck`
Covers:   AC-30, AC-36
Depends:  Step 5 (the endpoint that renders the seeded rows), Step 8, Step 9
Commit:   `feat(seed): a finished three-agent run on the demo PR, and the flow that returns to it`

---

### Step 11 — the test lanes   ·   package: server + client   ·   **written by `test-writer`, not by `implementer`**

Files:    `server/test/multi-agent-helpers.test.ts` (new — unit) ·
          `server/test/multi-agent.it.test.ts` (new — the 16th Postgres container) ·
          `server/test/reviews.it.test.ts` (edit — the request-shape cases) ·
          `client/src/app/repos/[repoId]/pulls/[number]/_components/MultiAgentPicker/MultiAgentPicker.test.tsx` (new) ·
          `client/src/app/repos/[repoId]/multi-agent/page.test.tsx` (new) ·
          `client/src/app/repos/[repoId]/multi-agent/_components/DisagreeBlock/DisagreeBlock.test.tsx` (new) ·
          `client/src/components/app-shell/nav-entry.test.ts` (new)
Skills:   react-testing-library (client), onion-architecture (server)
Do:       **The implementer writes none of this** (`reference/lessons/kickoff/L07A.md`
          § Дисципліна прогону). It is `test-writer`'s pass, launched by `/implement --tests`
          after the fix loop closes. Everything below is the order it needs.

          *server unit* — `groupFindings`: member texts byte-identical to inputs (AC-15); the
          union of groups equals the input set and pairwise intersections are empty (AC-16); two
          calls on the same inputs give identical groups, including order (AC-17).
          `detectConflicts`: three cases — unanimous flag is not a conflict, one flag plus one
          silent `done` agent is, divergent severities are (AC-18); a `failed`/`cancelled`/
          `running` agent appears in no `takes` at all (AC-19). `estimateFor`: `null` on an empty
          history, never `0` (AC-22, AC-23).

          *server integration* — `multi-agent.it.test.ts`, built on `src/adapters/mocks.ts` and
          on a **file-local** `throwingLLM(id)` copied from `brief.it.test.ts:40` (do not promote
          it — that would edit three shipped test files). Cases: one POST on three agents → one
          `multi_agent_runs` row, three `agent_runs` sharing a non-null `multi_agent_run_id`
          (AC-04); a single `{ agentId }` → zero new parent rows, column `null` (AC-05); two
          valid ids plus one from another workspace → 404 and **zero** new `agent_runs`
          (AC-03); a raw `agent_runs` insert with `source: 'ci'` and no `multi_agent_run_id`
          succeeds (AC-06); `GET` on a clean PR → 404 with code `no_multi_agent_run`, and 200
          forever after one run (AC-09); the whole read path against `throwingLLM` on every
          method, asserting the route log line carries `llmCalls: 0` — the collector shape is
          `intent.it.test.ts:430-435`, `app.log.info` replaced and asserted on (AC-08); two
          parent rows inserted in **one transaction**, read twice, same answer (AC-10); three
          agents → three columns, same order on a second GET (AC-11); a `failed` row with an
          `error` and a `cancelled` row, both rendered with their status (AC-12); one failed of
          three → 200, one `failed` column with its reason, two `done` with findings (AC-13);
          two identical reads with no rows written in between (AC-14); the finding count across
          all groups equals the run's persisted finding count (AC-15); the estimate on a PR with
          **no** completed run — use one of `SEED_DEMO_PRS`, not #482, which the seed gives a
          `done` run (AC-22, AC-23); and AC-36's seeded parent run, read through the endpoint —
          **this case depends on Step 10**, which is why this step does.
          `reviews.it.test.ts` gains AC-01's regression pair (`{ agentId }` and `{ all: true }`
          answer as before) and AC-02's four rejections (two forms, no form, `agentIds: []`) each
          asserting `select count(*) from agent_runs` did not move, plus AC-07's field.

          *client component* — picker: five seeded agents → five checkboxes, three marked
          enabled; the button label follows the count; zero ticked → `disabled` **and zero
          mutations**; empty history → the qualifier-carrying "no data yet" string, not a zero
          (AC-20 … AC-23, AC-31). Results page: a mocked `useRunEvents` where one column's event
          leaves the others' status alone (AC-24); a click on the second column's `View trace`
          hands the drawer the **second** run's id (AC-25); toggling modes twice does not
          increase a fetch counter and both modes render from one state (AC-26); the detail card
          shows confidence, the suggested fix and four actions (AC-27); clicking Learn and
          `Turn into eval case` shows a visible message and issues no request (AC-28); the
          conflicts switch hides non-conflict groups and an `ignored` take renders as
          `did not flag` (AC-29); three agents with one `failed` renders "2 of 3", three `done`
          does not (AC-37). Drive everything with `fireEvent` — `user-event` is not installed.
          AC-25's wiring lives in a callback the page hands down, so it needs a **page** test,
          not a component one (`client/INSIGHTS.md` 2026-08-30), and that entry names the mock
          shape to copy.
          Nav: `NAV` carries exactly one item with `key === "multi-agent"`, it has an `href` and
          a `gKey`, and the flattened list grew by exactly one (AC-33's test half).
Verify:   `cd server && pnpm exec vitest run test/multi-agent-helpers.test.ts` first, then the
          whole unit lane ·
          `cd server && pnpm exec vitest run test/multi-agent.it.test.ts` alone, then
          `pnpm exec vitest run .it.test` — **and re-run the full lane at least five times**
          before calling any unrelated red a regression: the 16th container is a load change, the
          race is ~20% and "remove the new file and re-run" passing once proves nothing
          (`server/INSIGHTS.md` 2026-08-28 and its 2026-08-29 correction) ·
          `cd client && pnpm test && pnpm typecheck` — both, always
Covers:   AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12,
          AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24,
          AC-25, AC-26, AC-27, AC-28, AC-29, AC-31, AC-33 (the test half), AC-36, AC-37
Depends:  Step 10 (the seeded rows AC-36's case reads), and Steps 3–9 for everything else
Commit:   `test(multi-agent): the grouping rule, the fan-out that isolates a failure, and the two loud stubs`

---

### Step 12 — one agent against three, measured   ·   **manual; not run by `/implement`**

Files:    `docs/retro/ledger.md` (edit — one entry)
Skills:   none
Do:       This step spends real money against a real provider and a real clock, which is why the
          spec's own § Test plan puts it under `manual` and why `/implement` must not run it.
          A human, with a provider key configured, runs the **same** pull request twice: once
          with one agent, once with three, through the picker Step 7 built. For each run, record
          four numbers read from `GET /pulls/:id/runs` — wall clock, total tokens, total cost,
          finding count — and write them as one ledger entry.
          The entry states, in one line, that the ratio is **not** expected to be 3×, and why in
          this codebase specifically: the diff and the intent are prepared once for the whole
          batch (`run-executor.ts:106,120`), answer lengths differ, **and the executor runs the
          agents sequentially** (`run-executor.ts:122-129`) — see § Requirements review. Writing
          a number to match an expectation is the one failure mode AC-35 exists to prevent.
Verify:   the ledger entry carries all four numbers for **both** runs, and the observer
          re-reads them from `GET /pulls/:id/runs` rather than from the note
Covers:   AC-35
Depends:  Step 5 (the picker's endpoint), Step 7 (the picker), and a provider key
Commit:   `docs(retro): one agent against three, on one pull request, measured`

---

### Step 13 — the criteria about the diff, checked   ·   package: none (verification pass)

Files:    none · `specs/multi-agent-review.md` (`Status:` line only)
Skills:   none
Do:       **Last, because AC-32, AC-33 and AC-34 are criteria about the diff**, and a diff is
          only complete when everything else is in it. Run every `How it is checked` cell that is
          a shell command, AC-01 to AC-37, top to bottom, and paste the real output.
          The three that live only here:
          - **AC-32** — `cmp -s` over the three pairs this work touched, **per file, never a tree
            diff**: `adapters.ts`, `contracts/eval-ci.ts` and `contracts/productionize.ts` are
            drifted today and are nobody's errand on this PR
            (`scripts/pr-self-review-checks.sh:140-145`). Then `pnpm typecheck` in both packages.
          - **AC-33** — `git diff --name-only lesson-07...HEAD | grep '^client/src/vendor/ui/'`
            → exactly one line, `nav.ts` (**0 today**).
          - **AC-34** — `git diff --name-only lesson-07...HEAD | grep -E
            '^(ci/|agent-runner/|reviewer-core/|mcp/)'` → **no output** (0 today), and
            `git diff --name-only lesson-07...HEAD | grep 'run-executor.ts'` → **no output**.
            Then read the full file list against the spec's § Owned directories and files, line
            by line: `contracts/review-api.ts` is the one path on it that the spec's table does
            not list, and it is there for the reason § Requirements review gives.
          Also re-run the two greps that back criteria elsewhere: no new `setInterval`
          (AC-24) and no `learn` or eval route in `server/src/modules/*/routes.ts` (AC-28) —
          `grep -rn "'/findings/:id/learn'\|/eval" server/src/modules/*/routes.ts` → no output,
          which is what makes the stub honest rather than premature.
          Then set the spec's `Status:` to `done`. That one line is the only edit to the spec
          this whole plan authorises, and it is the implementer's, not the planner's.
Verify:   the AC table, top to bottom ·
          `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check`
          — read `arch:check`'s **output** ·
          `cd server && pnpm exec vitest run .it.test` ·
          `cd client && pnpm typecheck && pnpm test` ·
          `cd e2e && pnpm e2e:hermetic` ·
          `bash scripts/pr-self-review-checks.sh` — expect `check:contract-mirror` satisfied by
          Step 2 and `check:schema-migration` satisfied by Step 1
Covers:   AC-32, AC-33, AC-34, and the structural half of every other id
Depends:  Step 12
Commit:   `chore(specs): the multi-agent review's criteria, checked`

---

## Out of scope

Copied verbatim from `specs/multi-agent-review.md` § Out of scope.

- **`ci/`, `agent-runner/`, CI Runs, the agent editor's CI tab** — worktree B (L07-B) owns
  all four and is already working in them: `../dev-digest-l07b` is checked out on
  `feat/export-to-ci` and has moved ahead of our base (`5530da3` vs `9f5e52e`) with the
  `agent-runner/` import. The whole point of the fan-out is that the two diffs barely touch
  (`reference/lessons/L07/L07-lab.md` § Частина 1).
- **The `/findings/:id/learn` endpoint and the `memory` table behind it** — L07's memory
  half, not this stream. The button exists here; the endpoint does not.
- **The eval-case endpoint** — L06. Same treatment: the button is here, loudly broken until
  L06 merges.
- **`AgentStats` and the Agent Performance screen** — the contract is in the file we own, but
  the screen is `agent-performance` in the design manifest and belongs to L08. Implementing
  it "while we are in the file" would double the diff and collide with L08's own work.
- **Changing `run-executor.ts`'s execution model** — no concurrency limit, no queue, no
  retry. It works; a change there risks every single-agent review in the product.
- **Rewriting `RunReviewDropdown` away** — the one-agent and all-agents paths keep working
  exactly as they do, so a regression in this work cannot take normal reviews with it.
- **Persisting groups or conflicts** — see `Simplicity review` §3; the contract already
  says "Computed from persisted findings; not stored"
  (`contracts/observability.ts:61-65`) and nothing in the requirements needs them durable.
- **Cross-PR or cross-repo multi-agent history** — one PR's latest run is what the
  requirement asks to return to.

---

## Coverage

Built from the spec's thirty-seven ids, in order, not from the steps.

| AC | Step | AC | Step |
|---|---|---|---|
| AC-01 | 2, 3, 11 | AC-20 | 7, 11 |
| AC-02 | 3, 11 | AC-21 | 7, 11 |
| AC-03 | 3, 11 | AC-22 | 4, 5, 7, 11 |
| AC-04 | 1, 3, 11 | AC-23 | 4, 5, 7, 11 |
| AC-05 | 3, 11 | AC-24 | 6, 8, 11, 13 |
| AC-06 | 1, 11 | AC-25 | 8, 11 |
| AC-07 | 2, 3, 11 | AC-26 | 8, 11 |
| AC-08 | 5, 11 | AC-27 | 2, 8, 11 |
| AC-09 | 5, 6, 11 | AC-28 | 8, 11, 13 |
| AC-10 | 5, 11 | AC-29 | 8, 11 |
| AC-11 | 5, 11 | AC-30 | 8, 10 |
| AC-12 | 2, 5, 11 | AC-31 | 7, 8, 11 |
| AC-13 | 5, 11 | AC-32 | 2, 13 |
| AC-14 | 1, 5, 11 | AC-33 | 9, 11, 13 |
| AC-15 | 2, 4, 8, 11 | AC-34 | 13 |
| AC-16 | 4, 11 | AC-35 | 12 |
| AC-17 | 4, 11 | AC-36 | 10, 11 |
| AC-18 | 4, 11 | AC-37 | 2, 4, 5, 8, 11 |
| AC-19 | 4, 5, 11 | — | — |

All thirty-seven appear against at least one step. **Checked in four directions**, the fourth
being the one that failed silently on the previous plan (root `INSIGHTS.md` 2026-08-30):

1. **Every id has a step.** Yes, above.
2. **No step names an id the spec does not carry.** Checked; the spec's ids run AC-01 … AC-37
   with no gaps, and no `Covers:` line names anything outside that range.
3. **Every *lane* the spec's `How it is checked` column names has a step**, not merely every
   criterion. Swept cell by cell. Three cells name a lane that needed placing beyond the
   obvious one, and all three are placed: AC-14's *"`git diff` не додає таблиць"* → Step 1's
   `grep -c 'CREATE TABLE'` **and** Step 13; AC-24's *"grep не знаходить нового `setInterval`"*
   → Steps 6 and 8's greps **and** Step 13; AC-28's *"grep підтверджує відсутність маршрутів
   `learn` і eval"* → Step 13. Two cells are covered by **more** lanes than the spec asks —
   AC-22 and AC-23 gain a client component lane on top of the integration one — and that is the
   safe direction, left alone.
4. **Every lane that asserts against data depends on the step that writes it.** The only lane
   in this plan that reads rows it does not create is AC-36's integration case, which reads the
   seed. It sits in Step 11, and **Step 11 `Depends: Step 10`** — the arrow points from the
   reader to the writer, not the reverse. Every other integration case creates its rows through
   the API inside its own `it`, and every component test builds its own fixture. Step 10's flow
   asserts literals written in the same commit.

Four ids are covered in parts, and every part is named:

- **AC-01** — the third form is declared in Step 2, honoured in Step 3, and the *"без змін"*
  half of the criterion (the old two forms still answer as before) can only be proved by the
  regression pair in Step 11.
- **AC-22 / AC-23** — the arithmetic that returns `null` rather than `0` is Step 4's, the route
  that serves it is Step 5's, the label that says "estimate" and the per-agent "no data yet" are
  Step 7's.
- **AC-33** — Step 9 makes the entry, Step 11 asserts the flattened list grew by exactly one,
  and Step 13 is the only place the *"жоден інший файл під `vendor/ui/`"* half can be checked,
  because it is a statement about the finished diff.
- **AC-37** — the two numbers enter the contract in Step 2, are computed in Step 4, are served
  in Step 5, and are rendered as "2 of 3" in Step 8.

**Two steps cover nothing and say so.** Step 6 is the hook file and the copy Steps 7 and 8
render; splitting it out is what keeps Step 7's `pnpm typecheck` gate honest, because a
component and the hook it calls landing together hides which of the two broke.

---

## Commit plan

**One commit per step, twelve at the ceiling** (Step 11 and Step 12 each carry one; Step 13 is
the twelfth). Each step ends in a command that passes or fails, and that command is the commit's
gate: a step whose `Verify` is red does not get committed.

| # | Step | Commit |
|---|---|---|
| 1 | the column | `feat(db): agent_runs learns which multi-agent run it belongs to` |
| 2 | the contracts | `feat(shared): a run request that names a set, and columns that can fail` |
| 3 | the write path | `feat(reviews): a review request can name a set, and the set becomes one run` |
| 4 | the pure rules | `feat(multi-agent): the grouping rule, the conflict rule, and the estimate` |
| 5 | the module | `feat(multi-agent): the latest run of a PR, as columns, groups and conflicts` |
| 6 | the client data path | `feat(web): the multi-agent hooks, and the copy the screens need` |
| 7 | the picker | `feat(web): pick the agents, see what it will cost, start them in one action` |
| 8 | the results route | `feat(web): the multi-agent results — columns, groups, and where the agents disagree` |
| 9 | the nav entry | `feat(web): Multi-Agent Review joins the nav, in the design's GLOBAL group` |
| 10 | seed + e2e | `feat(seed): a finished three-agent run on the demo PR, and the flow that returns to it` |
| 11 | the tests | `test(multi-agent): the grouping rule, the fan-out that isolates a failure, and the two loud stubs` |
| 12 | the measurement | `docs(retro): one agent against three, on one pull request, measured` |
| 13 | the structural check | `chore(specs): the multi-agent review's criteria, checked` |

The rules that make those boundaries defensible, in the order a reviewer would question them:

- **The mirror is never split.** Commit 2 edits six files across two packages in one go. Split,
  the tree is broken in between and AC-32 fails in the gap — which is the whole point of the
  gotcha it comes from. The producer sweep a contract edit normally drags in came back empty
  here; had it found literals, they would have belonged in this same commit.
- **The schema change and its generated migration are one commit**, so a bad `pnpm db:generate`
  is revertible without dragging the module with it. `pnpm db:migrate` is manual and is part of
  no commit — and it is needed again on the integration database after each of merge-order
  steps 2 and 4.
- **Commit 1 is first for a cross-stream reason, not only a technical one.** It is the one file
  worktree B must rebase against (`WORKING-ORDER.md`: one stream generates a migration at a
  time), so it lands early and alone, which makes B's conflict a one-file conflict.
- **The two `modules/multi-agent` commits split on I/O, not on size.** Commit 4 is every
  decision this feature makes with no clock, no database and no network — and its gate is the
  unit lane. Commit 5 is every line that touches one — and its gate is the unit lane plus
  `arch:check`. That is the same line the spec's test plan draws, so the commits and the lanes
  agree.
- **The write path is separate from the read path.** Commit 3 changes a shipped module that
  every existing review goes through; commit 5 creates a new one that nothing depends on yet.
  Merged, the one change that could break something already working would be hidden inside the
  one that could not.
- **The client's data path lands before the components that call it.** Commit 6 is a hook and a
  message file and can regress nothing; commit 7 edits one shipped component (`OverviewTab`);
  commit 8 is entirely new.
- **The nav entry is its own commit** — one line in a file the root `CLAUDE.md` calls
  do-not-touch, on a one-lesson ownership transfer. Alone, it is the commit B rebases onto and a
  reviewer reads in three seconds; folded into commit 8 it is a line in a 400-line diff.
- **Seed and e2e are one commit** because the flow asserts the seed's literals. Split, one of
  the two commits is red by construction.
- **The tests are one commit and a different author.** `test-writer` writes them
  (`reference/lessons/kickoff/L07A.md`), so they cannot be folded into the implementer's
  commits without misattributing who wrote what.
- **Twelve is a ceiling, not a quota.** A step that turns out to be a no-op gets no commit.
- **The spec and this plan are in the history before Step 1 runs** — the spec is `9ed6231`;
  this plan is committed before the first step, on the sibling's precedent. Suggested subject:
  `docs(plans): how multi-agent review gets built, in thirteen steps`.
- **`/pr-self-review` runs before the pull request, not before each commit** (root `CLAUDE.md`
  § Session protocol).
- **Commit only when asked.** This plan says where the boundaries are; it authorises no push
  and no pull request.

---

## Handoff

Plan file:      `specs/plans/multi-agent-review.md`
Entry point:    Step 1. Nothing on disk is started; `git status --porcelain` is empty at
                `9ed6231`.
Execution mode: **two `/implement` passes, `test-writer` on the second.** Not asked, because the
                brief already fixes the budget — *"ліміт імплементор-агентів: максимум 3–5"*,
                *"імплементор не пише тести"*, *"fix-loop: максимум 2 ітерації"*
                (`reference/lessons/kickoff/L07A.md`) — and the dependency graph fixes the split:

                ```sh
                /implement specs/plans/multi-agent-review.md --steps 1-5
                /implement specs/plans/multi-agent-review.md --steps 6-10 --tests
                ```

                Pass 1 is the server: 1 → 2 → 3 → {4} → 5 is a chain with one fork, and its gates
                (`arch:check`, the unit lane, the migration) are all server gates. Pass 2 is the
                client, the seed and the flow, and it carries `--tests` so `test-writer` writes
                Step 11 across **both** packages once, after the last fix lands — which is where
                the flag puts it (`.claude/skills/implement/SKILL.md` § 1, row 4).
                **The budget, stated as a hard number:** 2 `implementer` launches plus at most
                1 fix iteration each = **4**, ceiling **5**. If both passes exhaust two fix
                iterations, the run stops at the fifth launch and hands back — it does not open a
                third loop. `architecture-reviewer` and `plan-verifier` are read-only and run at
                sonnet, outside that count.
                One pass over all ten steps would keep the count at three, and was rejected: ten
                steps spanning a new server module, four new client component trees, a seed and
                an e2e flow is more than one context carries well, and the server half's contract
                edits are on disk by the time pass 2 starts, so pass 2 pays no re-derivation.
                Reversible: if the caller wants one pass, `--steps 1-10 --tests` is valid and
                nothing in the plan changes.
Tests:          **`--tests` is not optional here.** The implementer writes no tests in this
                workflow, so every `Verify:` in Steps 1–10 was written to pass without a single
                file from Step 11. Step 11 is the order `test-writer` reads: file names, lanes,
                and what each case must catch.
Verification:   per step above. Closing lanes:
                `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check`
                — read `arch:check`'s **output**, not its exit code ·
                `cd server && pnpm exec vitest run .it.test` (Docker; re-run the lane five times
                before calling an unrelated red a regression) ·
                `cd client && pnpm typecheck && pnpm test` — both, always ·
                `cd e2e && pnpm e2e:hermetic`. `reviewer-core` and `mcp` are untouched by
                construction (AC-34) and their lanes are not part of this plan.
Closing step:   after Step 13 is green, `/engineering-insights` — three candidates are already
                sitting in this plan: the executor's sequential loop against a brief that calls
                it parallel, a scaffold's *message file* making a false claim about behaviour
                (the second sighting of `client/INSIGHTS.md` 2026-08-29, which is the promotion
                rule's threshold), and an acceptance criterion whose `How it is checked` names a
                lane its own package forbids. Then `/pr-self-review`, then the pull request —
                **against `lesson-07`, never `main`**, and only after
                `git push -u origin lesson-07`, because `origin` carries no such branch today
                (spec § Merge order, precondition). Then tell worktree B two things: the nav
                entry is in a new `GLOBAL` group to append to, and B's own spec is wrong that
                A needs no migration.
Deviation policy: stop at the step, report the divergence, finish the independent steps.
                  Do not re-plan, and do not amend the spec — a gap goes to `spec-creator`.
                  Specifically: if `architecture-reviewer` rejects the cross-route import of
                  `RunTraceDrawer`, **report it and stop** — promoting the component to
                  `client/src/components/` is a breach of the spec's § Owned directories and
                  files and is the human's call, not the implementer's.

---

## Recommendations

Each is a **proposal**, not a step, and none is implemented unless it is picked up.

- **Delete or correct `client/messages/en/runs.json` § `page` (`:110-134`).** It is dead copy
  that makes two false claims — `"fan-out via p-queue"` (there is no p-queue in this repository)
  and `"Run all agents" / "every enabled agent in parallel"` (the behaviour this feature
  replaces with a subset picker). Nothing renders it, so it is harmless today and a trap the
  moment someone greps for multi-agent copy and finds it. Left out of the plan because the
  spec's file list limits `client/messages/**` to *new copy keys only*; three lines of `git rm`
  inside a JSON object would close it.
- **Take the spec's four UX proposals in Step 8.** Two are nearly free and one is load-bearing:
  the group's member count on the badge is the strongest signal on the page and Step 8 already
  computes it; the fan-out's total cost next to `Start New Review` is the number that makes
  repeating the run a decision; `—` with a tooltip for an unpriced model is the product's
  existing convention, which the mock does not have. The pinned column header is the one worth
  deferring.
- **Ask `doc-writer` for three glossary entries** — *multi-agent run*, *finding group*,
  *conflict* — as § Open questions §11 notes. Not this stream's work, and easy to lose.
- **Do not read `upstream/lesson-7-lab/multiagents-finish` before Step 8.** § Open questions §10
  records that a complete reference solution exists and takes no position. Mine, as a
  proposal: the branch contains **worktree B's work as well**, so anything copied from it
  crosses this stream's boundaries and would show up in Step 13's AC-34 check as a path this
  plan never named. Read it after the measurement in Step 12, as a comparison — that is when it
  teaches something and cannot contaminate anything.
- **A fifth `Verify` worth adding to `/implement` generally:** every gate in this plan that
  carries a number was executed against the tree while the plan was written, and two of them
  (`grep -c 'href: "'` → 6, `.it.test.ts` files → 15) were only checkable because the *current*
  count is checkable even when the future code is not. That is already a ledger recommendation
  from the last run; this plan is its first application, and it is worth saying whether it paid.
