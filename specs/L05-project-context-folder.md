# L05 — Project Context Folder

Spec ID: L05-PROJECT-CONTEXT-FOLDER
Status: done
Supersedes: none
Owner: devsiteua
Packages touched: server, client

> The implementation plan does **not** live here — it lives in
> `plans/L05-project-context-folder.md` alongside this file. See `README.md` § Where plans live.

## Problem and user

The user is a developer running a review on their own repository. Today the reviewer judges a
diff with no access to the project's written intent: the PRD that says public endpoints must be
rate-limited, the ADR that says Redis is the shared singleton, the style guide that says a
handler never hand-rolls `.parse(req.body)`. The prompt already has a slot for exactly this and
nothing fills it — `docs/glossary.md` § Slot names `specs` as the L05 slot, `PromptParts.specs`
is declared in `reviewer-core/src/prompt.ts:83`, `PromptAssembly.specs` is declared in
`server/src/vendor/shared/contracts/trace.ts:43`, the Run Trace drawer already renders both
(`client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:39,95`),
and `RunTrace.specs_read` is hardcoded to `[]` at `server/src/modules/reviews/run-executor.ts:310`
and `:508`. The cost is a reviewer that can only judge a diff against general programming
knowledge, and a user who has to re-explain their project in every agent's system prompt.

## Goals / Non-goals

**Goals**

1. A repository can hold a set of project documents that DevDigest owns, independent of the
   repository's own contents.
2. Those documents reach a review's prompt as data, in an order the user controls, under a
   budget that is a named number rather than an accident.
3. Whether an agent reads them is that agent's own setting, the way `repo_intel` already is.
4. A finished run can be asked which documents it read, and shows the text it actually sent.
5. A repository with no enabled documents produces the prompt it produces today, byte for byte.

**Non-goals**

- **Not a wiki, and not an editor.** Project Context stores documents the user wrote elsewhere.
  Authoring, renaming and folder structure are not the shape we are building.
- **Not retrieval.** No relevance ranking, no per-PR selection, no embedding lookup. The set is
  what the user enabled, in the order the user set.
- **Not a second skills system.** A skill is a rule addressed to the reviewer; a project
  document is evidence about the project. They render into different prompt sections, they are
  budgeted separately, and neither may be expressed through the other.

## Context

What already exists and is therefore not built again. Link, do not restate.

| Already true | Where |
|---|---|
| `PromptParts.specs?: string[]` accepts whole documents and wraps each as `spec-N`; `assemblePrompt` renders them under `## Project context` between the repo skeleton and the callers digest | `reviewer-core/src/prompt.ts:83, 143-146, 174` |
| `wrapUntrusted()` and the `INJECTION_GUARD` appended to every system prompt on every review path, studio and CI alike | `reviewer-core/src/prompt.ts:16-33` |
| `PromptAssembly.specs` and `RunTrace.specs_read` exist in the contract and are rendered by the Run Trace drawer | `server/src/vendor/shared/contracts/trace.ts:43,105`; `RunTraceDrawer/_components/TraceBody/TraceBody.tsx:39,95` |
| A per-agent context switch with a global env gate — `Agent.repo_intel`, `AgentVersionConfig.repo_intel`, `repoIntelEnabled` from `REPO_INTEL_ENABLED`, read as `agent.repoIntel !== false` | `server/src/vendor/shared/contracts/knowledge.ts` (`Agent`); `server/src/platform/config.ts:57,79`; `server/src/modules/reviews/run-executor.ts:180-194` |
| Tail-dropping under a character budget, in the user's stated order, with the dropped names kept rather than silently lost | `renderSkillBlocks`, `server/src/modules/reviews/helpers.ts:105-131`; `MAX_SKILLS_CHARS = 24_000`, `server/src/modules/reviews/constants.ts:26` |
| The trust rule that only `manual`-sourced text bypasses the untrusted wrap, and that a request body may never claim its own trust level | `server/src/vendor/shared/contracts/knowledge.ts` (`SkillSource` comment) |
| A repo-scoped module with repo-scoped routes and a repo-scoped page: `conventions` | `server/src/modules/conventions/routes.ts`; `client/src/app/repos/[repoId]/conventions/` |
| `code_chunks` with `workspace_id`, `repo_id`, `path`, `content`, a 1536-dim `embedding` and `source: 'code' \| 'docs' \| 'spec'` — empty, and left untouched by this spec | `server/src/db/schema/context.ts` |
| `repos.clone_path` — the user's repository on disk, which this feature must never write to | `server/src/db/schema/repos.ts` |
| `NAV` entries carry `href` with a `:repoId` token and an optional `gKey`; `c` belongs to Conventions | `client/src/vendor/ui/nav.ts:47` |
| The `Agent` contract is currently **identical** in both mirrors (verified by diff on 2026-08-29), so the drift warning in root `CLAUDE.md` § Gotchas is a warning about this change, not a description of today | `server/src/vendor/shared/contracts/knowledge.ts` vs `client/src/vendor/shared/contracts/knowledge.ts` |

