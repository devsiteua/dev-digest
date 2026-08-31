# Export to CI — run a tuned agent inside the target repository's GitHub Actions

Spec ID: EXPORT-TO-CI
Status: in-progress
Supersedes: none
Owner: L07-B stream — worktree `dev-digest-l07b`, branch `feat/export-to-ci`
Packages touched: server · client (`agent-runner` is consumed, not changed; `reviewer-core`, `mcp` and `e2e` untouched)

> Every section stays, even when the honest answer is "none". A deleted section reads as an
> oversight; the word "none" is a claim someone can disagree with.
> The implementation plan does **not** live here — it lives in `plans/export-to-ci.md`
> alongside this file. See `README.md` § Where plans live.

## Problem and user

A DevDigest agent only reviews on the developer's own machine: a review starts from the studio
UI, runs inside `server/`, and its result lands in this laptop's Postgres. A team therefore
cannot rely on the agent in every pull request — whoever forgets to press the button gets no
review, and there is no way to make a finding block a merge. The whole apparatus that would fix
this already exists and is wired to nothing: `agent-runner/` (commit `5530da3`, 23 green tests)
runs the identical `reviewer-core` pipeline inside someone else's CI; `AgentManifest`,
`CiExportInput`, `CiRun` and `CiResultArtifact` are declared in
`server/src/vendor/shared/contracts/eval-ci.ts`; `commitFiles()` / `findOpenPr()` /
`openPullRequest()` are implemented in `server/src/adapters/github/octokit.ts`; the tables
`ci_installations` and `ci_runs` are migrated and read by no code; `agent_runs.source` already
carries the member `'ci'` that nothing ever writes. The gap is the module in the middle —
`server/src/modules/ci/` does not exist — plus the two screens the design already specifies
(`export-to-ci`, `ci-runs`) and the `agent-ci` tab.

## Goals / Non-goals

**Goals**

1. An agent's configuration can be serialized to a checked-in manifest and installed into a
   target GitHub repository through a pull request, without a human editing YAML.
2. The generated workflow runs the already-built runner and is safe by construction: least
   privilege, no `pull_request_target`, secrets only from Actions Secrets, external actions
   pinned to a commit SHA.
3. A CI review's result reaches the studio through one authenticated endpoint, is written as
   an `agent_runs` row with `source='ci'`, and is visible in a CI Runs list with a link back to
   the GitHub Actions job.
4. The agent page tells the truth about where the agent is installed and what gate it enforces.
5. The CI-owned half of the client contract mirror stops lagging behind the server copy.

**Non-goals** — shapes we reject, not work we postpone:

1. **A DevDigest-hosted service.** The studio stays a local app. Nothing here introduces a
   backend that GitHub is expected to reach by default; the ingest endpoint is authenticated
   and the workflow's call to it is conditional and non-fatal (AC-13).
2. **A published marketplace action.** `uses: devdigest/review-action@v1` in the mockup remains
   a placeholder. The runner is a file inside the target repository, which is also why no
   marketplace action needs pinning.
3. **Re-implementing the review pipeline for CI.** The runner is the pipeline. Any behaviour we
   want in CI that the runner does not have is a change to `agent-runner/`, and this pass makes
   none.
4. **A second gate computation.** The verdict and the exit code are the runner's deterministic
   gate. The studio records what it is told; it never recomputes blockers from the artifact's
   severity counters.

## Context

What already exists and is therefore not built again.

| Already true | Where |
|---|---|
| the whole CI runner: `ncc`-bundled into `dist/` — three files, not one: `index.js` (1 604 629 B), a lazily imported chunk `300.index.js` (5 796 B) and a generated `package.json` whose whole contents are `{"type": "module"}` — same `reviewer-core` pipeline, mandatory grounding gate, deterministic verdict from grounded findings + `ci_fail_on`, writes `devdigest-result.json`, exits non-zero iff the gate requested changes — 23 green tests | `agent-runner/` (`README.md`, `CLAUDE.md`, commit `5530da3`) |
| the runner reads `OPENROUTER_API_KEY` / `GITHUB_TOKEN` / `GITHUB_REPOSITORY` / `PR_NUMBER` / `DEVDIGEST_POST_AS` from `process.env`, deliberately outside the server's `SecretsProvider` chokepoint | `agent-runner/CLAUDE.md` § "Why This Package Intentionally Breaks the `SecretsProvider` Rule" |
| the runner resolves skill bodies from `.devdigest/skills/<slug>.md` and hands them to the engine **already resolved and unwrapped** | `agent-runner/src/skills.ts`, `agent-runner/src/run.ts:94,124` |
| `AgentManifest` — one Zod schema for studio and runner | `server/src/vendor/shared/contracts/eval-ci.ts:152` |
| `CiTarget`, `CiFile`, `CiExportInput`, `CiInstallation`, `CiExport`, `CiRunStatus`, `CiRun`, `CiResultArtifact`, `CiFailOn` | same file, and `CiFailOn` in `contracts/knowledge.ts:360` |
| `CommitFile` / `CommitFilesPayload` ports, and `commitFiles()` / `findOpenPr()` / `openPullRequest()` implemented against the GitHub Git Data API | `server/src/vendor/shared/adapters.ts:129,134,161` · `server/src/adapters/github/octokit.ts:264,332,245` |
| tables `ci_installations`, `ci_runs` — migrated, read nowhere | `server/src/db/schema/ci.ts` |
| `agent_runs.source` enum already carries `'ci'`; only `'local'` is ever written | `server/src/db/schema/runs.ts:33` |
| `agents.ci_fail_on` column, and `PUT /agents/:id` already accepts `ci_fail_on` | `server/src/db/schema/agents.ts:26` · `server/src/modules/agents/routes.ts:47,112` |
| the skill trust rule the export must preserve: `manual` verbatim, every other source `wrapUntrusted('skill:<name>', body)` | `server/src/modules/reviews/helpers.ts:105-118` |
| `ExportWizardSteps`, `AutoTriggerStatus` UI primitives (consume only — `client/src/vendor/ui/**` is do-not-touch) | `client/src/vendor/ui/ExportWizardSteps.tsx`, `AutoTriggerStatus.tsx` |
| the design for all three surfaces | `reference/devdigest-design/`, screen keys `export-to-ci` (artboard `export`), `ci-runs` (`ci-runs`, `e-ci`), `agents` (`agent-ci`) |
| the studio has **no authentication of any kind** — `LocalNoAuthProvider` resolves the single workspace, and no route reads an `Authorization` header | `docs/glossary.md` § Platform · `server/src/app.ts` |
| the runner's own source already names the module this spec creates (`server/src/modules/ci/constants.ts` / `workflow.ts`) as the owner of workflow generation | `agent-runner/src/index.ts:5-7` |

