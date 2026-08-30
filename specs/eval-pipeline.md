# Eval Pipeline — regression protection for the product's own review agents

Spec ID: EVAL-PIPELINE
Status: in-progress
Supersedes: none
Owner: devsiteua
Packages touched: server, client, reviewer-core (read-only reuse), e2e

> Every section stays, even when the honest answer is "none". A deleted section reads as an
> oversight; the word "none" is a claim someone can disagree with.
> The implementation plan does **not** live here — it lives in `plans/eval-pipeline.md`
> alongside this file. See `README.md` § Where plans live.

## Problem and user

The person who tunes a review agent in DevDigest has no way to tell whether a change to its
system prompt, its model or its attached skills made it better or worse. They edit
`agents.system_prompt` (`server/src/db/schema/agents.ts:17`), run the agent on a pull request,
read the findings, and form an impression. The evidence that would settle it already exists
and is already persisted — every finding they ever accepted or dismissed is a decision on
disk (`findings.accepted_at` / `findings.dismissed_at`,
`server/src/db/schema/reviews.ts:55-56`) — but nothing replays it. Meanwhile the tables that
would hold such a replay have been sitting empty since day 1 (`eval_cases`, `eval_runs` in
`server/src/db/schema/eval.ts:7,22`), the contracts for them are written
(`server/src/vendor/shared/contracts/eval-ci.ts:20-89`), and the root `INSIGHTS.md` entry of
2026-08-12 records a shipped feature degraded specifically because this pipeline does not
exist yet ("Making it real needs a persisted skill↔run link, which is L06's eval pipeline").
The cost is silent regression: a prompt edit that loses a whole class of finding looks
identical, from the outside, to one that fixes it.

## Goals / Non-goals

**Goals**

1. A finding that already carries a decision can be turned into an eval case in one click,
   and the expectation type follows from that decision rather than from a form field.
2. An agent's whole case set is visible in one place, and can be run in one action.
3. A run is a persisted, comparable entity: it carries a snapshot of the system prompt and
   model it ran under, so that two runs of different agent versions mean something when put
   next to each other.
4. `recall`, `precision` and `citation_accuracy` are computed by code alone — no model is
   asked to judge anything, at any point in scoring.
5. Two runs can be compared side by side, and a deliberate system-prompt change visibly moves
   the numbers between them.
6. The whole set is reproducible on a clean machine: a seeded workspace already carries
   enough decided findings to build a set of eight, and `pnpm verify:l06` is green without
   Docker.

**Non-goals**

- **A model-judged eval.** The lab's harness needed an LLM judge because "explained the
  reason" is not a substring match. Here an expectation is a `file` plus a line range, and a
  match is set intersection. Introducing a judge would reintroduce the variance this feature
  exists to remove.
- **A quality score.** The output is three named ratios with published denominators, not a
  single number that averages them into something that reads as the agent's grade.
- **A pass/fail gate.** Nothing in this pass blocks a review, a commit or a PR on an eval
  result. Thresholds are a later decision; this pass establishes the measurement.
- **Skill-level evals.** `eval_cases.owner_kind` is `['skill','agent']` and stays that way,
  but nothing in this pass writes `skill` — see `Out of scope`.

## Context

What already exists and is therefore not built again.