## In scope

- A document-level table beside `code_chunks`, keyed by `workspace_id` + `repo_id`, carrying at
  minimum an id, a title, a display path label, the body, `enabled`, an explicit `order`, a byte
  size and `updated_at`, with the repo foreign key cascading on delete.
- Contracts for that document and its write operations in `server/src/vendor/shared`, mirrored
  into `client/src/vendor/shared`.
- A repo-scoped server module (`server/src/modules/context/`) exposing list, upload, delete,
  enable/disable and reorder over `/repos/:id/context…`.
- Prompt composition in `server/src/modules/reviews/`: the enabled set in `order`, each body
  wrapped by `wrapUntrusted()`, under a named budget constant of this module's own.
- `Agent.project_context` and `AgentVersionConfig.project_context`, plus a global
  `PROJECT_CONTEXT_ENABLED` env gate in `server/src/platform/config.ts`, both mirrored.
- `RunTrace.specs_read` filled with what the run read, replacing the two hardcoded `[]`.
- A page at `client/src/app/repos/[repoId]/context/` — document tree, read-only preview, upload,
  delete, enable/disable, reorder, the design's empty state — plus its `NAV` entry and its
  strings in `client/messages/en/`.

## Out of scope

- **The Onboarding generator.** L05's second feature, its own spec, its own table
  (`onboarding` in `server/src/db/schema/context.ts`). Nothing here generates a document.
- **The PR Brief card.** L05's third feature, its own spec. This spec adds no PR-page surface.
- **Per-PR semantic retrieval over `code_chunks.embedding`.** An L06 candidate. Excluded because
  `EMBEDDINGS_ENABLED` defaults to `false` (`server/src/platform/config.ts:78`), so a
  retrieval-based feature would be inert on a default install — the reviewer would silently see
  no project context on the machine of every user who never set the variable.
- **`New file`, `New folder`, and the `Preview | Edit` editor with save-and-reindex** that the
  `context` artboard shows. An in-browser markdown editor with dirty state, conflict handling
  and a save path is a materially larger surface than an upload box, and it is not what makes
  the reviewer stop judging in a vacuum. Deferred to L06.
- **The 78% circular COVERAGE score** on that artboard. Nothing in the repository defines what it
  is a percentage of, and an undefined number rendered as a score becomes decoration that later
  has to be explained rather than removed.
- **PDF and other binary formats.** A parser dependency for a lesson that is about context, not
  about file formats.
- **A sixth MCP tool.** `mcp/` stays at five; no tool in it needs project context to answer.
- **Chunking documents into `code_chunks`.** The table keeps its `'spec'` enum member for the
  retrieval lesson that will use it; this feature writes nothing into it.
- **A keyboard shortcut for the new page.** `gKey: "c"` belongs to Conventions, and reshuffling a
  shipped shortcut is a worse change than shipping a nav entry without one.
- **Anything writing into `repos.clone_path`.** Documents are DevDigest's, not the repository's.

## User stories

- As a developer whose PRD says every public endpoint must be rate-limited, I want that PRD in
  the reviewer's prompt, so that a new unlimited public route is flagged against my project's
  own rule rather than against a generic one.
- As a developer with one strict security agent and one fast style agent, I want to choose which
  of them carries the documents, so that the cheap agent stays cheap.