**Not verified against the running product.** `list_agents` failed with `api_unreachable` on
`http://localhost:3075` (the stack was not up). Everything above is read from code.

**Verified drift in the client mirror** (diffed while writing this spec):
`client/src/vendor/shared/contracts/eval-ci.ts` is missing the whole `AgentManifest` block and
the `CiFailOn` import, and declares `ConformanceInput.provider` without `'openrouter'`;
`client/src/vendor/shared/adapters.ts` is missing `CommitFile` / `CommitFilesPayload` and the
`commitFiles` / `findOpenPr` port methods, and declares `LlmProvider.id` without `'openrouter'`.
The CI-owned half of that is this stream's work. The eval-owned half of `eval-ci.ts` belongs to
L06, and the `sessionId` / `sync` / `diffNameOnly` gaps in `adapters.ts` belong to whoever added
them — we do not touch either.

**What does not exist:** `server/src/modules/ci/`. It is created from scratch under the onion
rule — `routes → service → repository`, GitHub work through the existing `GitHubPort`, never a
new adapter.

## In scope

- **`server/src/modules/ci/`** (new module, one line in `server/src/modules/index.ts`), serving:
  - `POST /agents/:id/export-ci` — generate the bundle, commit it to `devdigest/ci`, open the PR,
    persist the `ci_installations` row (`CiExportInput` → `CiExport`);
  - `GET /ci/runs` — the CI Runs list;
  - `GET /agents/:id/ci` — installations + recent CI runs for the agent CI tab;
  - `GET /agents/:id/export-ci/preview` — the read-only preview: the same `CiFile[]` the export
    would commit, produced by the same pure generator, with no GitHub call and no row written
    (`action: 'files'` stays out of scope — this route replaces the reason anyone wanted it);
  - `POST /ci/ingest` — the single authenticated way a CI result enters the studio.
- **Bundle generation**: `.devdigest/agents/<slug>.yaml` (an `AgentManifest`), one
  `.devdigest/skills/<slug>.md` per attached skill, `.github/workflows/devdigest-review.yml`,
  and **all three** files `ncc` emits into `agent-runner/dist/` — `index.js`, the lazily
  imported chunk `300.index.js`, and the generated `package.json` — copied under
  `.devdigest/runner/` with their names preserved.
- **The Export Wizard** on the agent page: `Target → Preview → Configure → Install`, built on
  `ExportWizardSteps`; GitHub Actions is the only target; Preview is read-only; Configure covers
  the `pull_request` event list and the publish mode; Install opens the PR.
- **CI Runs page** — a flat list of the most recent runs with the columns AC-24 names.
- **CI tab on the agent page** — installations, workflow version, recent history, `Fail CI on`
  (saved through the existing `PUT /agents/:id`).
- **Ingest** — bearer-token auth against a `DEVDIGEST_CI_TOKEN` read through the existing
  `SecretsProvider`, strict contract validation, `commit_sha` and `repo` checks, one `agent_runs`
  row with `source='ci'` plus one linked `ci_runs` row.
- **One migration**: two nullable columns on `ci_runs` — `agent_run_id` (FK to `agent_runs`) and
  `commit_sha`. Without the first, `CiRun.duration_s` and `CiRun.agent` cannot be answered from
  the database at all; without the second, "ingest verifies the commit SHA" verifies something it
  then throws away.
- **The CI half of the contract mirror**: `AgentManifest` + the `CiFailOn` import in
  `client/src/vendor/shared/contracts/eval-ci.ts`; `CommitFile`, `CommitFilesPayload`,
  `commitFiles`, `findOpenPr` in `client/src/vendor/shared/adapters.ts`; `'openrouter'` in the two
  client declarations that lag (`LlmProvider.id`, `ConformanceInput.provider`).
- **One nav entry** for CI Runs in `client/src/vendor/ui/nav.ts` — added only after
  `feat/multi-agent-review` is merged and this branch is rebased on it (AC-26).

## Out of scope

The overriding constraint on this pass is that it stays **very simple**: one thin slice that
demonstrably works end to end. Everything below is deliberately not done.

- **CircleCI, Jenkins and Generic CLI targets** — the brief says show a target only if its
  generator really exists, and only the GitHub Actions generator will. Showing three disabled
  cards is worse than showing one card.
- **An editable Preview.** The design marks the workflow file `editable`; this pass renders every
  file read-only. *Iteration 2 — the first pass proves the pipeline end to end*, and an editable
  workflow means round-tripping user text back through generation and re-validating it.
- **`.devdigest/memory.jsonl` in the bundle.** Persistent memory is a different L07 feature and
  the `memory` table is empty. Exporting an empty file to look like the mockup is a lie.
- **"Copy files as a zip" on Install.** One installation path — the PR — is enough to prove the
  pipeline. *Iteration 2.*
- **`CiExportInput.action: 'files'`.** The contract member stays; the route accepts only
  `'open_pr'`. *Iteration 2.*
