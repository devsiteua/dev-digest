# Multi-Agent Review

Spec ID: MULTI-AGENT-REVIEW
Status: approved
Supersedes: none
Owner: devsiteua
Packages touched: server, client, e2e (`@devdigest/shared` contracts in both mirror copies)
Stream: L07-A · worktree `dev-digest-l07a` · branch `feat/multi-agent-review` · API 3073 · WEB 3072

> Every section stays, even when the honest answer is "none". A deleted section reads as an
> oversight; the word "none" is a claim someone can disagree with.
> The implementation plan does **not** live here — it lives in `plans/multi-agent-review.md`
> alongside this file. See `README.md` § Where plans live.

## Problem and user

A reviewer looking at one pull request today can start a review with one agent, or with
every enabled agent at once, and both roads end in the same flat list. `RunReviewDropdown`
(`client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx:41-77`)
offers exactly two shapes — `{ agentId }` or `{ all: true }` — and the server's
`resolveTargets` (`server/src/modules/reviews/service.ts:46-57`) accepts nothing else, so
"run these three, not those five" cannot be expressed at all. Once several agents have run,
nothing ties their runs together: `multi_agent_runs`
(`server/src/db/schema/runs.ts:47-56`) exists and is read by no code, and `agent_runs` has no
column pointing at it (`server/src/db/schema/runs.ts:7-36`), so five runs on one PR are five
unrelated rows in a history sorted by `ran_at`. The reviewer therefore cannot see where two
agents agreed, where one agent flagged something the others walked past, or what the whole
fan-out cost — the three questions that are the entire reason for running more than one agent.

The engine underneath is already finished and is not the problem. `ReviewRunExecutor`
(`server/src/modules/reviews/run-executor.ts:50-142`) loads the diff and derives the intent
once for the whole batch and isolates per-agent failures; `useRunEvents`
(`client/src/lib/hooks/reviews.ts:201-219`) already multiplexes N SSE streams. What is
missing is the product around it.

## Goals / Non-goals

**Goals**

1. A reviewer can pick an arbitrary subset of agents for one pull request and start them in
   one action, seeing an estimate of what it will take before committing.
2. The runs of that action are one object — a multi-agent run — that can be fetched back,
   linked to, and returned to after a page reload.
3. Similar findings from different agents are presented as one group, with every original
   finding's text and its author still reachable from that group.
4. A place in the code where agents disagreed is legible as a disagreement, including the
   agents that reviewed and did **not** flag it.
5. One agent's failure costs that agent's column and nothing else.
6. The cost and duration of the fan-out is visible per agent and in total, and every column
   can be opened into the existing run trace.
7. The repository carries an actual measured comparison of one agent against three on the
   same pull request.

**Non-goals**

- **A new execution engine.** Error isolation and shared pre-work exist in `run-executor.ts`;
  this work adds a picker in front of them and a page behind them. **Execution is sequential
  and stays that way** — see the row below and `Known limitations`. Decided by the owner on
  2026-08-30, against the alternative of rewriting the loop as `Promise.allSettled`: the file
  is fenced off by AC-34, worktree B is live in the same tree, and every one of the 37 criteria
  is satisfied without touching it.
- **A consensus verdict.** We do not merge five agents into one score, one verdict or one
  "the agents concluded". Grouping presents; it never decides.
- **Semantic (embedding-based) similarity for grouping.** A model call to decide whether two
  findings are the same finding is a second review, with a second bill, at read time.
- **Cross-PR agent quality analytics.** `AgentStats`
  (`server/src/vendor/shared/contracts/observability.ts:96-119`) is declared but has no
  endpoint; building the Agent Performance dashboard is L08.
- **Surviving an API restart with the live log intact.** `RunBus` is in memory by design
  (`docs/architecture.md:174-181`).

## Context

| Already true | Where |
|---|---|
| N agents run from one request, **sequentially**; diff + intent prepared once for the batch; per-agent failures isolated | `run-executor.ts:122-129` is `for (const … of jobs) { await this.runOneAgent(…) }` — no `Promise.all`, no `allSettled`, no queue, and no `p-queue` anywhere in the repository. The shared diff (`:106`), the shared intent (`:120`) and the isolation (`:129-142`) are real. **The brief's claim that "паралельне виконання вже готове" (`kickoff/L07A.md` § Що вже є в коді) is false**, and so is the lab's; recorded here rather than planned around |
| `run_id` rows exist before any LLM call, so the UI can subscribe immediately | `server/src/modules/reviews/service.ts:114-137`; `docs/glossary.md` § Run |
| Run request contract is `{ agentId?, all? }` — no subset form | `server/src/vendor/shared/contracts/platform.ts:320-324` |
| `resolveTargets` throws 400 unless `all` or a single `agentId` is given | `server/src/modules/reviews/service.ts:46-57` |
| `multi_agent_runs` table exists (id, workspace_id, pr_id, ran_at) and is read nowhere | `server/src/db/schema/runs.ts:47-56` |
| `agent_runs` has **no** parent-run column — a migration is unavoidable | `server/src/db/schema/runs.ts:7-36` |
| Run statuses in the DB are `running · done · failed · cancelled` | `server/src/modules/reviews/repository/run.repo.ts:135,146,97`; `docs/glossary.md` § Run |
| Finding → agent attribution already exists via `reviews.agent_id` and `reviews.run_id` | `server/src/db/schema/reviews.ts:28-30` |
| `MultiAgentRun`, `AgentColumn`, `AgentColumnFinding`, `Conflict`, `ConflictTake`, `AgentStats` are written and exported, unused by any code | `server/src/vendor/shared/contracts/observability.ts:23-119`; barrel `index.ts:26` in both copies |
| The two `observability.ts` copies are currently byte-identical | `cmp` of `server/src/vendor/shared/contracts/observability.ts` and the client mirror |
| SSE per run with a replay buffer; the client already multiplexes many run streams at once | `server/src/modules/reviews/routes.ts:93-135`; `client/src/lib/hooks/reviews.ts:201-219` |
| `run_traces` + trace builder + `RunTraceDrawer` (Trace / Live log tabs) work today | `server/src/platform/trace-builder.ts`; `server/src/platform/run-logger.ts`; `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.tsx:1-40` |
| `LiveLogStream` is a vendored UI primitive taking `{ log, running, height, elapsedLabel }` | `client/src/vendor/ui/LiveLogStream.tsx:20-29` |
| Finding actions registered on the API are **accept and dismiss only**; `learn` and `reply` are in the contract enum but 400 at the service | `server/src/modules/reviews/routes.ts:20,192`; `server/src/modules/reviews/findings.ts:22-33`; `server/src/vendor/shared/contracts/findings.ts:120` |
| No eval endpoint exists; `eval_cases` / `eval_runs` are empty tables | `server/src/db/schema/eval.ts:7,22`; no `eval` route in any `modules/*/routes.ts` |
| No `/agents/:id/stats` endpoint; nothing aggregates per-agent duration or cost | `server/src/modules/agents/routes.ts:76-177` |
| Per-PR run history with `duration_ms`, `cost_usd`, `agent_id` is served, ordered by `ran_at` alone | `server/src/modules/reviews/repository/run.repo.ts:39-68` |
| `nav.ts` deliberately omits the design's GLOBAL group, including Multi-Agent Review | `client/src/vendor/ui/nav.ts:26-53` |
| The seed enables exactly three agents (General, Security, Performance) and disables two | `server/src/db/seed.ts:565-623` |
| `pnpm arch:check` exits 0 on the cross-module rule it exists to catch — read the output | root `INSIGHTS.md` § 2026-08-22; `server/.dependency-cruiser-onion.cjs:96-98` |
| A batch insert ties `defaultNow()` to the microsecond, so "latest per group" needs a second sort key | root `CLAUDE.md` § Gotchas |

The live API could not be consulted while writing this: the DevDigest MCP tools point at
`http://localhost:3073` for this worktree and the connection was refused (stack not running).
Every statement above therefore comes from the source tree, not from the running product.