- As a developer whose document set grew past the budget, I want to control which documents are
  dropped, so that the tail I lose is the tail I chose.
- As a reviewer of a finished run, I want to see which documents it read and the exact text it
  was sent, so that a surprising finding can be traced to its grounding.
- As someone who arrives with an empty repository and no documents, I want the screen to tell me
  what belongs here and what it will do, so that the feature explains itself before I use it.
- As someone who never opens this screen, I want my prompts and my costs to be exactly what they
  were, so that a feature I do not use is a feature I do not pay for.

## Acceptance criteria (EARS)

| AC-ID | Pattern | Criterion | How it is checked |
|---|---|---|---|
| AC-01 | ubiquitous | Система повинна (shall) зберігати документи проєктного контексту виключно в Postgres, у рядках, ключованих парою `workspace_id` + `repo_id`. | `cd server && pnpm exec vitest run .it.test` — інтеграційний тест читає рядок після завантаження |
| AC-02 | ubiquitous | Система повинна (shall) не виконувати жодного запису у файлову систему під час завантаження, видалення чи зміни документа. | `grep -rn "writeFile\|mkdir\|createWriteStream\|rename\|rm(" server/src/modules/context/` повертає порожньо |
| AC-03 | ubiquitous | Система повинна (shall) використовувати `path_label` лише як рядок для відображення і ніколи не як шлях у файловій системі. | `grep -rn "pathLabel" server/src/modules/context/` — жодного входження в `join`, `resolve`, `readFile` |
| AC-04 | event-driven | КОЛИ користувач завантажує файл `.md` або `.txt` розміром до 256 КБ у репозиторій, де вже менше ніж 50 документів, система повинна (shall) створити документ увімкненим і з `order`, більшим за всі наявні. | `.it.test` на `POST /repos/:id/context` |
| AC-05 | unwanted | ЯКЩО завантажений файл має розширення, відмінне від `.md` і `.txt`, ТОДІ система повинна (shall) відхилити запит із назвою дозволених розширень і не створити жодного рядка. | `.it.test` — 400 і `SELECT count(*)` без змін |
| AC-06 | unwanted | ЯКЩО завантажений файл перевищує 256 КБ, ТОДІ система повинна (shall) відхилити запит, назвавши ліміт у повідомленні, і не створити жодного рядка. | `.it.test` — 413 і `SELECT count(*)` без змін |
| AC-07 | unwanted | ЯКЩО репозиторій уже містить 50 документів, ТОДІ система повинна (shall) відхилити завантаження з причиною і не створити жодного рядка. | `.it.test` — 409 після 50 вставок |
| AC-08 | unwanted | ЯКЩО тіло завантаженого файлу порожнє або складається лише з пробільних символів, ТОДІ система повинна (shall) відхилити запит із причиною. | `.it.test` |
| AC-09 | event-driven | КОЛИ користувач видаляє документ, система повинна (shall) прибрати його з наступних промптів і залишити репозиторій користувача на `repos.clone_path` без змін. | `.it.test` — промпт після видалення плюс `git status` у клоні |
| AC-10 | event-driven | КОЛИ користувач змінює порядок документів, система повинна (shall) зберегти новий `order` і рендерити секцію промпта саме в ньому. | unit-тест композиції промпта + `.it.test` |
| AC-11 | ubiquitous | Система повинна (shall) обгортати тіло кожного документа через `wrapUntrusted()` — без жодного довіреного шляху, аналогічного `manual` у скілах. | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — unit-тест на рендер; `grep -n "source === 'manual'" server/src/modules/context/` порожньо |
| AC-12 | state-driven | ПОКИ сумарний обсяг увімкнених документів не перевищує бюджет слота, система повинна (shall) вкладати в промпт усі увімкнені документи в порядку `order`. | unit-тест композиції промпта |
| AC-13 | unwanted | ЯКЩО зібрана секція перевищує 24 000 символів, ТОДІ система повинна (shall) відкидати документи цілком із хвоста `order` і записувати назви відкинутих у лог прогону. | unit-тест із документами понад бюджет + перевірка рядка логу |
| AC-14 | ubiquitous | Система повинна (shall) будувати секцію промпта зі збереженого тіла документа, а не зі стану будь-якого індексу. | `grep -rn "code_chunks\|codeChunks" server/src/modules/reviews/` порожньо |
| AC-15 | state-driven | ПОКИ репозиторій не має жодного увімкненого документа, система повинна (shall) формувати промпт, побайтово ідентичний до промпта без цієї функції. | unit-тест порівняння рядка промпта з наявним snapshot |
| AC-16 | optional | ДЕ для агента ввімкнено `project_context` і глобальний прапорець `PROJECT_CONTEXT_ENABLED` не вимкнено, система повинна (shall) додавати секцію `## Project context` до промпта цього агента. | unit-тест на два агенти в одному репозиторії |
| AC-17 | unwanted | ЯКЩО глобальний прапорець `PROJECT_CONTEXT_ENABLED` вимкнено, ТОДІ система повинна (shall) не додавати секцію жодному агентові незалежно від його власного перемикача і записати причину в лог прогону. | unit-тест з конфігом, у якому прапорець вимкнено |
| AC-18 | ubiquitous | Система повинна (shall) тримати `Agent.project_context` і `AgentVersionConfig.project_context` ідентичними в обох копіях контракту. | `diff server/src/vendor/shared/contracts/knowledge.ts client/src/vendor/shared/contracts/knowledge.ts` — без розбіжностей у цих полях |
| AC-19 | event-driven | КОЛИ прогін завершується з непорожньою секцією проєктного контексту, система повинна (shall) записати в `specs_read` перелік прочитаних документів, а в `prompt_assembly.specs` — надісланий текст. | `.it.test` на прогін + читання `run_traces` |
| AC-20 | ubiquitous | Система повинна (shall) зберігати в трасі текст у тому вигляді, у якому його було надіслано, так що пізніша зміна або видалення документа не змінює вже записану трасу. | `.it.test` — видалення документа після прогону, повторне читання траси |
| AC-21 | event-driven | КОЛИ користувач відкриває `/repos/:repoId/context`, система повинна (shall) показати документи репозиторію в порядку `order`, мітку шляху та підсумковий рядок із їх кількістю. | `cd client && pnpm test` — компонентний тест сторінки |
| AC-22 | state-driven | ПОКИ репозиторій не має жодного документа, система повинна (shall) показувати порожній стан із поясненням призначення папки та дією завантаження. | компонентний тест порожнього стану |
| AC-23 | ubiquitous | Система повинна (shall) показувати вміст документа лише для читання, без елемента керування, що редагує текст. | компонентний тест: у панелі перегляду немає `textarea` і немає перемикача `Edit` |
| AC-24 | event-driven | КОЛИ користувач обирає документ, система повинна (shall) показати, скількома увімкненими агентами читається проєктний контекст цього репозиторію. | компонентний тест на текст лічильника |
| AC-25 | ubiquitous | Система повинна (shall) мати запис навігації для Project Context без клавіатурного скорочення. | `grep -n "context" client/src/vendor/ui/nav.ts` — запис є, поля `gKey` немає |
| AC-26 | event-driven | КОЛИ репозиторій видаляється, система повинна (shall) видалити всі його документи проєктного контексту. | `.it.test` — видалення репозиторію, `SELECT count(*)` = 0 |