- **Filters, charts, auto-refresh, a detail drawer and a "Trace" link on CI Runs.** The design has
  five filter chips and a trace link; a CI run has no `run_traces` row on this machine, so the
  link would go nowhere. *Iteration 2.*
- **Pagination on CI Runs.** A capped list (NFR) instead. *Iteration 2.*
- **Per-severity finding chips on a CI run.** The counters exist in `CiResultArtifact`, but
  neither `ci_runs` nor `agent_runs` has anywhere to keep them and AC-31 fixes the migration at
  exactly two columns. A third severity tally would also have to choose a counting rule on
  purpose — two already coexist deliberately in this repository (root `INSIGHTS.md`,
  2026-08-02) — which is not a decision a thin first pass should be making. The list shows the
  total, which is what the graded requirement names. *Iteration 2.*
- **The PR title column on CI Runs.** The target repository need not be imported into the studio,
  so we have no title of our own — and taking one from the ingest envelope would render
  attacker-controlled text from someone else's repository in our UI for no benefit. The row shows
  `owner/name` and `#N`, linked to GitHub.
- **A "secrets ready / not set" indicator on Configure.** Reading a repository's Actions Secrets
  needs admin scope and returns names only. The step lists the expected secret names as
  instructions. *Iteration 2.*
- **The "Block merge on findings" toggle.** The design itself disables it ("Requires a GitHub App
  — not available with PAT in local mode"). Making a check *required* is a branch-protection
  setting in the target repository, done by hand.
- **A Settings screen for the ingest token.** The token is placed in `~/.devdigest/secrets.json`
  by hand, like every other secret in local mode. *Iteration 2.*
- **Editing anything on the CI tab except `Fail CI on`** — no uninstall, no "Update CI config"
  button, no workflow re-push. *Iteration 2.*
- **Re-deriving the gate in the studio.** See Non-goal 4.
- **Any change to `agent-runner/`.** It is finished and tested; a change there is a separate PR
  by the homework's own advice.
- **Any change to the multi-run service, the PR feed or the Multi-Agent Review page** — L07-A owns
  them.
- **Any change to `.github/workflows/**` of *this* repository.** The wizard generates a workflow
  for the *target* repository. The two are constantly confused; they are not the same file.
- **`client/src/vendor/ui/**`** — do-not-touch, except the one `nav.ts` entry under AC-26.

## User stories

- As a **tech lead**, I want to install a tuned agent into a repository from the studio, so that
  every pull request is reviewed whether or not somebody remembers to press a button.
- As a **repository maintainer**, I want to read the generated workflow in a pull request before
  it runs, so that I can see the permissions, the triggers and how the PR's own code is treated
  before I merge it.
- As a **developer whose PR was reviewed in CI**, I want the finding on the PR and the run in the
  studio, so that the CI result and the local history are the same history.
- As an **agent owner**, I want the agent page to say where the agent is installed and what gate
  it enforces, so that "it did not block that PR" has an answer I can look up.
- As **someone arriving with nothing** — no target repository, no token, no runner bundle — I want
  each of those to fail with a sentence telling me what to do, so that I never get a half-installed
  repository or a silently empty CI Runs list.

## Acceptance criteria (EARS)

Written in Ukrainian with the triggers КОЛИ · ПОКИ · ЯКЩО · ДЕ; the rest of the file is
English. Five patterns and the reference: `README.md` § EARS.

| AC-ID | Pattern | Criterion | How it is checked |
|---|---|---|---|
| AC-01 | event-driven | КОЛИ користувач натискає **Add to CI** на сторінці агента, система повинна (shall) відкрити модальний Export Wizard із чотирма кроками Target → Preview → Configure → Install, відрендереними компонентом `ExportWizardSteps`. | client component test on the wizard |
| AC-02 | optional feature | ДЕ для цілі CI справді реалізовано генератор файлів, система повинна (shall) показувати цю ціль на кроці Target; у першому проході реалізовано лише GitHub Actions, тому CircleCI, Jenkins і Generic CLI не показуються взагалі. | client component test: exactly one target card is rendered |
| AC-03 | ubiquitous | Крок Preview повинен (shall) перелічувати файли до створення — `.devdigest/agents/<slug>.yaml`, по одному `.devdigest/skills/<slug>.md` на кожен приєднаний скіл, `.github/workflows/devdigest-review.yml` і три файли раннера `.devdigest/runner/index.js`, `.devdigest/runner/300.index.js` та `.devdigest/runner/package.json` — показувати вміст лише маніфесту, скілів і workflow, і лише для читання, а для кожного з трьох файлів раннера показувати тільки шлях і розмір у байтах. | client component test + server unit over `GET /agents/:id/export-ci/preview` |
| AC-04 | ubiquitous | Згенерований `.devdigest/agents/<slug>.yaml` повинен (shall) розбиратися схемою `AgentManifest` без помилок. | server unit: `AgentManifest.parse(YAML.parse(file))` |
| AC-05 | ubiquitous | Тіло експортованого файлу скіла повинно (shall) дослівно збігатися з тілом скіла, якщо його `source` — `manual`, і бути обгорнутим `wrapUntrusted('skill:<name>', body)` для будь-якого іншого `source`. | server unit, one case per branch |
| AC-06 | ubiquitous | Згенерований workflow повинен (shall) оголошувати блок `permissions` рівно з двома записами: `contents: read` і `pull-requests: write`. | server unit (assertion over the generated YAML) |
| AC-07 | ubiquitous | Згенерований workflow повинен (shall) запускати рев'ю командою `node .devdigest/runner/index.js` і не містити рядка `uses: devdigest/review-action@v1`. | server unit |
| AC-08 | ubiquitous | Кожен рядок `uses:` у згенерованому workflow повинен (shall) посилатися на повний 40-символьний commit SHA. | server unit (regex over every `uses:` line) |
| AC-09 | ubiquitous | Згенерований workflow повинен (shall) тригеритися лише подією `pull_request` і ніде не містити `pull_request_target`. | server unit |
| AC-10 | ubiquitous | `OPENROUTER_API_KEY` повинен (shall) потрапляти у workflow виключно як посилання `${{ secrets.OPENROUTER_API_KEY }}`; жоден згенерований файл і жодне поле відповіді `POST /agents/:id/export-ci` не повинні (shall) містити його значення. | server unit (the bundle is generated with a non-empty fake key in the secrets provider and asserted not to contain it) |
| AC-11 | state-driven | ПОКИ pull request у цільовому репозиторії походить із форку, згенерований workflow повинен (shall) пропускати job рев'ю, а не обходити обмеження через `pull_request_target` із checkout коду цього PR. | server unit over the job-level `if:` + manual fork PR |
| AC-12 | event-driven | КОЛИ користувач змінює вибір на кроці Configure, система повинна (shall) відобразити обрані події в `on.pull_request.types` і обраний спосіб публікації у змінній `DEVDIGEST_POST_AS` згенерованого workflow. Крок пропонує рівно три події — `opened` і `synchronize` увімкнені за замовчуванням, `reopened` вимкнена — і рівно три способи публікації: `github_review` (за замовчуванням), `pr_comment` і `none` (лише exit code). | client component test asserting all six controls exist with those defaults + server unit over the generator |
| AC-13 | optional feature | ДЕ в цільовому репозиторії задано секрет `DEVDIGEST_INGEST_URL`, згенерований workflow повинен (shall) надіслати результат на ingest студії; інакше крок надсилання пропускається і не робить job червоним. | server unit over the step's `if:` and `continue-on-error` |
| AC-14 | event-driven | КОЛИ користувач підтверджує крок Install, система повинна (shall) закомітити згенеровані файли в гілку `devdigest/ci` цільового репозиторію й відкрити pull request у базову гілку, ніколи не комітячи в базову гілку напряму. | `*.it.test.ts` with the mock GitHub adapter: `commitFiles` called with `branch: 'devdigest/ci'`, `openPullRequest` called once |
| AC-15 | event-driven | КОЛИ Install повторюється для тієї самої пари агент + репозиторій, система повинна (shall) перевикористати наявний рядок `ci_installations` і наявний відкритий pull request замість створення другого. | `*.it.test.ts`: two calls → one row, `findOpenPr` consulted, `openPullRequest` called once |
| AC-16 | unwanted | ЯКЩО зібраної теки `agent-runner/dist/` немає на диску або в ній бракує будь-якого з трьох файлів (`index.js`, `300.index.js`, `package.json`), ТОДІ система повинна (shall) відхилити експорт повідомленням, що треба виконати `pnpm build` в `agent-runner/`, і не створити ні гілки, ні pull request, ні рядка `ci_installations`. | `*.it.test.ts`, one case per missing file |
| AC-17 | unwanted | ЯКЩО GitHub повертає помилку під час коміту файлів або відкриття pull request, ТОДІ система повинна (shall) не створювати рядка `ci_installations` і повернути помилку з причиною. | `*.it.test.ts` with a failing mock adapter |
| AC-18 | unwanted | ЯКЩО запит на ingest не несе дійсного bearer-токена — зокрема коли токен у студії взагалі не налаштовано — ТОДІ система повинна (shall) відповісти 401 і не записати жодного рядка. | `*.it.test.ts`, three cases: no header, wrong token, secret unset |
| AC-19 | unwanted | ЯКЩО тіло ingest не проходить валідацію контракту, або `commit_sha` не є 40-символьним hex, або `repo` не відповідає жодній інсталяції, ТОДІ система повинна (shall) відповісти 4xx і не записати жодного рядка. | `*.it.test.ts`, one case per condition |
| AC-20 | event-driven | КОЛИ ingest приймає валідний результат, система повинна (shall) записати рядок `agent_runs` із `source='ci'`, тривалістю, вартістю і кількістю знахідок з артефакту, і зв'язаний із ним рядок `ci_runs` із `pr_number`, `commit_sha` і посиланням на job GitHub Actions. | `*.it.test.ts` |
| AC-21 | unwanted | ЯКЩО той самий результат надходить удруге (та сама інсталяція, `pr_number` і `commit_sha`), ТОДІ система повинна (shall) не створювати другої пари рядків. | `*.it.test.ts`: two identical posts → one `agent_runs`, one `ci_runs` |
| AC-22 | ubiquitous | Ingest повинен (shall) відхиляти невідомі ключі тіла і зберігати лише поля, оголошені контрактом. | `*.it.test.ts`: a body with an extra key is rejected |
| AC-23 | ubiquitous | Ingest повинен (shall) визначати `workspace_id` запуску через інсталяцію та її агента, ніколи не з тіла запиту. | `*.it.test.ts` |
| AC-24 | ubiquitous | Сторінка CI Runs повинна (shall) показувати для кожного запуску репозиторій, номер pull request, агента, статус, загальну кількість знахідок, вартість, тривалість і посилання на job GitHub Actions. | client component test over a fixture row |
| AC-25 | state-driven | ПОКИ жодного CI-запуску не записано, сторінка CI Runs повинна (shall) показувати порожній стан «No CI runs yet» із CTA на експорт агента. | client component test |
| AC-26 | unwanted | ЯКЩО `feat/multi-agent-review` ще не змержено в базову гілку, ТОДІ цей потік не повинен (shall) змінювати `client/src/vendor/ui/nav.ts`. | shell, reading the OUTPUT and never the exit code (root `INSIGHTS.md`, 2026-08-22): `git diff --name-only lesson-07...HEAD > /tmp/f` — `vendor/ui/nav.ts` absent from that list before the rebase onto merged L07-A, present after |
| AC-27 | ubiquitous | Вкладка CI на сторінці агента повинна (shall) показувати перелік інсталяцій із репозиторієм, ціллю і часом установлення, версію раннера з константи `RUNNER_VERSION` під підписом «Runner v<N>», останні CI-запуски цього агента і контрол `Fail CI on` — і не читати жодного стовпця, якого немає в `ci_installations`. | client component test |
| AC-28 | event-driven | КОЛИ користувач змінює `Fail CI on` на вкладці CI, система повинна (shall) зберегти значення наявним `PUT /agents/:id` і не додавати для цього нового endpoint. | client component test + `grep -c "ci_fail_on" server/src/modules/ci/routes.ts` → `0` |
| AC-29 | state-driven | ПОКИ агент не має жодної інсталяції, вкладка CI повинна (shall) показувати порожній стан «Not exported to CI» із CTA «Export to CI». | client component test |
| AC-30 | ubiquitous | Серверна і клієнтська копії спільних контрактів не повинні (shall) різнитися жодним рядком, що містить `AgentManifest`, `CiFailOn`, `CommitFile`, `CommitFilesPayload` або `openrouter`. | shell: `diff` of the two `eval-ci.ts` copies and the two `adapters.ts` copies, filtered by those names → empty; plus `pnpm typecheck` in both packages |
| AC-31 | ubiquitous | Схема бази повинна (shall) змінитися рівно однією згенерованою міграцією, що додає до `ci_runs` два nullable-стовпці — `agent_run_id` і `commit_sha` — і не чіпає жодної іншої таблиці. | `pnpm db:generate` after the change emits no further diff; `*.it.test.ts` writes and reads both columns |
| AC-32 | ubiquitous | Згенерований workflow повинен (shall) вивантажувати `devdigest-result.json` як артефакт запуску кроком `actions/upload-artifact`, що виконується незалежно від вердикту рев'ю, — щоб результат можна було внести в студію вручну, коли її не видно з GitHub. | server unit over the generated YAML: the step exists, its `if:` does not depend on the review job's outcome, and its `uses:` is SHA-pinned (AC-08) |
| AC-33 | unwanted | ЯКЩО імена двох приєднаних скілів зводяться до одного slug, ТОДІ система повинна (shall) відхилити експорт повідомленням, яке називає обидва скіли, і не створити ні файлів, ні гілки, ні pull request, ні рядка `ci_installations`. | server unit over the slug derivation + `*.it.test.ts` for the refusal |
| AC-34 | ubiquitous | `GET /agents/:id/export-ci/preview` повинен (shall) повертати ті самі файли, що закомітив би експорт, не роблячи жодного виклику до GitHub і не записуючи жодного рядка. | `*.it.test.ts`: the mock GitHub adapter records zero calls, `ci_installations` stays empty, and the result equals the export's `files` for the same input |
| AC-35 | ubiquitous | Закомічений у цільовий репозиторій бандл повинен (shall) містити всі три файли з `agent-runner/dist/` під `.devdigest/runner/` зі збереженням імен, включно з `package.json`, що оголошує `"type": "module"`. | `*.it.test.ts`: assert the paths and the `package.json` contents passed to `commitFiles` |

## Edge cases

- **The runner bundle is not built, or is built incompletely.** `agent-runner/dist/` is
  git-ignored, so it is absent on a fresh clone, and a partial directory is worse than an empty
  one: a bundle missing `package.json` still commits and still fails at the first line of the
  job. Covered by AC-16 — refuse before any GitHub call, on any of the three files.
- **The target repository does not exist, or the token cannot write to it.** GitHub errors on the
  first Git Data call. Covered by AC-17 — no installation row is left behind.
- **The `gh` / studio token lacks the `workflow` scope.** Pushing a `.github/workflows/*` file is
  rejected by GitHub. This surfaces through the same path as AC-17 and has no separate criterion:
  the fix is `gh auth refresh -h github.com -s workflow`; this machine's token already carries the
  scope, so it is a fresh-clone failure mode rather than an open task. See Inputs and provenance.
- **The branch `devdigest/ci` already exists.** `commitFiles` fast-forwards it rather than failing
  (`octokit.ts:264`), and `findOpenPr` reuses the open PR. Covered by AC-15.
- **The agent has no skills attached.** The manifest's `skills` normalizes a missing key or an
  explicit `null` to `[]` (`eval-ci.ts:162-166`), and no `.devdigest/skills/*.md` file is written.
  No separate criterion: AC-04 already fails if the manifest does not validate.
- **A skill's `source` is not `manual`.** Covered by AC-05 — this is the one place where the
  export could silently drop the untrusted wrapping the studio applies.
- **Two skills whose names kebab-case to the same slug.** One file would overwrite the other and
  the manifest would reference a body that is not the skill's. Answered: the slug is the
  kebab-case of `skills.name` (the table has no slug column), and a collision **refuses the
  export** naming both skills — a filename disambiguated with a uuid would be unreadable in the
  target repo's PR and would not match what the user saw in Preview. Covered by AC-33.
- **A pull request from a fork.** Secrets are unavailable and `GITHUB_TOKEN` is read-only.
  Covered by AC-11 — the job is skipped, deliberately, rather than worked around.
- **The studio is unreachable from GitHub Actions.** The default case for a laptop. Covered by
  AC-13 — the ingest step is skipped when `DEVDIGEST_INGEST_URL` is unset and cannot turn the job
  red; the review still runs and still posts to the PR.
- **The same result is delivered twice** (a re-run of the job, or a manual `curl` after an
  automatic post). Covered by AC-21.
- **The artifact arrives for a repository that was never installed**, or with a `commit_sha` that
  is not a SHA. Covered by AC-19.
- **The ingest token is not configured.** Covered by AC-18 — fail closed, never open.
- **`CiExportInput.action: 'files'` is requested.** Rejected with 422 (Out of scope). No separate
  criterion: the route's Zod schema rejects it before the handler runs, which is the same
  mechanism AC-19 already exercises.
- **A CI run whose target repository is not imported into the studio.** `agent_runs.pr_id` stays
  null and the CI Runs row links to GitHub rather than to a local PR page. Covered by AC-24's
  column list, which names no local PR link.
- **An unpriced model.** `cost_usd` is null in the artifact; null is "unknown", `0` is "free"
  (`server/src/db/schema/runs.ts`). The list renders `—`, matching the design. Covered by AC-24.

## Design analysis

Design sources given: `reference/devdigest-design/` — screen keys `export-to-ci` (artboard
`export`, entry `src/features/ci/export-to-ci.jsx`), `ci-runs` (artboards `ci-runs`, `e-ci`,
entry `src/features/ci/ci-runs-and-eval-case.jsx`), `agents` (artboard `agent-ci`, `CITab` in
`src/features/agents/agents.jsx`), plus `BRIDGE.md` and `docs/design-manifest.json`. No screen in
this feature is undesigned, so nothing here is derived from an imagined artboard.

**1. States missing from the mockup**

- The wizard has no **loading** state, though Install is three sequential GitHub round trips.
- The wizard has no **failure** state for Install: no "GitHub rejected the push", no "the token
  lacks the `workflow` scope", no "that repository does not exist".
- The wizard has no **already installed** state, though re-export to the same repository is the
  normal second action.
- The wizard has no state for **the runner bundle being absent** — the mockup's file tree assumes
  five files that always exist.
- Preview shows exactly one file's contents (`YAML_PREVIEW`) for every selected path — the mockup
  never had to answer what an empty skill list, or a 3 MB bundle, looks like in that pane.
- CI Runs has an empty state (`e-ci`) and a `running` status in the contract (`CiRunStatus`), but
  the mockup's `CI_STATUS` map has only `succeeded` / `no_findings` / `failed`; a `running` row
  would render `undefined`.
- CI Runs has no error state for "the list could not be loaded".
- The CI tab's `exported` flag is a hardcoded `const` — the loading state between "we do not know
  yet" and "not exported to CI" is not designed, and those two must not look the same.

**2. Corner cases the design does not cover**

- Long `owner/name` and long agent names in a fixed nine-column grid.
- A repository string the user typed by hand that is not `owner/name`.
- More than a handful of runs: the mockup lists five rows and has no pagination or cap.
- More than a handful of installations on the CI tab: the badge reads "Active in 2 repos".
- `findings` counters all zero (the mockup renders `—`) versus `findings_count` null (unknown) —
  two different facts that the mockup collapses into one dash.
- `cost_usd` null versus `0` — same collapse, and this repository has an explicit rule that they
  render differently.
- Duration missing (a hard runner failure writes no artifact, so there is nothing to ingest and
  no row at all) — the design implies a row could exist with `duration: null`.
- Zero skills attached, so `FILES TO CREATE` has three entries rather than five.

**3. How the involved modules talk**

`client` (wizard) → `POST /agents/:id/export-ci` → `ci` service → `agents` data (manifest) +
`skills` data (bodies) + local disk (`agent-runner/dist/`, all three files) → `GitHubPort.commitFiles` /
`findOpenPr` / `openPullRequest` → `ci_installations`. Then, entirely outside this process:
target repo's GitHub Actions → `node .devdigest/runner/index.js` → `reviewer-core` → PR review +
`devdigest-result.json` → an HTTP POST back to `POST /ci/ingest` → `agent_runs` (`source='ci'`) +
`ci_runs`. The studio and the runner meet at exactly two contracts and nowhere else:
`AgentManifest` on the way out and `CiResultArtifact` on the way back. That is the whole reason
both are single Zod schemas shared by both ends, and the reason this pass changes neither.

The one hop that is neither a contract nor a network call is `agent-runner/dist/` — three files on
the developer's disk that the server reads and that no schema describes. It is the most likely
thing to be stale (nothing rebuilds it) and it is why AC-16 exists. It is also the hop where the
runner's module system crosses into a repository that has its own: see Risks.

**4. UX improvements proposed** (proposals, not requirements — do not plan them as work)

- Replace the mockup's undesigned Install failure with the sentence that names the fix
  (`gh auth refresh -h github.com -s workflow`), because that is the failure a first-time user
  actually hits.
- Show the workflow's `permissions` block in Preview above the fold: the reviewer of the generated
  PR is being asked to approve exactly that, and it is the whole security story.
- Add a repository column to CI Runs. The mockup has none, but a list of runs across repositories
  without a repository column cannot be read, and the graded criterion names it.
- Drop the "Trace" link from CI Runs rows until a CI run has a trace to open.

## Non-functional requirements

| Limit | Value | Why this number |
|---|---|---|
| runner bundle accepted for export | ≤ 8 MB across the three files (`index.js` is 1.6 MB today) | `commitFiles` sends every file's contents inline in one `createTree` request (`octokit.ts:264-300`); GitHub's blob limit is far higher, but an 8 MB ceiling keeps one export inside one request and fails loudly if `ncc` output ever balloons |
| runner bundle bytes crossing the API | 0 | each of the three runner files is listed by path and size in `CiExport.files`, never by contents — the client has no use for it and `client`'s query cache would hold megabytes per preview |
| `POST /agents/:id/export-ci` latency | p95 ≤ 20 s | three to five sequential GitHub calls (get ref, get commit, create tree, create commit, update/create ref) plus a PR creation, each already wrapped in the adapter's retry + timeout |
| ingest request body | ≤ 64 KB | `CiResultArtifact` is nine numeric/string counters plus a small envelope; the app-wide `bodyLimit` is 1 MB (`server/src/app.ts`), so a tighter per-route cap is a real guard rather than a restatement |
| ingest token length | ≥ 32 characters, compared in constant time | shorter than 32 is guessable at the rate an unauthenticated local endpoint permits; a non-constant-time comparison leaks the prefix |
| CI Runs list | 50 most recent rows, no pagination | the design shows five; 50 is a demo's worth of history and keeps one query and one render trivial. Ordering needs a secondary key — see Risks |
| generated workflow `permissions` | exactly 2 entries | everything not listed is set to `none` by GitHub, which is the point |

## Inputs and provenance

| Input | Where it comes from | When it is stale | If missing |
|---|---|---|---|
| agent config (name, provider, model, system prompt, strategy, `ci_fail_on`) | `agents` row, this workspace | the moment the agent is edited after an export — the installed manifest is a snapshot, and re-export is manual | the route 404s, as `GET /agents/:id` already does |
| attached skill bodies | `skills` + `agent_skills`, ordered | same as above | an agent with no skills exports a manifest with `skills: []` (valid) |
| runner bundle | `agent-runner/dist/` — `index.js`, `300.index.js`, `package.json` — produced by `pnpm build` (`ncc`), git-ignored | whenever `agent-runner/src` or `reviewer-core` changed since the last build — nothing detects this | AC-16: refuse the export and name the command |
| target repository `owner/name` | typed by the user in the wizard | never | the wizard's own validation rejects it before any request |
| GitHub write credentials | `SecretsProvider` → `GITHUB_TOKEN` (`~/.devdigest/secrets.json`, mode 0600) | when the token expires or its scopes change; the `workflow` scope is required to push a `.github/workflows/*` file, and this machine's token already carries it (`gist, read:org, repo, workflow`, per `gh auth status`) — `reference/lessons/WORKING-ORDER.md` still lists that refresh as an outstanding prerequisite and is stale | AC-17's path — a GitHub error with its reason |
| `OPENROUTER_API_KEY` in the target repository | the target repo's Actions Secrets, added by a human — already present in `devsiteua/devdigest-review-fixtures`, with Actions enabled (`gh api repos/…/actions/secrets`), so `WORKING-ORDER.md` is stale here too | never, from our side | the runner's first model call fails and the job goes red; the studio never sees it and cannot |
| `DEVDIGEST_CI_TOKEN` | `SecretsProvider`, this machine; the same value pasted into the target repo's Actions Secrets by a human | when either copy is rotated without the other | AC-18: ingest rejects every request |
| `DEVDIGEST_INGEST_URL` | the target repo's Actions Secrets | when the studio's address changes | AC-13: the workflow skips the ingest step |
| `devdigest-result.json` | written by the runner in the target repo's CI (`agent-runner/src/artifact.ts`) | never — it describes one commit | no artifact means the run hard-failed; nothing is posted and no row is created, which is the runner's documented behaviour |
| ingest envelope (`repo`, `pr_number`, `commit_sha`, `run_url`, `exit_code`) | GitHub Actions context in the workflow *we* generate | never | AC-19 |

## Untrusted inputs

This feature has real ones, on both legs of the round trip.

- **The target repository's diff, PR title and PR body** reach a model's context inside the runner.
  They are already wrapped by `assemblePrompt` / `wrapUntrusted` + `INJECTION_GUARD`
  (`agent-runner/CLAUDE.md` § Invariants, `run.ts:112-124`). This pass adds no new path into that
  prompt and must not pre-wrap anything on the studio side — `assemblePrompt` wraps `diff` and
  `prDescription` itself, and a second wrap escapes the first (root `INSIGHTS.md`, 2026-08-29).
- **Skill bodies whose `source` is not `manual`** are data, not instructions, and the export must
  carry that distinction into the file it writes (AC-05). This is the only place in this change
  where a trust boundary could be lost silently — the runner has no way to recover it, because it
  reads bodies from disk with no provenance.
- **Everything in the ingest request** — the envelope and `devdigest-result.json` — arrives from a
  process running in somebody else's CI. It is validated (AC-19), strictly parsed (AC-22), and
  used only as numbers, an integer PR number, a hex SHA and a URL. No field of it selects a
  workspace (AC-23), none of it reaches a prompt, and none of it is rendered as markup.
- **PR titles, branch names and comment bodies from the target repository never become shell
  commands** in the generated workflow: the workflow interpolates no `github.event.*` string into
  a `run:` line. Everything the runner needs it reads from `process.env` itself.
- **This spec's own content** does not reach a prompt.

## Test plan

| Lane | Covers |
|---|---|
| server unit (`cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`) | AC-03 (bundle side), AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11 (the `if:` line), AC-12 (generator side), AC-13 — all of workflow/manifest generation, which is pure string work and needs no DB |
| server integration (`cd server && pnpm exec vitest run .it.test`, Docker) | AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-31 — everything that writes a row or calls the GitHub port (through `server/src/adapters/mocks.ts`, never a real network) |
| client component (`cd client && pnpm test`) | AC-01, AC-02, AC-03 (screen side), AC-12 (form side), AC-24, AC-25, AC-27, AC-28, AC-29 |
| shell | AC-26 (`git diff --name-only`), AC-28's second half (`grep`), AC-30 (`diff` + `pnpm typecheck` in both packages) |
| `agent-runner` (`cd agent-runner && pnpm test`) | nothing new — run unchanged, as the proof that this stream did not touch it |
| architecture (`cd server && pnpm arch:check`) | the new module obeys `routes → service → repository`. **Read its output, not its exit code** — `no-cross-module-import` is a warning and dependency-cruiser exits 0 on warnings (root `INSIGHTS.md`, 2026-08-22) |

**Deliberately not covered by an automated test:**

- **The end-to-end flow in a real repository** — a test PR in `devsiteua/devdigest-review-fixtures`
  receives the agent's review; a CRITICAL makes the required check red; no secret appears in the
  job log or the uploaded artifact; the run shows up in CI Runs with a link to the job. Manual,
  because it needs a real GitHub repository, real Actions minutes, a real model call and a branch
  ruleset. Nothing in this repository can stand in for GitHub's own permission model.
- **AC-11 against a genuine fork PR** — the unit test asserts the `if:` expression; only GitHub can
  prove what it does. Manual, and explicitly the second run: the first pass is done from a
  non-fork branch so the secrets scenario is unambiguous.
- **"No secret in a log or an artifact"** — verified by reading the job log and the uploaded
  artifact by hand. AC-10 covers only what the studio generates.

## Risks

| Risk | How we would notice | What we do |
|---|---|---|
| the target repository declares `"type": "commonjs"` (or no `type` at all), so `node .devdigest/runner/index.js` dies with `Cannot use import statement outside a module` | every CI run fails at the runner's first line, before any review, with an error about our file in someone else's repository | removed by construction rather than papered over: the export copies `ncc`'s generated `dist/package.json` (`{"type": "module"}`) into `.devdigest/runner/` (AC-35), which scopes the module type to that directory whatever the target repo declares. Verified, not assumed — `dist/index.js` line 1 is an `import`, and our own target repo `devsiteua/devdigest-review-fixtures` already declares `"type": "module"`, so this failure class was invisible along the entire demo path and would have shipped |
| the exported manifest drifts from the agent it was exported from (the agent is edited afterwards) | a CI review behaves unlike the local one for the same PR | accept it in this pass — the manifest is a snapshot by design (the lab says so); the CI tab shows the installation time, and "Update CI config" is out of scope |
| `agent-runner/dist/` is stale rather than missing — built once, never rebuilt | a CI run behaves like an old `reviewer-core` | AC-16 catches absent, not stale. Recorded here deliberately; a build-freshness check is iteration 2 |
| the contract mirror edit breaks literals in both packages — `.default()` fields are optional on input and **required** on `z.infer` (root `INSIGHTS.md`, 2026-08-29) | `pnpm typecheck` red in server *and* client, with `TS2741` | `AgentManifest` is a new export rather than a new field on an existing type, so no existing literal gains a key; the two `'openrouter'` widenings only widen unions. Sweep with `grep -rn ": AgentManifest = {" server/src client/src` before committing anyway |
| `check:contract-mirror` in `/pr-self-review` compares changed *lines*, so repairing pre-existing drift on one side trips it even when the files end up identical (root `INSIGHTS.md`, 2026-08-06) | a scripted CRITICAL on a correct mirror edit | expect it, verify the two files by `diff`, and use the override — which section 3 of the gate now honours when `override.reason` is present and the diff digest matches |
| ordering of the CI Runs list is planner order for rows written in one transaction — `defaultNow()` is the transaction's timestamp (root `CLAUDE.md` § Gotchas) | two runs ingested together appear in an arbitrary order | order by `ran_at` **and** a secondary key; the cap in the NFR table makes the wrong order visible rather than buried |
| a migration collides with another stream's | `pnpm db:generate` produces a second file with the same number | only one stream generates at a time (`WORKING-ORDER.md`); L07-A needs none, since `multi_agent_runs` already exists |
| a skipped fork job may not satisfy a *required* status check, leaving a fork PR unmergeable | a fork PR sits pending forever | out of the first pass's demo path (the first run is deliberately non-fork), and recorded in Open questions rather than silently designed around |
| the ingest endpoint is the only unauthenticated-app route that carries a token, and it is easy to make it fail *open* | nothing — that is the danger | AC-18 tests the unset-secret case explicitly, because "no token configured" is exactly the state a fresh machine is in |

## Open questions

1. **How does a result from GitHub-hosted Actions reach a studio on `localhost:3075`?** The
   endpoint's own behaviour is fully specified (AC-18 – AC-23) and does not depend on the answer,
   but the *demo* does. **Answered: no tunnel.** The workflow always uploads
   `devdigest-result.json` as a run artifact (AC-32); the POST to the studio happens only where
   `DEVDIGEST_INGEST_URL` is set and can never redden the job (AC-13). For the graded run the
   artifact is downloaded from the job and POSTed to the same authenticated endpoint by hand — the
   same route, the same token, the same validation, so nothing about the ingest is demo-only. A
   tunnel stays a supported configuration, not a prerequisite: it costs a prerequisite we do not
   otherwise need and gives the first pass nothing the artifact path does not.
2. **What is "workflow version" on the CI tab?** The design shows it; nothing persists it.
   `ci_installations` has no such column, and the runner's own `RUNNER_VERSION` is the constant
   `'1'` (`agent-runner/src/artifact.ts:6`). **Answered: the runner constant plus
   `installed_at`, and no new column** (AC-27). `RUNNER_VERSION` is honest — it is the version of
   the bundle that was exported, and the ingested artifact carries it back, so the two can be
   compared. A content hash of the generated workflow would be more precise and would need a
   column that AC-31 deliberately does not add; it is the right answer for the pass that makes
   re-export a first-class operation, not for this one.
3. **How is a skill slug derived, and what happens on a collision?** **Answered: kebab-case of
   `skills.name`, and a collision refuses the export** (AC-33). See Edge cases for the reasoning.
4. **Should a fork PR's skipped job count as a passing required check?** Answered for this pass:
   it does not matter, because the first run is deliberately not from a fork
   (`reference/lessons/WORKING-ORDER.md`, its prerequisites section) and fork support is not a graded criterion.
   Recorded in Risks so the next pass does not rediscover it.
5. **Does the ingest need rate limiting of its own?** Answered: no. The app-wide limiter is 120/min
   and is disabled under `NODE_ENV=test` anyway, so a per-route limit could not be exercised by an
   integration test (`server/INSIGHTS.md`, 2026-08-30). The 64 KB body cap and the token are the
   guards this pass ships.
6. **Should CI runs appear in the agent's existing local run history as well as CI Runs?** Answered:
   they will, unavoidably and correctly — they are `agent_runs` rows, and the design's own Stats
   tab already renders a `local` / `CI` source badge per row (`agents.jsx:106,113`). No extra work.