## In scope

- **Contract**: widen `RunRequest` (`contracts/platform.ts`) with an `agentIds: string[]`
  form, and extend the already-written A5 contracts in `contracts/observability.ts` with the
  fields the requirements need and the file does not yet carry (grouped findings, a
  `cancelled` column status, per-column error text, a run-cost estimate shape). Both mirror
  copies, byte-identical.
- **Migration**: one new column on `agent_runs` referencing `multi_agent_runs`, nullable, so
  every existing row and every future CI-ingested row stays legal.
- **Server**: a multi-agent module that (a) creates the parent row and links the child runs
  when a run request names a set, and (b) serves the latest multi-agent run of a pull
  request as columns + groups + conflicts, computed from persisted rows with no model call.
- **Server**: a run estimate derived from the run history that already exists.
- **Client**: an agent picker with checkboxes and an estimate on the PR page; a
  Multi-Agent Review results view in two modes behind one toggle, with per-column status,
  `View trace`, the grouped findings, the `Where agents disagree` block and its
  `Show only conflicts` switch, `Start New Review`, and honest failing stubs for the two
  buttons whose endpoints belong to other lessons.
- **Client**: one `NAV` entry for Multi-Agent Review in `client/src/vendor/ui/nav.ts`.
- **e2e**: one deterministic flow over seeded data.
- **Measurement**: one recorded 1-agent vs 3-agent comparison with real numbers.

## Out of scope

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

## Owned directories and files

Files this worktree may create or change. Anything not on this list is a boundary breach
and should be raised rather than edited.

**Exclusively ours (create / change freely):**