## Edge cases

- **No documents at all.** Covered by AC-15 and AC-22 — prompt unchanged, screen explains itself.
- **Documents exist but all disabled.** Same prompt as none: AC-15 is written over *enabled*
  documents, so a fully disabled set is the empty set for prompt purposes.
- **Set larger than the budget.** Covered by AC-13. The dropped names go to the run log, never
  nowhere — the skills slot's precedent (`renderSkillBlocks`) is that a silent drop is the bug.
- **A single document larger than the whole budget.** It is droppable like any other and will be
  dropped by AC-13, so a 200 KB document silently starves the rest of the set. No separate
  criterion: it is the same tail-drop rule, and the fix the user has is `order` and the toggle.
- **Wrong file type, oversize file, 51st document, empty body.** AC-05 to AC-08, each rejecting
  before any write.
- **Duplicate title in one repository.** Allowed. Two documents may legitimately be called
  `README.md` from different projects, and the row's id is what identifies it. No criterion —
  nothing degrades, and a uniqueness rule here would reject a valid upload.
- **A document deleted after a review ran.** Covered by AC-20: the trace keeps its own copy.
- **Repository deleted.** Covered by AC-26 via the cascading foreign key.
- **Global flag off while agents have the switch on.** Covered by AC-17, including the log line —
  an absent section with no stated reason is indistinguishable from a bug.