| Already true | Where |
|---|---|
| `eval_cases` and `eval_runs` tables exist and are empty; `eval_runs` keys on `case_id` only | `server/src/db/schema/eval.ts:7,22` |
| `eval_runs` carries `recall`, `precision`, `citation_accuracy`, `duration_ms`, `cost_usd`, `pass` | `server/src/db/schema/eval.ts:29-34` |
| `EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard` are written | `server/src/vendor/shared/contracts/eval-ci.ts:20-89` |
| `EvalRun`, `EvalPerTrace`, `EvalCase`, `EvalOwnerKind` are the base shapes | `server/src/vendor/shared/contracts/knowledge.ts:50-84` |
| `EvalRun.recall/precision/citation_accuracy` are `z.number().min(0).max(1)` — they cannot carry `null` | `server/src/vendor/shared/contracts/knowledge.ts:58-61` |
| Both barrels already export `eval-ci.js`; neither needs editing | `server/src/vendor/shared/index.ts:25`, `client/src/vendor/shared/index.ts:25` |
| The eval section of the contract mirror is **already in sync**; the two copies differ only in `AgentManifest` (L07-B's) and `ConformanceInput.provider` | `diff server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts` |
| `FindingCard` renders accept/dismiss and reflects the persisted decision | `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:79-139` |
| A decision is persisted as two nullable timestamps, not an enum | `server/src/db/schema/reviews.ts:55-56` |
| The grounding gate is pure code, and already returns both halves of the ratio | `reviewer-core/src/grounding.ts:52` (`groundFindings` → `{ kept, dropped }`) |
| A review run already reports its grounding outcome | `reviewer-core/src/review/run.ts:104` (`ReviewOutcome.grounding`, `ReviewOutcome.dropped`) |
| The review engine takes a parsed `UnifiedDiff` and an injected `llm`, and does no I/O of its own | `reviewer-core/src/review/run.ts:45-101` (`ReviewInput`) |
| An agent already carries a `version` integer and a per-version config snapshot | `server/src/db/schema/agents.ts:38,44` (`agents.version`, `agent_versions`) |
| A deterministic LLM stand-in exists for tests | `server/src/adapters/mocks.ts:58` (`MockLLMProvider`) |
| `verify:l03` is the shape a lesson verify script takes: one `vitest run` over unit tests | `server/package.json:15` |
| The sidebar's future `eval` entry is designed but deliberately absent from `NAV` | `client/src/vendor/ui/nav.ts:26-30` (the comment naming it a later lesson) |

**Where the incoming brief is wrong, corrected here.** The brief states the design catalog
names an Eval Dashboard screen for agents. It does not. `reference/devdigest-design` carries
an `agent-evals` artboard that is a bare case list, and a full Eval Dashboard artboard that
is scoped to a **skill**. There is no artboard anywhere for a side-by-side run comparison.
See `Design analysis`.

## In scope

- A **run batch** as a persisted entity: an eval run of an agent over its whole case set,
  carrying the agent, a snapshot of the system prompt and model it ran under, its aggregate
  metrics, and whether it completed. `eval_runs` rows attach to it. This needs a schema
  change and therefore a generated migration (`server/src/db/schema/eval.ts` + `pnpm
  db:generate`).
- An **expectation schema** added to the eval section of
  `server/src/vendor/shared/contracts/eval-ci.ts`, giving `expected_output` (today
  `z.unknown()`) a real shape: expectation kind (`must_find` | `must_not_flag`), file, line
  range. Mirrored verbatim into `client/src/vendor/shared/contracts/eval-ci.ts`.
- **Case creation from a finding** — a control on `FindingCard` that stores the whole PR diff
  as a snapshot, the derived expectation, and the originating finding id as provenance.
- **A run route** on the agent (`POST /agents/:id/eval-runs` in the brief's proposal), which
  executes the agent over every case in its set from the frozen snapshots.
- **Scoring in pure code**: file equality plus line-range intersection, over the findings the
  run produced; `citation_accuracy` read off the grounding gate that already runs.
- **Read surfaces**: the `Evals` tab in `AgentEditor` (case list + run history with per-row
  metrics), an `Eval Dashboard` page reached from the sidebar, and a comparison of two runs.
- **One point commit to `client/src/vendor/ui/nav.ts`** adding the Eval Dashboard item — the
  single authorised exception to the vendored-UI rule, per the caller.
- **Seed extension** so a seeded workspace carries, on one seeded agent, at least eight
  findings with real decisions **and** at least eight eval cases built from them. These are
  two different populations: eight decided findings do not become eight cases by themselves,
  and nothing else writes `eval_cases` during a seed. The same extension attaches the demo
  review to a seeded agent — the review inserted at `server/src/db/seed.ts:445-458` sets no
  `agent_id`, while `eval_cases.owner_id` is `notNull` (`server/src/db/schema/eval.ts:13`), so
  without that link a seeded finding has no set to join. Each addition guarded on its own
  absence.
- **`verify:l06`** in `server/package.json`, shaped like `verify:l03`.

## Out of scope

- **`ci/`, `agent-runner/` and the multi-run service** — L07 owns them. Touching them here
  would put two streams in the same files at the same time.
- **The `AgentManifest` section of `contracts/eval-ci.ts`, in both copies** — L07-B owns it
  and syncs its own mirror. This stream owns the eval section only. The copies already differ
  there (`AgentManifest` is absent from the client, `ConformanceInput.provider` differs);
  closing that drift is not this stream's to close.
- **`client/src/vendor/ui/**` beyond the single `nav.ts` entry** — vendored design system.
- **Stretch: an eval for our own skill in `evals/`** — stretch, no deadline.
- **Stretch: a manual Case Editor (create/edit a case by hand)** — stretch, no deadline. This
  is why case rows are view-and-delete in this pass and not editable.
- **Stretch: metric trend charts on the Evals tab** — stretch, no deadline. The
  `skill-evals` artboard has one and this tab deliberately does not; `EvalTrendPoint` and
  `EvalDashboard.trend` stay in the contract unfilled rather than being deleted.
- **Stretch: a `PreToolUse` test gate hook in `.claude/settings.json`** — stretch, no
  deadline, and a harness concern rather than a product one.
- **Stretch: mutation testing over a DevDigest module** — stretch, no deadline.
- **A per-case Run action.** The design's case row offers one; a run is defined over the
  whole set so that its metrics have a stable denominator, and a one-case run would produce a
  batch that cannot be compared with any other.
- **Thresholds, alerts and CI blocking on an eval result.** `EvalDashboard.alert` exists in
  the contract and stays `null` in this pass.
- **Skill-owned eval cases.** `owner_kind` keeps both members so a later stream inherits the
  slot; nothing here writes or runs `skill`.

## User stories

- As the person tuning an agent, I want to turn a finding I already accepted into a "must
  find X at file:line" expectation in one click, so that my past judgement becomes a test
  instead of a memory.
- As the person tuning an agent, I want a finding I dismissed to become a "must not flag Y"
  expectation, so that the noise I rejected once cannot come back unnoticed.
- As the person tuning an agent, I want to run the agent over its whole case set and read
  `recall` / `precision` / `citation_accuracy`, so that "better" is a number and not an
  impression.
- As the person tuning an agent, I want to change the system prompt, run again, and put the
  two runs side by side, so that I can see which expectations changed state and not merely
  that a score moved.
- As someone who arrives at a freshly seeded database with no design, no history and no
  answers, I want the product to already contain enough decided findings to build a set, and
  a `Run` control that is disabled with a reason rather than one that fails, so that I can
  learn what this feature does without first producing months of review history.

## Acceptance criteria (EARS)

| AC-ID | Pattern | Criterion | How it is checked |
|---|---|---|---|
| AC-01 | ubiquitous | Набір eval-кейсів засіяного агента повинен (shall) містити щонайменше 8 кейсів одразу після `pnpm db:seed`, без жодного ручного кліку. | `cd server && pnpm db:seed`, потім `pnpm exec vitest run .it.test` — інтеграційний тест лічить `eval_cases` засіяного агента; manual run: вкладка Evals показує ≥8 рядків на щойно засіяній базі. |
| AC-02 | event-driven | КОЛИ користувач натискає «Turn into eval case» на знахідці, що має рішення, система повинна (shall) створити eval case одним кліком і вивести тип очікування з рішення: `accepted` → `must_find`, `dismissed` → `must_not_flag`. | Інтеграційний тест `*.it.test.ts` на обидва рішення; e2e-флоу: клік на accepted-знахідці й на dismissed-знахідці, перевірка типу очікування в наборі. |
| AC-03 | unwanted | ЯКЩО знахідка не має ані `accepted_at`, ані `dismissed_at`, ТОДІ система повинна (shall) залишити кнопку створення кейса вимкненою й пояснити, що спершу треба прийняти або відхилити знахідку. | Компонентний тест `FindingCard` (`cd client && pnpm test`) на три стани знахідки. |
| AC-04 | unwanted | ЯКЩО для знахідки eval case уже існує, ТОДІ система повинна (shall) не створювати другий кейс, а привести користувача до наявного. | Інтеграційний тест: два послідовні виклики створення дають один рядок у `eval_cases`; manual run: повторний клік відкриває той самий кейс. |
| AC-05 | event-driven | КОЛИ створюється eval case, система повинна (shall) зберегти знімок **усього diff** цього pull request, а не лише файла чи ханка знахідки, і записати id знахідки-джерела як походження. | Інтеграційний тест звіряє збережений `input_diff` з повним diff PR і читає id знахідки з `input_meta`. |
| AC-06 | unwanted | ЯКЩО diff pull request перевищує 100 000 символів, ТОДІ система повинна (shall) відмовити у створенні кейса з повідомленням, що називає межу, і за жодних умов не обрізати diff. | Юніт-тест межі (входить у `pnpm verify:l06`) + інтеграційний тест на відповідь маршруту. |
| AC-07 | ubiquitous | Eval case повинен (shall) залишатися незмінним знімком: видалення pull request чи знахідки-джерела його не видаляє. | Інтеграційний тест: видалити PR, перечитати набір — кейс на місці й проганяється. |
| AC-08 | event-driven | КОЛИ користувач видаляє eval case, система повинна (shall) прибрати його з набору разом із його рядками прогонів. | Інтеграційний тест на каскад `eval_cases` → `eval_runs`; manual run: рядок зникає зі вкладки Evals. |
| AC-09 | ubiquitous | `pnpm db:seed` повинен (shall) залишати у робочому просторі щонайменше 8 знахідок із реальними рішеннями, щонайменше 8 побудованих із них eval-кейсів і демо-рев'ю, прив'язане до засіяного агента, причому кожне додавання оновлюється на місці на вже засіяній базі, без перестворення тому. | `cd server && pnpm db:seed` двічі поспіль на наявній базі, потім `pnpm exec vitest run .it.test` — лічильники рішень і кейсів ≥8, жоден не подвоюється, `reviews.agent_id` демо-рев'ю не порожній. |
| AC-10 | event-driven | КОЛИ користувач запускає прогін набору, система повинна (shall) створити прогін як окрему збережену сутність зі знімком system prompt і моделі, під якими він відбувся. | Інтеграційний тест: змінити `agents.system_prompt` між двома прогонами, прочитати обидва знімки — вони різні й збігаються з промптом на момент запуску. |
| AC-11 | ubiquitous | Прогін повинен (shall) виконувати агента на всіх кейсах набору із зафіксованих знімків, так що два прогони одного кейса отримують байт-у-байт однаковий вхід. | Юніт-тест над збиранням входу (в `pnpm verify:l06`): двічі побудований вхід одного кейса рівний як рядок. |
| AC-12 | unwanted | ЯКЩО у агента немає жодного eval-кейса, ТОДІ система повинна (shall) залишити керування запуском вимкненим. | Компонентний тест вкладки Evals на порожньому наборі (`cd client && pnpm test`). |
| AC-13 | unwanted | ЯКЩО для агента вже триває прогін, ТОДІ система повинна (shall) відхилити другий запит із названою причиною, а не ставити його в чергу. | Інтеграційний тест: два запити поспіль, другий повертає відмову; у базі один активний прогін. |
| AC-14 | unwanted | ЯКЩО окремий кейс не відпрацював, ТОДІ система повинна (shall) зберегти прогін як неповний, з метриками лише по кейсах, що відпрацювали, і з позначкою неповноти. | Інтеграційний тест із `MockLLMProvider`, що кидає на одному кейсі: прогін збережено, позначка неповноти стоїть, знаменник менший за розмір набору. |
| AC-15 | state-driven | ПОКИ прогін триває, система повинна (shall) не утримувати користувача на відкритому HTTP-запиті й показувати стан прогону, доки він ще йде. | Інтеграційний тест: маршрут запуску відповідає до завершення прогону, і стан прогону читається окремим запитом; manual run: сторінка показує прогін у роботі. |
| AC-16 | ubiquitous | Один прогін повинен (shall) охоплювати не більше ніж 50 кейсів. | Юніт-тест межі в `pnpm verify:l06`. |
| AC-17 | ubiquitous | Скоринг повинен (shall) не робити жодного виклику мовної моделі. | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — тест скорингу отримує LLM-провайдер, будь-який виклик якого валить тест; плюс `grep` по модулю скорингу на відсутність імпорту провайдера. |
| AC-18 | ubiquitous | Знахідку слід (shall) вважати такою, що відповідає очікуванню, коли збігається файл і перетинаються діапазони рядків. | Юніт-тести таблицею випадків (дотик країв, вкладення, сусідні діапазони, інший файл) у `pnpm verify:l06`. |
| AC-19 | ubiquitous | `citation_accuracy` прогону повинна (shall) дорівнювати частці знахідок, що пережили grounding gate. | Юніт-тест над результатом `groundFindings` із `reviewer-core/src/grounding.ts:52` у `pnpm verify:l06`. |
| AC-20 | unwanted | ЯКЩО знаменник метрики порожній (нуль очікувань `must_find` для recall, нуль знахідок для precision чи citation_accuracy), ТОДІ система повинна (shall) повернути `1` і зберегти самі знаменники поряд із метриками. | Юніт-тест на порожні знаменники в `pnpm verify:l06`; інтеграційний тест читає збережені знаменники. |
| AC-21 | event-driven | КОЛИ екран показує метрику з порожнім знаменником, він повинен (shall) показати «—» замість числа, а не стовідсоткове значення. | Компонентний тест метричної картки й рядка історії (`cd client && pnpm test`). |
| AC-22 | event-driven | КОЛИ користувач відкриває вкладку Evals агента, система повинна (shall) показати список кейсів набору й історію прогонів, де кожен рядок несе свої метрики. | Компонентний тест вкладки + e2e-флоу по сторінці агента. |
| AC-23 | ubiquitous | У лівому сайдбарі повинен (shall) бути пункт Eval Dashboard, а його сторінка — показувати `recall`, `precision`, `citation_accuracy` та останні прогони агентів. | e2e-флоу: перехід із сайдбара на сторінку й читання трьох метрик; компонентний тест сторінки. |
| AC-24 | event-driven | КОЛИ користувач обирає два прогони для порівняння, система повинна (shall) показати дві колонки метрик із дельтою між ними та покейсовий список зі зміною стану кейса між прогонами. | Компонентний тест екрана порівняння на парі фікстурних прогонів; manual run: скріншот порівняння двох прогонів. |
| AC-25 | unwanted | ЯКЩО у порівнянні бере участь неповний прогін, ТОДІ система повинна (shall) прямо позначити його неповним поряд із його метриками. | Компонентний тест екрана порівняння з неповним прогоном. |
| AC-26 | event-driven | КОЛИ system prompt агента змінено і зроблено другий прогін на тому самому наборі, різниця `recall` чи `precision` між двома прогонами повинна (shall) бути видимою в порівнянні. | Manual run на живому стеку: два прогони зі старим і новим промптом, потім навмисно зіпсований промпт; спостерігач дивиться на колонку дельти й покейсовий список. Скріншот порівняння — артефакт здачі. |
| AC-27 | ubiquitous | Схема очікування повинна (shall) жити в eval-секції `contracts/eval-ci.ts` і бути дослівно віддзеркаленою у клієнтській копії, тоді як секція `AgentManifest` в обох копіях лишається незмінною. | `diff` двох файлів показує розбіжність лише в `AgentManifest` і `ConformanceInput.provider`; `cd server && pnpm typecheck` і `cd client && pnpm typecheck`. |
| AC-28 | optional | ДЕ eval case має `owner_kind` `agent` — єдине значення, яке пише цей потік, — система повинна (shall) включати його в прогін; кейсів з `owner_kind` `skill` цей потік не створює і не проганяє. | Юніт-тест вибірки набору в `pnpm verify:l06`; `grep` по коду потоку на відсутність запису літерала `'skill'` в `owner_kind`. |
| AC-29 | ubiquitous | `pnpm verify:l06` повинен (shall) бути зеленим на чистій машині без Docker. | `cd server && pnpm verify:l06` у дереві без запущеного Postgres. |
| AC-30 | unwanted | ЯКЩО рев'ю, якому належить знахідка, не має агента, ТОДІ система повинна (shall) відмовити у створенні eval case з причиною, що називає відсутнього агента, і не створювати кейс без власника. | Інтеграційний тест: знахідка з рев'ю, де `agent_id` порожній, — маршрут повертає відмову, і `eval_cases` не поповнюється. |

## Edge cases

- **A finding with no decision.** The one-click path has nothing to derive an expectation
  from. Covered by AC-03.
- **A finding whose review has no agent.** `reviews.agent_id` is nullable
  (`server/src/db/schema/reviews.ts:28`) and the seeded demo review sets none
  (`server/src/db/seed.ts:445-458`), while `eval_cases.owner_id` is `notNull` — so there is no
  set for the case to join. Refused with the missing agent named, the same shape as AC-06's
  refusal rather than a case created without an owner. Covered by AC-30.
- **The same finding clicked twice.** Covered by AC-04.
- **A pull request whose diff is enormous.** Refused at creation with the limit named, never
  truncated: truncation would change what the agent sees between creation and run, and two
  runs would stop being comparable — the single property this feature exists to guarantee.
  Covered by AC-06.
- **The source pull request or finding is deleted.** The case is a snapshot with no foreign
  key to either, which is what the existing schema already encodes. Covered by AC-07.
- **An empty case set.** Covered by AC-12.
- **A second run while one is in flight.** Refused, not queued. Covered by AC-13.
- **A case that fails mid-run** (model unavailable, timeout, malformed structured output).
  Persisted as an incomplete run over the cases that did run. Covered by AC-14 and, on the
  comparison screen, AC-25.
- **An empty denominator.** `recall` with no `must_find` expectations; `precision` and
  `citation_accuracy` when the agent returned nothing. `1` on the wire because
  `knowledge.ts:58-61` cannot carry `null`; `—` on the screen. Covered by AC-20 and AC-21.
- **A `.default()` on the new expectation schema.** Root `INSIGHTS.md` (2026-08-29) records
  that a `.default()` field is optional on input but **required** on `z.infer`, so a
  "purely additive" mirror edit breaks every object literal of that shape in both packages.
  If the expectation schema needs a default, the breakage is a consequence to plan for, not a
  surprise to discover. No separate `AC-NN`: it is a property of how the change is made, and
  `pnpm typecheck` in both packages is the check — already required by AC-27.
- **Re-seeding an already-seeded database.** Root `INSIGHTS.md` (2026-08-02) is explicit that
  anything added inside the seed's `if (!pr)` block is invisible on an existing database and
  needs a fresh volume, and `docker compose down -v` destroys every imported repo with it.
  The 2026-08-06 entry adds that the seed never converges on rename. Covered by AC-09, stated
  as "upgrades in place".
- **A run whose agent was edited mid-flight.** The prompt snapshot is taken at run start
  (AC-10), so the run reports what it actually ran under, not what the agent says now. No
  separate criterion: AC-10's check exercises exactly this.
- **Two runs with different case-set sizes** (a case added between them). The comparison
  shows both denominators rather than a delta of incomparable ratios. Covered by AC-20's
  requirement to persist denominators and AC-24's per-case list, which shows a case present
  in one run and absent from the other as such.

## Design analysis

**Design sources given:** `reference/devdigest-design` (local, git-excluded snapshot; not a
repository file and never committed), read through the `design-reference` skill. Screen keys
consulted: `agents` (artboard `agent-evals`), `eval-case` (artboard `evalcase`),
`skills-lab` (artboard `skill-evals`), plus the design's own sidebar definition.

**What the artboards actually contain, corrected against the incoming brief:**

- `agent-evals` is a bare case list: a header, "Run all evals" and "New eval case", then rows
  of `name` / result sentence / expected badge with Play, Edit and Trash actions. **No
  metrics, no run history.**
- `evalcase` is a modal with a name field, an input area tabbed Diff / Files / PR meta, an
  expected-output JSON pane and a "Last run passed · expected 1 finding, got 1" banner.
- `skill-evals` is the full Eval Dashboard — an alert banner, three metric cards (RECALL,
  PRECISION, CITATION ACCURACY) with deltas, a trend chart, and a "Recent runs" table with
  columns Ran at / Version / Recall / Precision / Citation / Pass / Cost. It is scoped to a
  **skill**, not an agent.
- The design's sidebar carries `{ key: "eval", label: "Eval Dashboard", icon: "Gauge" }`.
- **No artboard exists anywhere for a side-by-side comparison of two runs.**

**1 — States missing from the mockup**

- Loading: no artboard for a run in progress, though AC-15 requires the state to be
  observable while it runs. *Derived.*
- Empty: no artboard for an agent with zero cases, which is every agent on day one. AC-12
  requires a disabled control there. *Derived.*
- Empty (dashboard): no artboard for a workspace where no run has ever happened. *Derived.*
- Error: no artboard for a failed or partly failed run. AC-14 and AC-25 require incompleteness
  to be visible rather than averaged away. *Derived.*
- Denied: no artboard for the refused second concurrent run (AC-13). *Derived.*
- Disabled: the `FindingCard` artboards show accept/dismiss but no eval control at all, so
  the disabled-until-decided state of AC-03 has no design. *Derived.*
- The mockup's case row has three states (`pass` / `fail` / `never run`); it has no state for
  a case that was skipped because its run ended early.

**2 — Corner cases the design does not cover**

- The metric cards render `Math.round(value * 100)` with no branch for an empty denominator —
  a vacuous `1` would read as a genuine 100%. AC-21 is the answer.
- The "Recent runs" table's `Version` column has no equivalent in `eval_runs` today; a run
  batch carrying its prompt snapshot (AC-10) is what makes that column truthful.
- The row's `Pass` column is `passed/total`; with a partial run, `total` is ambiguous between
  "cases in the set" and "cases that ran". AC-14 forces the second and the label must say so.
- The case-row expected badge (`CRITICAL · security`) implies severity and category are part
  of an expectation. Matching in this feature is file plus line-range overlap only (AC-18),
  so any severity shown next to a case is descriptive of the source finding, not a matched
  criterion.
- Nothing in the design bounds the case list; AC-16 caps a run at 50.
- The `evalcase` modal is fully editable, but manual editing is a stretch goal
  (`Out of scope`), so the same modal is view-and-delete here (AC-08).

**3 — How the involved modules talk**

- `client/` holds no logic: it reads and writes the API and renders. The eval control on
  `FindingCard` posts an intent ("this finding becomes a case"); it never assembles a diff.
- `server/` owns all I/O — it loads the pull request's diff, freezes the snapshot, persists
  the case, executes runs and scores them. Everything about an eval lives here.
- `reviewer-core/` is reused unchanged and stays zero-I/O: the run feeds it a `UnifiedDiff`
  and an injected `llm` (`reviewer-core/src/review/run.ts:45`), and reads `ReviewOutcome`
  back, including `dropped` — which is the entire input to `citation_accuracy` (AC-19).
  Scoring belongs on the server side of that boundary because it is about eval cases, which
  `reviewer-core` knows nothing about.
- `@devdigest/shared` is the only place the case, expectation and run shapes are named, and
  the client copy is a mirror (root `CLAUDE.md` § Gotchas) — AC-27.
- The one direction that must not exist: nothing in scoring may reach for a model. AC-17
  makes that checkable rather than aspirational.

**4 — UX improvements proposed** (proposals, not requirements — do not plan them as such)

- *Proposal:* on the comparison screen, sort the per-case list so that state changes
  (`pass → fail`, `fail → pass`) come first and unchanged cases last. A list ordered by name
  buries the three rows the experiment was run to see.
- *Proposal:* show the two prompt snapshots' difference, not just their versions, so that
  "which edit moved this" does not require leaving the screen.
- *Proposal:* on a case row, show which finding it came from as a link back to the pull
  request, using the provenance AC-05 already stores.
- *Proposal:* label the metric cards with their denominators inline (`recall 6/8`) rather
  than only on hover — the ratio without its denominator is the failure mode this feature
  is meant to remove one level up.

**Derived, and marked as such:** the Eval Dashboard **for an agent**, the run-history section
of the Evals tab, and the **whole comparison screen** have no artboard. Their layout follows
`skill-evals` where an analogue exists and is invented where none does. Derived is not
unclarified — the caller has stated what each must contain (AC-22, AC-23, AC-24) — but a
later reader must be able to tell these apart from a screen that was drawn.

## Non-functional requirements

| Limit | Value | Why this number |
|---|---|---|
| `input_diff` per case | ≤ 100 000 characters, refused above it | Set by the caller. A refusal keeps the snapshot exact; truncating would change the agent's input between creation and run and destroy comparability (AC-06). |
| Cases per run | ≤ 50 | Set by the caller. At whole-PR diffs and one model call per case, 50 is already the outer edge of a tolerable wall-clock run. |
| Model used by a run | the agent's own model, never a cheaper pinned one | A separate eval model would mean AC-26 measures something other than the agent under test. |
| Per-case wall clock to budget against | 14–28 s for a healthy call, with outright stalls observed | Root `INSIGHTS.md` (2026-08-06, resolved) measured this over five consecutive live runs on OpenRouter. Multiplied by 8+ whole-PR cases, this is why AC-15 exists. |
| User-facing blocking time for a run | none — the run must not be served on one held-open HTTP request | Same source: `POST /pulls/:id/brief` ran 126 s against a 60 s budget and failed in front of a user. 8+ cases at whole-PR scale is that shape again, multiplied. |
| LLM calls made by scoring | exactly 0 | AC-17. It is the property that makes a re-scored run reproducible. |
| `verify:l06` runtime environment | no Docker, no Postgres, no network | It must be green on a clean machine, like `verify:l03` (`server/package.json:15`). |

## Inputs and provenance

| Input | Where it comes from | When it is stale | If missing |
|---|---|---|---|
| The decision on a finding | `findings.accepted_at` / `findings.dismissed_at`, written by the user in `FindingCard` | Never for the case's purpose: the case freezes the decision at creation. A later change of mind does not rewrite an existing case. | The eval control is disabled with copy saying to accept or dismiss first (AC-03). |
| The pull request diff | Loaded server-side at case creation and stored whole in `eval_cases.input_diff` | Immediately and by design — it is a snapshot, so the case keeps testing the code as it was even after the PR moves on (AC-05). | Case creation fails; nothing partial is stored. |
| The originating finding id | Written into `eval_cases.input_meta` at creation | Goes dangling if the finding or its PR is deleted; the case survives regardless (AC-07). | Provenance is absent; the case still runs. |
| The system prompt and model | `agents.system_prompt` / `agents.model`, snapshotted onto the run batch at run start | The snapshot never goes stale; the agent's live values do, which is exactly why the snapshot exists (AC-10). | A run cannot start. |
| Findings produced by a run | `reviewer-core` `ReviewOutcome.review.findings` (already grounded) | Per run; never reused across runs. | The case scores as producing nothing, which is a legitimate result, not an error. |
| Grounding outcome | `ReviewOutcome.dropped` + kept, from `reviewer-core/src/grounding.ts:52` | Per run. | `citation_accuracy` has an empty denominator and follows AC-20 / AC-21. |
| Seeded decided findings | `server/src/db/seed.ts`, extended and guarded on its own absence | On rename of a seeded row — the seed never converges on rename (root `INSIGHTS.md`, 2026-08-06). | The set cannot reach eight on a clean machine and AC-01 fails. |

## Untrusted inputs

The diff snapshot stored on a case is repository content written by whoever authored the pull
request, and it reaches a model's context on every run of that case. It is data. A line
inside it that reads like an instruction to the reviewing agent is reviewed, never obeyed —
the same rule the existing review path already applies to a live diff
(`reviewer-core/src/review/run.ts:45-101`, where `specs`, `callers`, `repoMap`,
`prDescription` and `intent` are all documented untrusted and delimiter-wrapped). This
feature adds no new class of untrusted input; it adds a new *lifetime* for one, because a
snapshot outlives the pull request it came from and can be replayed long after anyone
remembers where it came from.

Findings produced by a run reach the user's screen as text; they are model output and carry
no authority.

The expectation attached to a case is derived by the server from a persisted decision, not
parsed from anything the user or the model typed, so it is trusted.

Case names taken from a finding title are model-authored text rendered on a screen — display
only, never interpreted.

## Test plan

| Lane | Covers |
|---|---|
| `cd server && pnpm verify:l06` (unit, no Docker) | Scoring: file + line-range matching (AC-18), `citation_accuracy` off the grounding result (AC-19), empty denominators (AC-20), the two limits (AC-06, AC-16), frozen-input determinism (AC-11), agent-only set selection (AC-28), and the zero-LLM property (AC-17). This is the script AC-29 names. |
| `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (unit) | Everything above plus contract parsing of the new expectation shape. |
| `cd server && pnpm exec vitest run .it.test` (integration, Docker) | Case creation from both decision types (AC-02), idempotence (AC-04), whole-diff snapshot and provenance (AC-05), survival of PR deletion (AC-07), case deletion cascade (AC-08), seed idempotence and the ≥8 count (AC-01, AC-09), prompt snapshot per run (AC-10), concurrent-run refusal (AC-13), partial run persistence with `MockLLMProvider` (AC-14), non-blocking run and observable state (AC-15). |
| `cd client && pnpm test` (component) | Disabled eval control per decision state (AC-03), empty-set disabled Run (AC-12), `—` for empty denominators (AC-21), Evals tab list + history (AC-22), Eval Dashboard page (AC-23), comparison columns, delta and per-case state change (AC-24), incomplete-run labelling (AC-25). |
| `cd client && pnpm typecheck` + `cd server && pnpm typecheck` | The mirrored contract compiles in both packages (AC-27), including any `.default()` consequence. |
| `e2e/` flow | The model-free half only: finding → case → the Evals tab's case list and run history (AC-22) → sidebar → Eval Dashboard (AC-23). The lane cannot go further — `e2e/run.ts:17-18` declares that nothing in it triggers an LLM call or needs an API key, and `scripts/e2e.sh` exports no provider key — while a run *is* a model call. The `→ run → metrics` half is AC-26's manual live run, already excluded from automation below. Note root `CLAUDE.md` § Gotchas: a flow asserting seeded literals must be updated together with `seed.ts` (AC-09). |
| shell `diff` / `grep` | The two contract copies differ only in `AgentManifest` and `ConformanceInput.provider` (AC-27); no code path writes `'skill'` as an `owner_kind` (AC-28). |

**Deliberately not covered by an automated test:** AC-26 — that a system-prompt change
*visibly* moves `recall` / `precision`. It needs a real model, real cost and a human reading
two columns; asserting it against `MockLLMProvider` would test the mock. It is checked by a
manual run on the live stack (two runs, old prompt vs new, then a deliberately broken
prompt), and its artefacts are the submission's screenshot and screencast.

## Risks

| Risk | How we would notice | What we do |
|---|---|---|
| A run over 8+ whole-PR diffs is slow enough to look broken | Wall clock past a minute with nothing on screen; the shape root `INSIGHTS.md` recorded at 126 s on `POST /pulls/:id/brief` | AC-15 forbids holding the user on the request and requires the run's state to be observable while it runs. |
| An OpenRouter call stalls outright mid-run | One case never returns and the run never completes | AC-14: a stalled case fails the case, not the run; the run persists as incomplete with an honest denominator. |
| The vacuous `1` is read as a perfect score | A dashboard showing 100% on a set that expects nothing | AC-20 persists denominators, AC-21 renders `—`. |
| The new expectation schema's `.default()` breaks object literals across both packages | `pnpm typecheck` fails in server, client, or both, on files nobody edited | Known in advance (root `INSIGHTS.md`, 2026-08-29); AC-27's typecheck in both packages is the gate, and the mirror edit is made in the same change as the server edit. |
| The seed addition lands inside `if (!pr)` and is invisible on an existing database | AC-01 passes on a fresh volume and fails on a developer's machine | AC-09 requires each addition guarded on its own absence and verified by seeding twice, following the pattern already used at `server/src/db/seed.ts:518,760,814,886`. |
| A `nav.ts` edit drifts beyond the one authorised entry | `git diff client/src/vendor/ui/nav.ts` shows more than one added item | The nav change is a single point commit touching one entry; anything else in that file needs an explicit decision. |
| This stream and L07-B edit `contracts/eval-ci.ts` at the same time | A merge conflict in a file both streams hold, or a mirror that silently loses `AgentManifest` | Ownership is by section, stated in `Out of scope`; AC-27's `diff` check is what catches an over-reaching mirror edit. |
| Comparing runs of different case-set sizes produces a meaningless delta | Two runs with different denominators shown as a single percentage difference | AC-24's per-case list and AC-20's persisted denominators; the delta is never shown without them. |
| `verify:l06` quietly grows a dependency on Docker or the network | Green locally, red on a clean checkout | AC-29 is checked by running it with Postgres stopped. |

## Open questions

All nineteen questions raised in the clarification round were answered by the caller before
this file was written; each answer is recorded above as a requirement, an edge case, a limit,
or an explicit exclusion. Specifically: the run batch and its migration (AC-10), stretch
goals excluded (`Out of scope`), agents only (AC-28), the shape of `verify:l06` (AC-29), the
expectation schema and its mirror (AC-27), the whole-PR diff snapshot with refusal above the
limit (AC-05, AC-06), vacuous `1` on the wire and `—` on screen (AC-20, AC-21), the seed
extension (AC-09), the comparison screen's contents (AC-24), the Evals tab's contents and the
deliberate absence of the trend chart (AC-22, `Out of scope`), the disabled-until-decided
control and the no-duplicate rule (AC-03, AC-04), view-and-delete only (AC-08), partial runs
(AC-14), zero cases (AC-12), one active run per agent (AC-13), permanent snapshots with
provenance (AC-05, AC-07), the agent's own model (`Non-functional requirements`), the
non-blocking run (AC-15), and both size ceilings (AC-06, AC-16).

Two things are recorded here as decisions rather than questions, so nobody reopens them as
gaps:

- **The `Actors` category was skipped in the clarification round and the caller accepted the
  skip.** DevDigest is a local single-user studio with one workspace and no roles; every
  action in this spec is performed by the same person.
- **The design gap is derived, not unclarified.** The Eval Dashboard for an agent, the run
  history on the Evals tab and the comparison screen have no artboard. The caller stated
  what each must contain, so they carry no unanswered-question marker — but they are labelled
  *derived* in `Design analysis` so a later reader can tell an invented layout from a drawn
  one.

**Unanswered-question markers remaining in this file:** none. Nothing in this spec is a
guess recorded as a requirement.

**Status note.** `specs/plans/eval-pipeline.md` now exists (`fcde185`), so the status is
`in-progress` (`README.md` § Rules 5). No unanswered question is open.

**Amended after planning.** `implementation-planner` returned three inconsistencies against
the tree at `2038e95`; all three were re-verified in the code before this file was changed.
`In scope` promised eight decided findings while AC-01 counted eight eval cases — two
different populations — and both now state the wide reading, which is the only one under
which AC-01's manual half and the e2e halves of AC-22 and AC-23 are executable on the
ephemeral database `scripts/e2e.sh` boots. The demo review sets no `agent_id` while
`eval_cases.owner_id` is `notNull`, so the seed must attach it to a seeded agent (AC-09), and
a finding whose review has no agent has no set to join — that refusal is now **AC-30** rather
than an unwritten planning decision. The § Test plan `e2e` row asked for a run the lane
declares it cannot perform; it now asks only for the model-free half and names where the
other half is checked. Ids stay flat and permanent: nothing was renumbered, and no earlier
criterion changed meaning.