| Path | Note |
|---|---|
| `specs/multi-agent-review.md`, `specs/plans/multi-agent-review.md` | this spec and its plan |
| `server/src/modules/multi-agent/**` | new module (routes · service · repository · helpers · constants), name provisional |
| the finding-grouping and conflict-detection rule, wherever the plan places it in that module | **written by this stream** — it is not existing infrastructure, despite the brief; see `Open questions` §1. Constrained by AC-15 … AC-17, not by a reference implementation |
| `server/src/modules/reviews/service.ts`, `.../repository/run.repo.ts`, `.../repository.ts`, `.../routes.ts` | the run-request path: subset targets, parent-run linkage, `multi_agent_run_id` in the response |
| `server/src/db/schema/runs.ts` | the one new column on `agent_runs` |
| `server/src/db/migrations/**` | generated by `pnpm db:generate`, never hand-edited (root `CLAUDE.md` § Do not touch) |
| `server/src/db/seed.ts` | seeded multi-agent run for the e2e flow — see the grep warning below |
| `server/test/**` and `server/src/**/*.test.ts`, `**/*.it.test.ts` for the above | |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/MultiAgentPicker/**` | new |
| `client/src/app/.../multi-agent/**` (route + `_components/**`) | new — final route path is an open question, see `Design analysis` |
| `client/src/lib/hooks/multi-agent.ts` | new |
| `client/messages/<locale>/**` | new copy keys only |
| `e2e/specs/11-multi-agent-review.flow.json` | next free number after `10-pr-brief` |
| `docs/retro/ledger.md` | the 1-vs-3 measurement row |

**Ours for L07, shared afterwards (change, and tell B):**

| Path | Note |
|---|---|
| `client/src/vendor/ui/nav.ts` | one `NAV` entry. `client/src/vendor/ui/**` is otherwise do-not-touch (root `CLAUDE.md`); this single file is a **deliberate, recorded transfer of ownership for L07** granted by the L07-A brief and `reference/lessons/WORKING-ORDER.md` § Спільні файли. No other file under `vendor/ui/` is touched by this work. |
| `server/src/vendor/shared/contracts/observability.ts` + client mirror | A5's file, ours by the same brief |
| `server/src/vendor/shared/contracts/platform.ts` + client mirror | **not** ours by default — see the next section |
| `server/src/vendor/shared/contracts/review-api.ts` + client mirror | **not** ours by default; claimed for `ReviewRunResponse` only, because AC-07's field has nowhere else to live |

**Explicitly not ours:** `ci/**`, `agent-runner/**`, `server/src/modules/reviews/run-executor.ts`
(read, do not modify), `reviewer-core/**`, `mcp/**`, `client/src/vendor/ui/**` except
`nav.ts`, `server/src/vendor/shared/contracts/eval-ci.ts` (L06) and `productionize.ts` (L08).

## Shared contracts and their owners

| File / artefact | Owner for L07 | What B inherits or must not do |
|---|---|---|
| `vendor/shared/contracts/observability.ts` (both copies) | **A** | B does not open it. Every A5 symbol B might want (`AgentColumn`, `Conflict`, …) arrives already merged. |
| `vendor/shared/contracts/platform.ts` § `RunRequest` (both copies) | **A, for the `RunRequest` object only** | The `agentIds` widening is additive: `agentId` and `all` keep their meaning and their runtime behaviour. If B needs another field in this same file, it appends after the merge rather than in parallel. |
| `vendor/shared/contracts/review-api.ts` § `ReviewRunResponse` (both copies) | **A, for the `ReviewRunResponse` object only** | AC-07 puts `multi_agent_run_id` on the response of `POST /pulls/:id/review`, and that response type lives here (`review-api.ts:64-69`), not in `platform.ts`. Verified 2026-08-30: both copies are byte-identical today, and B's diff touches only `agent-runner/**`, so there is no collision. The addition is optional-shaped, so B's own use of the type is unaffected. |
| `vendor/shared/contracts/eval-ci.ts` (both copies) | **B** (and L06) | A never opens it, including for the eval-case stub. |
| `vendor/shared/index.ts` (both copies) | **neither** | Already re-exports all three contract files (`index.ts:26`). No edit is expected from either stream; if one becomes necessary it is appended, never reordered. |
| `client/src/vendor/ui/nav.ts` | **A** | B adds its CI Runs entry to the version A merged, not to `main`'s. |
| `server/src/db/schema/runs.ts` (`agent_runs`) | **A** | A adds a **nullable** `multi_agent_run_id`. B's ingest inserts `agent_runs` rows with `source='ci'` and simply leaves the column null — but B must regenerate against A's schema, because a CI run is not part of a multi-agent run and nothing may force it to be. |
| `server/src/db/migrations/**` | **A first** | Only one stream generates a migration at a time (`WORKING-ORDER.md` § Спільні файли). A's migration lands with A. |
| Finding attribution (`reviews.agent_id`, `reviews.run_id` → `findings.review_id`) | **already merged, owned by neither** | The brief describes A as "adding the finding attribution B's ingest reads". Read literally that is not what happens: agent attribution of a finding already exists at `server/src/db/schema/reviews.ts:28-30` and this work does not change it. What A actually changes under B's feet is the **shape of `agent_runs`**, which B's ingest writes to. The merge order below is right; its stated reason is not, and the correct reason is recorded here so nobody plans around the wrong one. |
| `server/src/platform/container.ts` and route registration | **shared, append-only** | New registrations go at the end of the list in both streams (`WORKING-ORDER.md`). |
| Mirror rule | **both** | Any edit under `server/src/vendor/shared/` requires the paired edit in `client/src/vendor/shared/` (root `CLAUDE.md` § Gotchas). The copies have drifted before; `cmp` per file, not per tree — see AC-32. |

## Merge order

Both worktrees are live as this is written: B is checked out at `../dev-digest-l07b` on
`feat/export-to-ci` (`5530da3`, the `agent-runner/` import) while A sits at `9f5e52e`, the
same commit as the integration branch. The order below is therefore a live constraint on two
running streams, not a plan for later.

**Precondition — `lesson-07` must be pushed to `origin` before A's pull request is opened.**
The branch exists locally (worktree `../dev-digest-l07`, tip `9f5e52e`), but `origin` carries
only `lesson-01` … `lesson-05` and `main`, so `gh pr create --base lesson-07` has no base to
target. `git push -u origin lesson-07` first. The boundary-check commands in
`Verification commands` compare against the **local** branch and work as written either way.

1. Both worktrees run their own verification (see `Verification commands`) inside their own
   tree, and fix inside their own tree.
2. **A merges first**, via a pull request opened against the **`lesson-07`** branch — never
   against `main`. Two separate pull requests for L07 is a submission requirement
   (`reference/lessons/L07/L07-lab.md` § Частина 1; `WORKING-ORDER.md` § Порядок мержу).
   A goes first because it changes the shape of `agent_runs`, the table B's ingest writes,
   and because it owns `nav.ts`.
3. B rebases / merges `lesson-07` into `feat/export-to-ci`, resolves the two expected
   conflicts (`nav.ts`, and the Drizzle schema/migration folder), and re-runs its checks.
4. B merges into `lesson-07`. Navigation is verified once more **after** the second merge,
   because both features add entries to the same list.
5. `lesson-07` → `main`.

`pnpm db:migrate` is manual and does not run on boot (root `CLAUDE.md` § Commands) — after
each of steps 2 and 4 the integration database `devdigest_l07` needs it explicitly.

## User stories

- As a reviewer looking at a pull request, I want to tick the three agents that are relevant
  to this change and start them in one action, so that I do not pay for the two that are not.
- As a reviewer about to spend money, I want to see roughly how long this will take and what
  it will cost before I press the button, so that the bill is a decision and not a surprise.
- As a reviewer watching a fan-out, I want each agent's column to say what it is doing right
  now, so that a slow agent reads as slow rather than as broken.
- As a reviewer whose Security agent just failed, I want the other two columns to finish and
  be usable, so that one bad model call does not cost me the whole run.
- As a reviewer reading three agents' output, I want the four near-identical reports of the
  same problem collapsed into one group whose members I can still open individually and
  attribute, so that I read the problem once and can still tell who said what.
- As a reviewer, I want the places where the agents disagreed pulled out — including the
  agents that reviewed that line and said nothing — so that I can judge a lone flag on its
  merits instead of assuming consensus.
- As a reviewer, I want to open any column into the existing run trace, so that I can explain
  its tokens, its cost and its grounding decisions without leaving the page.
- As a reviewer who navigated away and came back, I want the last multi-agent run still on
  screen with a clear way to start a new one, so that closing a tab does not lose the result.
- As the person marking this lesson, I want an actual recorded 1-vs-3 measurement in the
  repository, so that the cost of fan-out is a number rather than an assertion.
- As a reviewer who has never opened this product before, with no agents enabled and no runs,
  I want the screen to tell me what to do instead of showing an empty grid.

## Acceptance criteria (EARS)

Written in Ukrainian with the triggers КОЛИ · ПОКИ · ЯКЩО · ДЕ; the rest of the file is
English. Five patterns and the reference: `README.md` § EARS.

| AC-ID | Pattern | Criterion | How it is checked |
|---|---|---|---|
| AC-01 | ubiquitous | `RunRequest` повинен (shall) приймати рівно три взаємно виключні форми — `{ agentId }`, `{ agentIds: [...] }`, `{ all: true }` — і зберігати поточну поведінку перших двох без змін. | Огляд контракту в обох дзеркалах; `reviews.it.test.ts`: `{ agentId }` і `{ all: true }` дають ті самі відповіді, що й до змін |
| AC-02 | unwanted | ЯКЩО запит містить більш ніж одну з форм `agentId` / `agentIds` / `all`, або жодної, або `agentIds: []`, ТОДІ сервіс повинен (shall) відповісти 400 `invalid_run_request` і НЕ створити жодного рядка `agent_runs`. | `reviews.it.test.ts` на всі чотири випадки; `select count(*) from agent_runs` не змінився. Валідацію робить сервіс, не Zod-схема маршруту (`server/INSIGHTS.md` 2026-08-29: схема маршруту вміє лише 422) |
| AC-03 | unwanted | ЯКЩО `agentIds` містить ідентифікатор агента з іншого workspace або неіснуючий, ТОДІ система повинна (shall) відповісти 404 і не запустити ЖОДНОГО з переданих агентів. | `multi-agent.it.test.ts`: набір із двох валідних і одного чужого id → 404, нуль нових `agent_runs` |
| AC-04 | event-driven | КОЛИ надходить запит форми `agentIds` або `all`, система повинна (shall) створити рівно один рядок `multi_agent_runs` і записати його id у нову колонку `agent_runs.multi_agent_run_id` кожного породженого запуску. | `multi-agent.it.test.ts`: один POST на трьох агентів → 1 рядок `multi_agent_runs`, 3 рядки `agent_runs` з однаковим непорожнім `multi_agent_run_id` |
| AC-05 | unwanted | ЯКЩО запит має форму `{ agentId }` (один названий агент), ТОДІ система повинна (shall) НЕ створювати рядок `multi_agent_runs`, а `multi_agent_run_id` цього запуску повинен (shall) лишитися `null`. | `multi-agent.it.test.ts`: одиночний запуск → нуль нових рядків `multi_agent_runs`, колонка `null` |
| AC-06 | ubiquitous | Колонка `agent_runs.multi_agent_run_id` повинна (shall) бути nullable і посилатися на `multi_agent_runs(id)`; наявні рядки та будь-який майбутній рядок із `source='ci'` повинні (shall) лишатися валідними з `null`. | Огляд згенерованої міграції; `multi-agent.it.test.ts` вставляє рядок `agent_runs` із `source='ci'` без цієї колонки й очікує успіх |
| AC-07 | event-driven | КОЛИ мультизапуск створено, відповідь `POST /pulls/:id/review` повинна (shall) містити `multi_agent_run_id` поряд із наявним масивом `runs`. | `reviews.it.test.ts` перевіряє поле у відповіді; для одиночного запуску поле відсутнє або `null` |
| AC-08 | event-driven | КОЛИ надходить `GET /pulls/:id/multi-agent`, система повинна (shall) повернути НАЙНОВІШИЙ мультизапуск цього PR як `MultiAgentRun`, і НЕ зробити жодного виклику моделі. | `multi-agent.it.test.ts` з LLM-провайдером, який кидає на кожному методі; лог маршруту містить літерал `llmCalls: 0` |
| AC-09 | unwanted | ЯКЩО для pull request немає жодного мультизапуску, ТОДІ `GET /pulls/:id/multi-agent` повинен (shall) повернути 404 — і 404 повинен (shall) означати тільки це. | `multi-agent.it.test.ts`: 404 на чистому PR; після одного мультизапуску — 200 назавжди |
| AC-10 | ubiquitous | «Найновіший» мультизапуск повинен (shall) визначатися впорядкуванням за `ran_at DESC` І другим детермінованим ключем, ніколи за `ran_at` самим по собі. | `multi-agent.it.test.ts`: два рядки `multi_agent_runs`, вставлені в ОДНІЙ транзакції, дають однаковий результат при повторних читаннях (пастка `defaultNow()`, root `CLAUDE.md` § Gotchas) |
| AC-11 | ubiquitous | `MultiAgentRun.columns` повинен (shall) містити рівно одну колонку на кожен `agent_run` цього мультизапуску, у стабільному порядку, з `run_id`, іменем агента, `provider`, `model`, статусом, тривалістю та вартістю. | `multi-agent.it.test.ts`: три запущені агенти → три колонки; повторний GET дає той самий порядок |
| AC-12 | ubiquitous | `AgentColumn.status` повинен (shall) приймати всі чотири статуси, які вміє записувати БД — `running`, `done`, `failed`, `cancelled` — а колонка зі статусом `failed` повинна (shall) нести текст помилки з `agent_runs.error`. | Огляд контракту в обох дзеркалах (сьогодні enum — три значення, `observability.ts:41`); `multi-agent.it.test.ts` із скасованим і зі збійним запуском |
| AC-13 | unwanted | ЯКЩО один агент мультизапуску впав, ТОДІ решта колонок повинні (shall) містити свої повні результати, а `GET /pulls/:id/multi-agent` повинен (shall) відповісти 200. | `multi-agent.it.test.ts` із провайдером, що кидає для одного агента з трьох: 200, одна колонка `failed` з причиною, дві `done` зі знахідками |
| AC-14 | ubiquitous | Групи схожих знахідок і конфлікти повинні (shall) обчислюватися з persisted-рядків під час читання й НЕ зберігатися в жодній таблиці. | `git diff` не додає таблиць, крім колонки з AC-06; `multi-agent.it.test.ts` двічі читає той самий мультизапуск і отримує ідентичну відповідь без записів |
| AC-15 | ubiquitous | Кожна група знахідок повинна (shall) нести повний список `finding_id` своїх учасників і `agent_id` кожного з них; жоден оригінальний `title`, `rationale` чи `suggestion` не повинен (shall) бути переписаний, скорочений або злитий. | Unit-тест групувальника: вихідні тексти членів групи посимвольно дорівнюють вхідним; `multi-agent.it.test.ts` перевіряє, що кількість знахідок у всіх групах дорівнює кількості persisted-знахідок мультизапуску |
| AC-16 | ubiquitous | Кожна persisted-знахідка мультизапуску повинна (shall) належати рівно одній групі — група з одного елемента є валідною групою. | Unit-тест: об'єднання груп = множина знахідок, перетин порожній |
| AC-17 | ubiquitous | Правило схожості повинно (shall) бути детермінованою функцією від файлу, діапазону рядків і нормалізованого тексту знахідки, без виклику моделі та без ембеддингів. | Unit-тест: два виклики на однакових входах дають ідентичні групи; `multi-agent.it.test.ts` з провайдером, що кидає, — GET проходить |
| AC-18 | ubiquitous | Конфліктом повинно (shall) вважатися місце коду, яке щонайменше один агент позначив, а щонайменше один інший агент **зі статусом `done`** — ні, або на якому агенти призначили різні severity. | Unit-тест на три випадки: одностайно позначили (не конфлікт), один позначив + один `done` промовчав (конфлікт), різні severity (конфлікт) |
| AC-19 | unwanted | ЯКЩО агент має статус `failed`, `cancelled` або `running`, ТОДІ для нього НЕ повинен (shall) створюватися take зі значенням `ignored` у жодному конфлікті. | Unit-тест: збійний агент відсутній у `takes`; `multi-agent.it.test.ts` із одним збоєм |
| AC-20 | event-driven | КОЛИ рецензент відкриває пікер агентів на сторінці pull request, застосунок повинен (shall) показати чекбокс на кожного агента workspace із позначкою `disabled` для вимкнених, оцінку часу й вартості та кнопку з підписом, що містить кількість обраних — `Run multi-agent review (N)`. | Компонентний тест (RTL): 5 агентів сіду → 5 чекбоксів, 3 позначені як enabled; підпис кнопки змінюється з кількістю |
| AC-21 | unwanted | ЯКЩО не обрано жодного агента, ТОДІ кнопка запуску повинна (shall) бути недоступною і НЕ надсилати запит. | Компонентний тест: нуль обраних → `disabled`, нуль мутацій |
| AC-22 | unwanted | ЯКЩО для обраного агента немає жодного завершеного минулого запуску, ТОДІ оцінка повинна (shall) явно сказати, що даних немає, а не показати нуль чи прочерк. | Компонентний тест на порожню історію; `multi-agent.it.test.ts` для джерела оцінки на чистій БД |
| AC-23 | ubiquitous | Оцінка часу й вартості повинна (shall) обчислюватися з уже збережених `agent_runs` (тривалість, `cost_usd`) без жодного виклику моделі та без нової фонової агрегації, і бути позначеною на екрані як оцінка. | `multi-agent.it.test.ts` із провайдером, що кидає; компонентний тест перевіряє наявність слова-кваліфікатора в підписі |
| AC-24 | state-driven | ПОКИ мультизапуск триває, кожна колонка повинна (shall) показувати власний статус, що оновлюється з SSE наявного `RunBus`, а не з опитування сторінки. | Компонентний тест зі змоканим `useRunEvents`: подія однієї колонки не змінює статус інших; grep не знаходить нового `setInterval` у новому коді |
| AC-25 | event-driven | КОЛИ рецензент натискає `View trace` у колонці, застосунок повинен (shall) відкрити наявний `RunTraceDrawer` саме з `run_id` цієї колонки. | Компонентний тест: клік у другій колонці → дровер отримав `runId` другого запуску |
| AC-26 | ubiquitous | Сторінка результатів повинна (shall) мати рівно два режими — Columns і Tabs + detail — перемикані одним контролем над одними й тими самими даними, без повторного запиту до API при перемиканні. | Компонентний тест: перемикання туди-сюди не збільшує лічильник fetch; обидва режими рендеряться з одного стану |
| AC-27 | ubiquitous | Режим Tabs + detail повинен (shall) показувати для кожної знахідки `confidence`, `suggested fix` і дії Accept, Dismiss, Learn, `Turn into eval case`. | Компонентний тест на присутність усіх полів і кнопок |
| AC-28 | unwanted | ЯКЩО натиснуто `Turn into eval case` або `Learn`, ТОДІ застосунок повинен (shall) показати помітну помилку з назвою уроку, який володіє ендпоїнтом, і НЕ вдавати успіх — доки відповідний ендпоїнт не існує. | Компонентний тест: клік → видиме повідомлення; grep підтверджує відсутність маршрутів `learn` і eval у `server/src/modules/*/routes.ts` (форма чесної заглушки з L04, `specs/L04-mcp-server.md`) |
| AC-29 | event-driven | КОЛИ рецензент вмикає `Show only conflicts`, блок `Where agents disagree` повинен (shall) сховати всі неконфліктні групи, а агент, який переглянув це місце й не позначив його, повинен (shall) відображатися підписом `did not flag`. | Компонентний тест: увімкнений перемикач лишає лише конфлікти; take з `verdict: 'ignored'` рендериться як `did not flag` (артборд `ma-cols`) |
| AC-30 | event-driven | КОЛИ рецензент повертається на сторінку Multi-Agent Review pull request, у якого вже є мультизапуск, застосунок повинен (shall) показати ОСТАННІЙ мультизапуск і кнопку `Start New Review`, а не порожній екран чи автозапуск. | e2e `11-multi-agent-review.flow.json` над **засіяним** мультизапуском (AC-36): перехід геть → повернення → колонки на місці, кнопка `Start New Review` присутня, нуль нових `agent_runs`. Флоу не запускає рев'ю: `e2e/CLAUDE.md` § Conventions забороняє крок, що може викликати модель, і в герметичному стеку немає ключа |
| AC-31 | unwanted | ЯКЩО у workspace немає жодного увімкненого агента, ТОДІ сторінка повинна (shall) показати порожній стан із CTA на `/agents`, а не порожню сітку колонок. | Компонентний тест на порожній список (артборд `e-ma`) |
| AC-32 | ubiquitous | Кожен файл `vendor/shared`, який змінює ЦЯ робота — `contracts/observability.ts`, `contracts/platform.ts` і `contracts/review-api.ts` — повинен (shall) бути байт-ідентичним у серверній і клієнтській копіях; решта дерева, що розійшлася раніше, до цього критерію не належить. | `cmp -s` окремо по кожному з цих трьох файлів; `pnpm typecheck` у `server/` і в `client/`; `scripts/pr-self-review-checks.sh` (`check:contract-mirror`) |
| AC-33 | ubiquitous | `client/src/vendor/ui/nav.ts` повинен (shall) отримати рівно один новий пункт `NAV` із `href` і `gKey`, і жоден інший файл під `client/src/vendor/ui/` не повинен (shall) з'явитися в дифі цієї роботи. | `git diff --name-only` проти `lesson-07`: під `vendor/ui/` рівно один шлях; тест сайдбару на новий пункт |
| AC-34 | ubiquitous | Диф цієї роботи повинен (shall) не містити жодного шляху під `ci/`, `agent-runner/`, `reviewer-core/`, `mcp/`, і не змінювати `server/src/modules/reviews/run-executor.ts`. | `git diff --name-only` проти `lesson-07`, звірений із розділом `Owned directories and files` |
| AC-35 | ubiquitous | Репозиторій повинен (shall) містити записаний замір «1 агент проти 3» на одному й тому самому pull request із фактичними числами: wall-clock кожного прогону, сумарні токени, сумарна вартість і кількість знахідок — із явною згадкою, що співвідношення не зобов'язане бути 3×. | Рядок у `docs/retro/ledger.md` з усіма чотирма числами для обох прогонів; ручний прогін, спостерігач звіряє числа з `GET /pulls/:id/runs` |
| AC-36 | optional | ДЕ увімкнено сід, він повинен (shall) створювати один завершений мультизапуск для демо-PR #482 із трьох увімкнених агентів, щоб сторінку можна було побачити без виклику моделі. | `pnpm db:seed` двічі поспіль; e2e-крок читає засіяні літерали — і `e2e/specs/*.json` треба грепнути на змінені значення (root `CLAUDE.md` § Gotchas) |
| AC-37 | state-driven | ПОКИ мультизапуск має щонайменше один агент, чий запуск не завершився статусом `done`, блок `Where agents disagree` повинен (shall) показувати, скільки агентів із загальної кількості цього мультизапуску враховано в розбіжностях. | Компонентний тест: три агенти, один `failed` → блок містить «2 of 3»; три `done` → рядок відсутній або каже «3 of 3» |

## Edge cases

- **Zero agents selected** → AC-21.
- **Zero agents enabled in the workspace** → AC-31.
- **One agent selected via the picker** — a multi-agent run of one. Deliberately still a
  multi-agent run (AC-04), because the "return to the last one" requirement needs a handle
  and a set of one is a set. The single-agent dropdown path stays separate (AC-05).
- **An agent id from another workspace, or a deleted agent** → AC-03. Note `agent_runs.agent_id`
  is `on delete set null` (`schema/runs.ts:11`), so a historical column can have no agent —
  it renders with the recorded provider/model and no name.
- **One agent fails, the rest succeed** → AC-13, AC-19.
- **Every agent fails** — the parent run exists, all columns are `failed`, groups and
  conflicts are empty. Covered by AC-13's shape; no separate criterion, because a page of
  four failed columns is the same code path as one.
- **Pre-work fails (diff load)** — `failAll` marks every queued run `failed`
  (`run-executor.ts:80-99`), so this is the "every agent fails" case with an identical
  message in each column. No separate criterion.
- **A run is cancelled mid-flight** → AC-12 (status), AC-19 (no `ignored` take).
- **The API restarts mid-run** — `reapStaleRuns()` marks the rows dead
  (`docs/architecture.md:180-181`), the live log is gone, the trace is not. Known
  limitation, not a criterion.
- **Two multi-agent runs started seconds apart** → AC-10.
- **A finding at a file:line nobody else reviewed** — not a conflict, because a conflict
  needs a second agent that finished (AC-18). It is a one-member group (AC-16).
- **Agents disagree on severity at the same line** → AC-18.
- **Many agents (7+) selected** — the design's grid falls back to horizontal scroll above
  five columns (`multi-agent-review.jsx:52-54`). Carried into the UI as given; no criterion,
  because the seed cannot produce seven agents and the check is visual.
- **`Turn into eval case` / `Learn` pressed** → AC-28.
- **Returning to a PR whose only runs are single-agent** → AC-09 (404 → empty state, not an
  error toast).

## Design analysis

Source: `reference/devdigest-design/src/features/agents/multi-agent-review.jsx` (screen key
`multi-agent-review`, artboards `ma-cols`, `ma-tabs`, `e-ma`), plus
`src/features/pull-requests/findings.jsx:41-99` (`FindingCard`, `ActionRow`),
`src/data/core-mock-data.jsx:422-455` (`PERSONAS`, `PERSONA_CONFLICTS`) and
`reference/devdigest-design/BRIDGE.md` § Navigation. Read, not imagined.

### States missing from the mockup

- **Every running state.** `PERSONAS` carries finished agents with a score, a duration and a
  cost; nothing in the artboard shows a column mid-flight. Column headers render
  `CircularScore` and `duration/cost` unconditionally (`multi-agent-review.jsx:12-19`), which
  are all null while a run is running. *Derived.*
  **Decided (2026-08-30, caller): elapsed time and a status chip; the score, duration and
  cost slots stay empty until the run reaches a terminal status.** No per-metric spinner.
  Elapsed time is the only number that is true while a run is in flight — score, duration and
  cost are null by construction — and the detail a spinner would stand in for is already one
  click away in `LiveLogStream` and `View trace` (AC-24, AC-25).
- **The failed column.** No artboard variant exists for an agent that errored, though
  isolation of that failure is the headline requirement. *Derived.*
- **The cancelled column.** Same, and the DB can produce it.
- **`Configure run` does not exist as an artboard at all.** The manifest lists three
  artboards for this screen and none of them is a picker. Agent selection, the estimate and
  the `Run multi-agent review (N)` button come from the brief, not from a design.
  *Every decision about this screen is derived.*
  **Decided (2026-08-30, caller): one component, two mount points.** `ConfigureRun` renders
  inline on the pull-request page with that PR already fixed and no PR selector, and as the
  landing state of the Multi-Agent Review route with the cheapest possible PR control. The
  brief's two items — "picker on the PR page" and "Configure run screen" — are two *places*,
  not two implementations; a second picker would be the same checkboxes, the same estimate and
  the same button written twice (`Simplicity review` §7).
- **`Start New Review` does not exist in the mockup.** It comes from the brief. *Derived.*
- **Grouped findings do not exist in the mockup.** `ColumnsView` renders each agent's own
  findings, and `TabsView` renders one agent's findings — nothing anywhere collapses "four
  agents said the same thing" into one item. This is a headline requirement with no artboard.
  *Derived.*
  **Decided (2026-08-30, caller): a badge on the finding card in Tabs + detail mode; no third
  block.** A card whose finding has group members carries a badge naming the agents that
  flagged the same place, expanding to each original text verbatim. Columns mode is untouched,
  and that is what makes the badge's claim checkable — the per-agent columns remain the
  primary record. Reasons: the design has columns and a conflicts block and nothing between
  them, so a third block would be invented rather than derived; and AC-15 / AC-16 require the
  members and their attribution to be *reachable and unaltered*, not to occupy a new surface.
- **`Turn into eval case` is not in the design's `ActionRow`.** It offers Accept, Dismiss,
  Learn, Reply to author (`findings.jsx:19-25`). The eval button is the brief's. *Derived.*
- **No empty/partial state for the conflicts block.** `ConflictsSection` maps a non-empty
  mock; three agents that agreed on everything render an empty section with a heading.
- **No loading state for the page itself**, and no state for "this PR has never had a
  multi-agent run".

### Corner cases the design does not cover

- Column count above five: `cols` is capped at 5 with `overflowX: auto`
  (`multi-agent-review.jsx:52-54`); nothing says what the sticky header does then.
- A column with zero findings renders an empty body between header and footer.
- A finding title long enough to wrap in a 220px minimum column
  (`AgentFindingMini` does not truncate, unlike the header's agent name at line 16).
- A conflict with a single take — impossible by AC-18's definition, but the design's grid
  `repeat(takes.length, 1fr)` would render a full-width single cell if one arrived.
- `did not flag` is styled as the negative case of `verdict` (`multi-agent-review.jsx:37`)
  with no room for "this agent never finished", which is exactly the distinction AC-19 makes.
- Cost is formatted `$0.06` with two decimals (`multi-agent-review.jsx:17`); the product's
  convention distinguishes `null` (unpriced model) from `0` (free) — root `INSIGHTS.md`
  2026-08-02 and `schema/runs.ts:22-27`. The mock has no null.
- The meta row hardcodes `"fan-out via worktrees"` (`multi-agent-review.jsx:47`) — a phrase
  about how the *lesson* was built, not about the product. It is not copied.

### How the involved modules talk

- The browser sends one `POST /pulls/:id/review` with the selected set. The server creates
  the parent row plus one `agent_runs` row per agent **before** returning
  (`service.ts:114-137`), so the response already carries every `run_id` and the
  `multi_agent_run_id`. Nothing about this ordering changes.
- Execution stays fire-and-forget inside `ReviewRunExecutor`. The browser subscribes to the
  returned run ids through the existing `useRunEvents(runIds: string[])`
  (`client/src/lib/hooks/reviews.ts:201-219`), which already opens one `EventSource` per run
  — this is why no new SSE channel is needed (see `Simplicity review` §2).
- When the SSE streams end, the page refetches `GET /pulls/:id/multi-agent`, which reads
  `agent_runs` + `reviews` + `findings` and computes columns, groups and conflicts in the
  service layer. Nothing derived is written back.
- `RunTraceDrawer` is mounted per column with that column's `run_id` and reads
  `GET /runs/:id/trace` — a path that already exists and is untouched.
- The one architectural question this raises: `RunTraceDrawer` currently lives under
  `client/src/app/repos/[repoId]/pulls/[number]/_components/`. Reusing it from a different
  route means either promoting it to a shared location or mounting the multi-agent view
  inside the PR route. That is a placement decision for the plan, constrained by
  `client/docs/component-anatomy.md` and the `frontend-architecture` skill — not a
  requirement, and this spec does not decide it.
- Onion direction is unchanged: routes → service → repository, and the multi-agent module
  reads its own repository rather than importing `reviews`' internals
  (`no-cross-module-import` is a *warning* that exits 0 — read the `arch:check` output, root
  `INSIGHTS.md` 2026-08-22).

### UX improvements proposed

*Proposals, not requirements — nobody plans these as work.*

1. Show the group's member count on the group header (`3 agents flagged this`), because the
   agreement of three agents is itself the strongest signal on the page and the mockup never
   surfaces it.
2. Render an unpriced model's cost as `—` with a tooltip rather than `$0.00`, matching the
   product's existing null-vs-zero convention.
3. Put the total cost of the fan-out next to `Start New Review`, so the price of repeating
   it is visible at the moment of deciding to.
4. Let a column header stay pinned while its findings list scrolls, since with five columns
   the agent's name leaves the viewport before its findings do.

## Simplicity review

The customer asked for the simplest thing that satisfies the brief. Each item below names
what adds weight, the lighter alternative, and what is lost by taking it. **No requirement is
removed from this spec by this section — the choice is the human's.**

**1. `POST /pulls/:id/multi-agent-run` is not needed. Recommended: drop it.**
The comment at `contracts/observability.ts:9,74` promises a dedicated create endpoint. But
`POST /pulls/:id/review` already resolves targets, creates run rows before returning and
fires the executor (`service.ts:103-137`), and it already carries the per-route rate limit
that matters here (`routes.ts:30`). A second endpoint would duplicate all of that to add one
row. **Simpler:** widen `RunRequest` with `agentIds` and add `multi_agent_run_id` to the
existing response (AC-01, AC-07). **Lost:** the contract comment becomes wrong and must be
edited; a future "start a multi-agent run without a PR" would have no natural home. Both are
cheap. *Recommendation: one create path, and fix the comment.*

**2. No new SSE channel. Recommended: none, confidently.**
A "multi-agent stream" would need its own bus, its own replay buffer and its own reconnect
story. `useRunEvents` already takes `runIds: string[]` and opens one `EventSource` each
(`client/src/lib/hooks/reviews.ts:201-219`) — the multiplexing the requirement needs is
shipped and in use by `RunTraceDrawer`. **Lost:** N connections instead of one for N agents.
With a realistic ceiling of five agents this is not a problem worth a new platform primitive.

**3. Groups and conflicts stay derived. Recommended: derived, as the contract already says.**
`Conflict` is documented "Computed from persisted findings; not stored"
(`contracts/observability.ts:61-65`), and nothing in the requirements contradicts it: no
requirement asks to *edit* a group, to *dismiss a whole group*, or to see how grouping
changed over time. Persisting them would add two tables, two migrations and a staleness
problem the moment a finding is accepted or dismissed. **Simpler:** compute on read (AC-14).
**Lost:** the read does more work per request, and grouping cannot be tuned retroactively
without changing what old runs display. Both are acceptable for a local studio over one PR's
findings. *Caveat:* if a later lesson adds "dismiss this whole group", it needs a group
identity, and that is when a table is earned — not before.

**4. One page component with a toggle, not two. Recommended: one.**
The design itself does this: `ScreenMultiAgent` holds `v` in state and branches between
`ColumnsView` and `TabsView` over the same `agents` array
(`multi-agent-review.jsx:91-106`). Two route-level components would fetch twice and drift.
**Simpler:** one container owning the data, two presentational children, one toggle (AC-26).
**Lost:** nothing identified.

**5. The estimate should not get a new aggregate. Recommended: derive from existing history,
but the brief's wording is the loosest thing in it.**
There is no `/agents/:id/stats` endpoint (`modules/agents/routes.ts:76-177`) and `AgentStats`
is an unimplemented contract. Building a per-agent aggregate service for a number shown above
a button is the single largest piece of avoidable work in this spec. `GET /pulls/:id/runs`
already returns `duration_ms`, `cost_usd` and `agent_id` per past run
(`run.repo.ts:39-68`). **Simpler:** average the completed runs already visible for this PR
(falling back to the workspace's recent runs for that agent), computed in the multi-agent
service, and label it an estimate (AC-23). **Lost:** the estimate is coarse and, for an agent
that has never run on this PR, absent (AC-22 makes that honest rather than a fake zero).
*This is the requirement I would push back on hardest: "оцінка за минулими запусками" is
worth roughly ten lines, and any reading of it that costs more than that is over-reading it.*

**6. The `1 vs 3` measurement belongs in the spec as a criterion — but a criterion about the
record, not about the ratio.** Two readings were considered. As "the fan-out is ≈3× faster"
it is unfalsifiable *and* wrong: the lab explicitly warns the ratio is not 3× because the
diff and intent are prepared once for the whole batch (`run-executor.ts:100-116`) and answer
lengths differ. As "a measurement with real numbers exists in `docs/retro/ledger.md`" it is a
thing a human can pass or fail by reading one file. AC-35 is the second reading. It stays an
AC rather than a loose verification step because it is a graded deliverable of the lab
(`L07-lab.md` § Фінальна перевірка), and anything not carrying an `AC-NN` is not tracked by
`plan-verifier`.

**7. A new top-level route may be more than is needed.** The design puts Multi-Agent Review
in the global nav with its own breadcrumb, and the brief asks for a `nav.ts` entry — so the
route is in scope. But everything it shows belongs to one pull request, `RunTraceDrawer` and
the findings components live under the PR route today, and a tab on the PR page would need no
route, no repo/PR selector and no promotion of shared components. **Simpler alternative:** a
`?tab=multi-agent` panel on the existing PR page, with the nav entry pointing at the PR
list. **Lost:** the design's screen composition, and the "pick a PR" step of Configure run.
*Recommendation: keep the route (the nav entry is an explicit requirement and B depends on
this file being settled), but treat the "select a PR" part of Configure run as the cheapest
possible control, not a second PR browser.*

**8. `AgentStats` and `CuratorResult` sit in the file we own and tempt.** They are L08's and
L07-memory's respectively. Leaving them untouched costs nothing; implementing either doubles
this diff. *Recommendation: touch neither.*

## Non-functional requirements

| Limit | Value | Why this number |
|---|---|---|
| Model calls made by `GET /pulls/:id/multi-agent` | 0 | It is a projection of persisted rows. Any number above zero makes opening a results page cost money — the same rule `GET /pulls/:id/brief` already lives by (`specs/L05-pr-brief.md` AC-02) |
| Model calls made by grouping and conflict detection | 0 | See `Simplicity review` §3; grouping is a deterministic text rule (AC-17) |
| New DB tables | 0 | `multi_agent_runs` exists; everything else is derived (AC-14) |
| New DB columns | 1 | `agent_runs.multi_agent_run_id` (AC-06). A second one would need its own justification |
| Rate limit on the run trigger | unchanged: `{ max: 10, timeWindow: '1 minute' }` | Already on `POST /pulls/:id/review` (`routes.ts:30`) and a multi-agent request is the same fan-out it was written for. Note the limiter is not registered under `NODE_ENV=test` (`server/INSIGHTS.md` 2026-08-30), so this cannot be exercised by an ordinary integration test |
| Agents selectable in one run | every agent in the workspace; no new cap | **Decided (2026-08-30, caller): the existing rate limit is the only bound.** The seed has five (`seed.ts:565-623`), the workspace's enabled-agent count already bounds one request, and `{ all: true }` has been unbounded in exactly this way since before this work. A cap would be a new mechanism nobody asked for, with a number nobody can justify |
| Concurrent SSE connections held by the results page | one per column | The existing multiplexer's shape (`reviews.ts:201-219`); with five columns this is five |

## Inputs and provenance

| Input | Where it comes from | When it is stale | If missing |
|---|---|---|---|
| Selected agent ids | The reviewer's checkboxes | Immediately, if an agent is deleted between picking and running | 400 (AC-02) / 404 (AC-03) |
| Agent list for the picker | `GET /agents` (`modules/agents/routes.ts:76`) via `useAgents` | On any agent edit | Empty state with a CTA (AC-31) |
| Duration / cost estimate | Completed `agent_runs` rows (`run.repo.ts:39-68`) | As soon as a model's price or an agent's prompt changes | Shown as "no data yet" (AC-22) |
| Columns, groups, conflicts | `agent_runs` + `reviews` + `findings` of one `multi_agent_runs` row | Never — recomputed on every read (AC-14) | 404 when the PR has no multi-agent run (AC-09) |
| Live per-column status | `RunBus` SSE (`platform/sse.ts`, `routes.ts:93-135`) | Lost on API restart — known limitation | Column falls back to its persisted `agent_runs.status` |
| Run trace | `GET /runs/:id/trace`, from `run_traces` | Written once at completion; never stale | The drawer's existing behaviour, unchanged |
| Finding text, confidence, suggested fix | `findings` rows written by the grounding gate | Never | A group with no members is impossible (AC-16) |
| Eval-case creation | **Does not exist.** No eval route (`server/src/db/schema/eval.ts` has tables, `modules/*/routes.ts` has no route) | — | Loud, visible failure naming L06 (AC-28) |
| `Learn` action | **Does not exist.** `FindingActionKind` includes `learn` (`contracts/findings.ts:120`) but the route registers only accept/dismiss (`routes.ts:20,192`) and the service throws 400 (`findings.ts:31-32`) | — | Loud, visible failure naming L07's memory half (AC-28) |

## Untrusted inputs

Nothing in this change reaches a model's prompt: the read path makes zero model calls
(`Non-functional requirements`), and the write path hands the same inputs to the same
executor it hands them to today. What is new is that **more agent-authored text reaches one
screen at once** — finding titles, rationales and suggested fixes from up to five models,
now grouped and juxtaposed. That text is derived from the pull request's diff, which is
untrusted by definition (`docs/glossary.md` § Untrusted block), and it is rendered as data:
a group heading, a conflict note or a `did not flag` label is never a control the UI obeys.
A finding whose title reads like an instruction is displayed and never acted on.

The grouping rule reads the same text to decide sameness (AC-17). It is a deterministic
string comparison, so a crafted finding title can at worst place itself in the wrong group —
it cannot change what any other component does.

This spec itself is repository content. Should a later feature attach spec files to a prompt,
this file is data in that prompt, not direction.

## Test plan

| Lane | Covers |
|---|---|
| server unit (`vitest run --exclude '**/*.it.test.ts'`) | the grouping rule (AC-15, AC-16, AC-17), conflict detection incl. the `done`-only rule (AC-18, AC-19), estimate arithmetic (AC-23) |
| server integration (`vitest run .it.test`, needs Docker) | request-shape validation (AC-01, AC-02, AC-03), parent-run creation and linkage (AC-04, AC-05, AC-07), migration compatibility incl. a `source='ci'` insert (AC-06), the read endpoint and its 404 (AC-08, AC-09), deterministic latest (AC-10), columns and statuses (AC-11, AC-12), failure isolation (AC-13), no writes on read (AC-14) |
| client component (RTL, `client && pnpm test`) | picker and button label (AC-20, AC-21), estimate states (AC-22, AC-23), per-column live status (AC-24), trace drawer wiring (AC-25), one component two modes (AC-26), detail fields and actions (AC-27), the two loud stubs (AC-28), conflicts toggle and `did not flag` (AC-29), empty state (AC-31), nav entry (AC-33) |
| e2e (`e2e && pnpm e2e:hermetic`) | the return-visit flow: run → navigate away → return → last run + `Start New Review` (AC-30), over the seeded multi-agent run (AC-36) |
| shell / grep | contract mirror byte-identity (AC-32), diff-boundary discipline (AC-33, AC-34), absence of new polling (AC-24) |
| manual | the 1-vs-3 measurement (AC-35) |

`@testing-library/user-event` is **not installed** in `client/` (`client/INSIGHTS.md`
2026-08-22) — component tests use `fireEvent`. `client/` runs with
`noUncheckedIndexedAccess`, which `pnpm test` cannot see (`client/INSIGHTS.md` 2026-08-30),
so `pnpm typecheck` is not optional there. Adding files to the `.it.test` lane is a load
change, so a previously green lane does not predict a green one (`server/INSIGHTS.md`
2026-08-28).

**Deliberately not covered by an automated test:** the 1-vs-3 measurement (AC-35) — it needs
real model calls against real money and a real clock, so a test could only assert that a file
has numbers in it, which is what a human reading `docs/retro/ledger.md` does better. The
column layout above five agents, and the visual parity with artboards `ma-cols` / `ma-tabs` /
`e-ma` — checked by eye against the design reference at review time. The rate limit on the
run trigger — the limiter is not registered under `NODE_ENV=test`.

## Verification commands

Run in the worktree before opening the pull request. **Read the output of `arch:check`, never
its exit code** (root `INSIGHTS.md` 2026-08-22): its cross-module rule is a warning and
dependency-cruiser exits 0 on warnings.

```sh
cd server && pnpm typecheck
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd server && pnpm exec vitest run .it.test          # needs Docker
cd server && pnpm arch:check                        # read the OUTPUT; empty output is the pass
cd server && pnpm db:migrate                        # manual; migrations do NOT run on boot