- **Two uploads at once into a repository at 49 documents.** Both may pass the count check before
  either writes. No criterion: the ceiling is a guard rail against a runaway prompt, not a
  security boundary, and the cost of exceeding it by one is one extra row that the budget in
  AC-13 already contains.
- **Concurrent reorder from two tabs.** Last write wins; `order` is a plain column. No criterion —
  this is a single-user local studio and the observable damage is a list in the wrong order,
  which the user fixes by dragging again.

## Design analysis

**Design sources used.** Screen key `project-context`, artboards `context` and `e-context`, from
the local snapshot at `reference/devdigest-design/`: `docs/design-manifest.json`,
`docs/SCREEN_CATALOG.md`, `src/features/intelligence/tour-and-project-context.jsx` (`ScreenContext`),
`BRIDGE.md` § Navigation and § Screen key → real route. Nothing on this screen is derived.

### States missing from the mockup

- **Loading.** The artboard renders a populated tree instantly. `@devdigest/ui` ships `Skeleton`
  for this (`BRIDGE.md`, § "extras the design does not show").
- **Error.** No state for a failed list or a failed upload. `ErrorState` exists for it.
- **Upload in flight.** No progress or disabled affordance while a 256 KB body is posting.
- **Rejected upload.** The mockup has no place to render the reasons AC-05 to AC-08 produce.
- **Disabled document.** The tree shows one selected row and one unselected style. There is no
  visual for a document that exists but is switched out of the prompt — the state this feature's
  toggle creates.
- **Dropped by the budget.** No visual for a document that is enabled but did not fit. The run
  log carries it (AC-13); the tree does not say it.
- **Empty state is present** and its copy is usable as-is: "No spec files yet" / "Drop your PRDs,
  tech specs, and acceptance criteria here. Every agent reads them as grounding context." — with
  one correction: after answer 6 that sentence is false for an agent whose switch is off, so the
  string that ships must not promise *every* agent.

### Corner cases the design does not cover

- The footer reads "Indexed: 12 files · 1,240 chunks · last 5m ago". This feature does no
  chunking and no indexing, so the chunk count and the freshness line have no source. What is
  honest is the document count and the total size.
- "Used by 3 agents" sits in a per-document header, which reads as per-document attribution. It
  is not: after answer 6 the number is a property of the repository's agents, identical for every
  document. The same trap `SkillStats` documents for findings attribution.
- The tree renders `.devdigest/specs/` as a path. Nothing on disk corresponds to it (answer 1), so
  the label must not be presented as somewhere the user can `cd`.
- No affordance for `order` — the mockup's list has no drag handle, yet `order` is what decides
  what survives the budget.
- No count or size against the 50-document and 256 KB ceilings.

### How the involved modules talk

- `client` page → `server` module `context` over `/repos/:id/context…`, the same repo-scoped
  route shape `conventions` already uses. Data reaches the page through a hook in
  `client/src/lib/hooks/`, never a `fetch` in a component (`BRIDGE.md` adaptation rule 3).
- `server` module `context` → `server` module `reviews`: the run executor reads the enabled
  document set for the pull's repository and renders it into `PromptParts.specs`, beside the
  existing `repoMap` and `callers` enrichment at `run-executor.ts:180-194`.
- `reviews` → `reviewer-core`: nothing new crosses. `assemblePrompt` already accepts `specs` and
  already wraps each entry; `reviewer-core` needs no change, which is what keeps AC-15's
  byte-identical promise cheap to hold.
- `reviews` → `run_traces`: `specs_read` and `prompt_assembly.specs`, both already in the
  contract and already rendered by the drawer.
- The budget constant lives in `server/src/modules/reviews/constants.ts` beside
  `MAX_SKILLS_CHARS` as its own name, because the two slots compete inside one prompt and must be
  able to move independently.

### UX improvements proposed

Each is a **proposal**, not a requirement, and none is planned unless it is picked up:

- Show each document's size and the repository's total against the 256 KB / 50 ceilings, so the
  rejections in AC-05 to AC-07 are predictable rather than discovered.
- Mark, in the tree, which documents fit inside the budget at current `order` — turning AC-13
  from a log line into something visible before a run.
- Replace the mockup's chunk counter with "N documents · X KB of 24,000-character budget".
- State on the document header which agents read project context, by name, rather than a count —
  the count is the same for every document and reads as if it were not.

## Non-functional requirements

| Limit | Value | Why this number |
|---|---|---|
| Character budget for the `## Project context` slot | 24,000, as its own named constant | It matches the skills slot today (`MAX_SKILLS_CHARS`, `server/src/modules/reviews/constants.ts:26`) and has **no independent justification yet** — stated plainly so the next person changes it with evidence rather than defending it as a decision. It is a separate constant precisely so that evidence can move one slot without touching the other. |
| Maximum size of one document | 256 KB | Roughly ten times the whole slot budget, so a single realistic PRD or ADR is never rejected for size, while a file that could only be a mistake — a bundled export, a log, a minified asset — is. |
| Maximum documents per one repository | 50 | Well above the design's twelve and above any hand-curated document set, while keeping the list a screen the user reads rather than searches, and keeping the unbounded worst case out of the prompt path. |
| Extra model calls added per review | 0 | The set is read from Postgres and rendered. No classification, no ranking, no embedding — which is what makes the feature work with `EMBEDDINGS_ENABLED` unset. |
| Added prompt cost when the feature is unused | 0 tokens | AC-15. An unfilled slot must produce a byte-identical prompt (`docs/glossary.md` § Slot). |

## Inputs and provenance

| Input | Where it comes from | When it is stale | If missing |
|---|---|---|---|
| Document body | Uploaded by the user, stored verbatim in Postgres | When the user's real document changes elsewhere and the upload is not repeated — DevDigest has no link back to any source | The set is smaller; the prompt section shrinks or disappears (AC-15) |
| `enabled`, `order` | Set by the user on the Project Context page | Never — they are the user's current statement of priority | Defaults: enabled on creation, `order` after the existing tail (AC-04) |
| `Agent.project_context` | The agent's own configuration, snapshotted into `agent_versions` | Never — a version snapshot records what was true for that run | Read as on, matching `agent.repoIntel !== false` at `run-executor.ts:180` |
| `PROJECT_CONTEXT_ENABLED` | Environment, through `server/src/platform/config.ts` | Only at process restart | Read as on, matching `REPO_INTEL_ENABLED`'s `!== 'false'` shape |
| The document set at review time | Read by the run executor when the run starts | Immediately after the run — later edits do not change what was sent, which is why AC-20 keeps the trace's own copy | No section; AC-15 |
| `repos.clone_path` | The repository clone | Not consumed by this feature at all | Irrelevant — documents do not come from the clone (AC-01) |

## Untrusted inputs

Everything this feature adds to a prompt is untrusted, and there is deliberately no exception.

- **Document bodies.** Uploaded content, wrapped by `wrapUntrusted()` as `spec-N` before it
  reaches a model (AC-11). Unlike skills, there is **no trusted path**: `SkillSource` grants
  `manual` bodies a verbatim slot because a skill is a rule the user addressed to the reviewer,
  whereas a project document is evidence about the project and may have been written by anyone,
  copied from anywhere, or — per `specs/L05-sdd-pipeline.md` § Untrusted inputs — generated by
  this repository's own spec pipeline. A spec written today can end up inside a model call
  tomorrow through exactly this feature.
- **Titles and path labels.** User-supplied strings that reach both a model (as part of the
  rendered section) and a screen. They are data in both places.
- **What does not change.** The `INJECTION_GUARD` in `reviewer-core/src/prompt.ts` already covers
  this slot, on both the studio and the CI review path, and is not edited by this change.

## Test plan