cd client && pnpm typecheck                         # catches what pnpm test cannot
cd client && pnpm test

cd e2e && pnpm e2e:hermetic                         # ports 5433/3101/3100

# contract mirror — per file, not per tree
cmp -s server/src/vendor/shared/contracts/observability.ts \
       client/src/vendor/shared/contracts/observability.ts
cmp -s server/src/vendor/shared/contracts/platform.ts \
       client/src/vendor/shared/contracts/platform.ts
cmp -s server/src/vendor/shared/contracts/review-api.ts \
       client/src/vendor/shared/contracts/review-api.ts

# boundary discipline (AC-33, AC-34)
git diff --name-only lesson-07...HEAD | grep -E '^(ci/|agent-runner/|reviewer-core/|mcp/)' # expect no output
git diff --name-only lesson-07...HEAD | grep '^client/src/vendor/ui/'                      # expect only nav.ts
```

Then `/pr-self-review` (a PreToolUse hook blocks `gh pr create` until it passes; the
emergency door is `DEVDIGEST_SKIP_PR_REVIEW=1`), and open the pull request **against
`lesson-07`**. `reviewer-core` and `mcp` are untouched, so their suites are unchanged — run
them only if the diff proves otherwise.

## Known limitations

- **The live log does not survive an API restart.** `RunBus` is in memory by design
  (`docs/architecture.md:174-181`); the durable record is the `run_traces` document, written
  even on failure and cancellation. Not a bug, not this stream's work.
- **Agents run one after another, not at once.** The columns fill sequentially, so a
  three-agent run takes roughly three single-agent runs minus the shared diff and intent
  (`run-executor.ts:106,120`). This is the third and largest reason AC-35's ratio is what it
  is, and the measurement must say so. Making it concurrent is one `Promise.allSettled` away
  and was deliberately declined for this stream (`Non-goals`).
- **The estimate is coarse.** It averages completed runs and cannot know that an agent's
  prompt or model changed since (`Inputs and provenance`). It is labelled an estimate.
- **`Turn into eval case` and `Learn` are broken on purpose** until L06 and the memory work
  land. They fail loudly rather than silently, in the shape L04 used for `get_blast_radius`
  (`specs/L04-mcp-server.md`).
- **Grouping cannot see semantic sameness.** Two agents describing the same defect in
  unrelated words at different lines will be two groups. That is the price of zero model
  calls at read time, and it is the right price here.
- **Per-skill attribution is still impossible.** Nothing persists which skill produced a
  finding (root `INSIGHTS.md` 2026-08-12), so a column is attributable to an agent and never
  to the skill it carries.
- **Cancelled and failed agents are absent from conflicts** (AC-19). This is deliberate — the
  page cannot claim an agent "did not flag" something it never looked at — but it means the
  conflicts block narrows when a run fails. **Decided (2026-08-30, caller): it says so.** The
  block carries one line naming how many of the run's agents completed. Silent narrowing would
  make `did not flag` indistinguishable from `did not run`, which is the exact distinction
  AC-19 exists to protect; one line is what it costs to keep it. See AC-37.

## Risks

| Risk | How we would notice | What we do |
|---|---|---|
| The grouping heuristic the brief calls "ready" does not exist, so it is unplanned work sitting inside a stream that believes it is only wiring | Confirmed, not suspected: nothing matches on `upstream/lesson-7-lab/multiagents-start` (`ca62cbe`) or in this tree — evidence in `Open questions` §1 | Treat it as build, not integrate, and budget for it. It is bounded by AC-15 … AC-17 and by the zero-model-call limit, which is what keeps it small |
| The `RunRequest` widening breaks the single-agent path used by every existing review | `reviews.it.test.ts` regressions; `pnpm typecheck` in both packages | AC-01 pins the old behaviour; the widening is additive, and a `.default()` is deliberately **not** used — a defaulted field is optional on input but REQUIRED on `z.infer`, which breaks every literal in both packages (root `INSIGHTS.md` 2026-08-29) |
| The mirror edit is made in one copy only | `pnpm typecheck` in `client/`; `check:contract-mirror` in `/pr-self-review` | AC-32; `cmp` per file before committing |
| The migration collides with L07-B's | A conflict in `server/src/db/migrations/` at step 3 of the merge order | Only one stream generates migrations at a time (`WORKING-ORDER.md`); A goes first |
| `agent_runs` gains a NOT NULL column and B's CI ingest can no longer insert | B's ingest tests fail after step 3 | AC-06 makes the column nullable and tests a `source='ci'` insert without it |
| Reusing `RunTraceDrawer` from a new route drags PR-page internals into a shared location | `pnpm arch:check` output (client is not cruised — so this one is caught by review, not by a tool) | Placement is a plan decision constrained by `client/docs/component-anatomy.md`; the spec does not pre-empt it |
| The e2e flow asserts seed literals that the seed edit changes | `e2e && pnpm e2e:hermetic` fails far from the cause | After editing `seed.ts`, grep `e2e/specs/*.json` for the changed values (root `CLAUDE.md` § Gotchas) |
| The 1-vs-3 measurement gets written to match the expected 3× | A ledger row whose numbers are suspiciously round | AC-35 requires four measured numbers per run and an explicit note that 3× is not expected |
| Scope creep into `AgentStats` / Agent Performance because the contract is in our file | The diff grows a chart | `Out of scope`, `Simplicity review` §8 |

## Open questions

1. **Answered — the finding-grouping heuristic does not exist and is this stream's work.**
   The brief and the lab both list it as ready infrastructure ("готова евристика ... за файлом,
   рядками та схожістю суті", `L07-lab.md` § Частина 1). That is false of the starting
   tree. On `upstream/lesson-7-lab/multiagents-start` (`ca62cbe`) — the branch the lab starts
   from — no path matches `group`, `cluster`, `similar`, `multi-agent` or `conflict`, and
   `server/src/modules/` contains no multi-agent module. The same holds here: the only
   near-neighbours in this tree are `ruleKey` / `dedupeCandidates`
   (`server/src/modules/conventions/helpers.ts:263,279`), which normalise **convention
   rules** rather than findings, and `reduceReviews`
   (`reviewer-core/src/review/reduce.ts:43-55`), which concatenates findings with no dedupe.
   The heuristic is therefore **built by this stream** and is listed in
   `Owned directories and files`. AC-15 … AC-17 stand unchanged: they constrain it by its
   properties — determinism, zero model calls, no loss of the originals or their attribution
   — and deliberately do not name an implementation.
2. **Answered — `ConfigureRun` is one component with two mount points**, inline on the PR page
   (PR fixed, no selector) and as the landing state of the route. Reasoning in
   `Design analysis` § States missing from the mockup.
3. **Answered — grouped findings are a badge on the finding card in Tabs + detail mode**, not a
   third block; the per-agent columns stay the primary record. Reasoning in `Design analysis`.
4. **Answered — a running column shows elapsed time and a status chip**; score, duration and
   cost stay empty until the run is terminal. Reasoning in `Design analysis`.
5. **Answered — no cap.** The rate limit already on `POST /pulls/:id/review` is the only bound;
   see `Non-functional requirements`.
6. **Answered — the conflicts block reports how many agents completed** (AC-37). Reasoning in
   `Known limitations`.
7. **Answered — one create endpoint, not two.** `POST /pulls/:id/multi-agent-run`, promised
   by the comment at `contracts/observability.ts:9,74`, is not built; `POST /pulls/:id/review`
   is widened instead and returns `multi_agent_run_id`. Reason in `Simplicity review` §1. The
   stale comment is corrected as part of the contract edit.
8. **Answered — a multi-agent run of one is still a multi-agent run.** A request of the
   `agentIds` form creates the parent row regardless of set size (AC-04), because "return to
   the last multi-agent run" needs a handle; the legacy `{ agentId }` form does not (AC-05).
9. **Answered — the 1-vs-3 measurement is an acceptance criterion**, phrased as "a record
   with four measured numbers per run exists", not as a ratio. Reason in
   `Simplicity review` §6.
10. **A decision for the human, not for this spec: a complete reference solution exists.**
    `upstream/lesson-7-lab/multiagents-finish` (`af92aa8`) is the finished lab with **both**
    worktrees already merged, and it carries exactly the pieces this spec describes:
    `server/src/modules/reviews/multi-agent-conflicts.ts`,
    `server/src/modules/reviews/multi-agent-service.ts`, and the client tree
    `client/src/app/multi-agent-review/**` (`ConfigureRun/`, `ColumnsView/`, `TabsView/`,
    `DisagreeBlock/`, `FindingCard/`, `MultiAgentLanding/`, `AgentSummary/`, `ResultsView/`)
    with `client/messages/en/multiAgentReview.json`. Whether to write this stream's version
    first and compare afterwards, to read it up front, or to ignore it, is a choice about how
    the lesson is learned — it changes no requirement in this file, and this spec takes no
    position on it. Note only that the branch also contains **worktree B's** work, so copying
    from it wholesale would breach this stream's boundaries (`Owned directories and files`).

11. **Answered — new vocabulary needs glossary entries.** *Multi-agent run*, *finding group*
    and *conflict* are not in `docs/glossary.md` § Review objects. Adding them is
    `doc-writer`'s work, not this spec's, and is noted here so it is not lost.