| Lane | Covers |
|---|---|
| `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | AC-10 (order), AC-11, AC-12, AC-13, AC-15, AC-16, AC-17 — prompt composition, budget, trust wrapping, the two gates |
| `cd server && pnpm exec vitest run .it.test` | AC-01, AC-04 to AC-10, AC-19, AC-20, AC-26 — persistence, the four rejections, delete, the trace, the cascade |
| `cd client && pnpm test` | AC-21 to AC-24 — tree, empty state, read-only preview, the agent counter |
| shell greps named in the criteria table | AC-02, AC-03, AC-14, AC-18, AC-25 — the structural claims, each one a command that fails loudly |
| `cd client && pnpm typecheck` | that the mirrored contract compiles against the page and its hook |

**Deliberately not covered by an automated test:** the end-to-end browser flow (upload → enable →
run a review → open the Run Trace drawer → see the document listed). `e2e/` flows assert seed
literals, so an e2e flow here would mean seeding documents and pinning their text in
`e2e/specs/*.json`, which the seed-drift gotcha in root `CLAUDE.md` makes a standing maintenance
cost for one lesson's screen. It is checked by a manual run: the observer uploads a document,
runs a review, and confirms the document's name under `specs_read` and its wrapped text under the
prompt's Project context block in the drawer.

## Risks

| Risk | How we would notice | What we do |
|---|---|---|
| The mirror edit to `Agent` is forgotten and the copies drift — root `CLAUDE.md` § Gotchas warns of exactly this, and the `Agent` contract is identical today, so this change would be the drift | AC-18's `diff` command, and a client typecheck failure on the new field | AC-18 makes the diff a criterion rather than a habit |
| Editing `Agent` breaks something that re-declares its members inline rather than importing them | `grep` for the member name, not the symbol — the second gotcha in root `CLAUDE.md` | The obligation is stated here; the plan carries the grep |
| A large document set quietly starves the skills slot or the diff inside one prompt | Token counts in the run trace rising without more findings | Separate named budget, tail-drop logged (AC-13), and the proposal to show budget usage in the tree |
| Uploaded text is treated as instruction by a model | A finding that quotes a document's imperative back as a rule | `wrapUntrusted()` on every body with no trusted path (AC-11); the `INJECTION_GUARD` already covers the slot |
| The feature ships but nobody populates it, so the slot stays empty in practice | `specs_read` empty across every run in the trace history | The empty state's copy is the onboarding, and the Run Trace drawer already shows presence or absence per run |
| A user assumes `.devdigest/specs/` is a real folder and expects `git add` to work | A question about why a committed file did not appear | AC-03 keeps it a label in code; the page's copy must not present it as a path |
| The 24,000 number is copied forward forever because it looks decided | Nobody ever changes it | The `Non-functional requirements` row says outright that it has no independent justification yet |

## Open questions

**None open.** Thirteen questions were asked before this file existed; the user answered nine and
the main session decided four with reasons, on 2026-08-29. Two decisions were mine and are
recorded here with their reasoning, because a decision without its reason turns into a rule
nobody can revisit.

1. **No parse-and-confirm preview step before an upload is written.** `POST /skills/import/preview`
   exists because an imported skill bundle is *derived from*: frontmatter parsed, a name, type and
   description extracted, archive entries ignored, warnings emitted — the user confirms a machine's
   reading of their file. A `.md` or `.txt` upload here is stored verbatim; there is nothing
   derived to confirm. A two-step API for a one-step act would add a surface without adding a
   decision the user actually makes.
2. **An uploaded document is enabled on creation** (AC-04), rather than parked disabled. The
   design's empty state promises that documents here are read as grounding context, and a default
   that contradicts the screen's own copy is a trap. The toggle is the one-click reversal, and the
   per-agent switch (AC-16) is the coarser one.
3. **The global gate is a new `PROJECT_CONTEXT_ENABLED`, not a reuse of `REPO_INTEL_ENABLED`**,
   defaulting to on with the same `!== 'false'` reading. Reusing the repo-intel flag would make
   turning off the repo skeleton silently also turn off the user's own documents.
4. **`code_chunks` is not written to.** Its `source: 'spec'` member stays reserved for the
   retrieval lesson. Root `CLAUDE.md` § Gotchas — an empty table is a future lesson, not dead code.
