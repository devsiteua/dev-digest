# Implementation plan — L05 Project Context Folder

Spec: [`../L05-project-context-folder.md`](../L05-project-context-folder.md) · Spec ID `L05-PROJECT-CONTEXT-FOLDER` · Branch: `lesson-05`

## Requirements review

Every claim below was checked against the tree at `8576224`, not remembered.

- **Verified, not assumed — `reviewer-core` needs no change.** `PromptParts.specs?: string[]`
  (`reviewer-core/src/prompt.ts:83`), wrapped as `wrapUntrusted()` with a `spec-N` label at `:149-151`,
  rendered as `## Project context` at `:181` between `## Repo skeleton` and
  `## Callers of changed symbols`, and surfaced as `assembly.specs` at `:200`. The spec's
  `Packages touched: server, client` is correct. Note the label is `spec-0`-indexed, not
  `spec-1`; the spec's prose says `spec-N` and means the same thing.
- **Verified — the two contract mirrors are identical today.**
  `diff server/src/vendor/shared/contracts/knowledge.ts client/src/vendor/shared/contracts/knowledge.ts`
  is silent, as is the same diff for `contracts/platform.ts`. AC-18's risk is real and this
  change is the one that would create it.
- **Gap the spec does not mention at all — the removed feature left a live scaffold.**
  `client/src/lib/hooks/core.ts:123` already ships `useContextFiles(repoId)` calling
  `GET /repos/:repoId/context` and typing the answer `SpecFile[]`; `:131` ships
  `useReindexContext()` calling `POST /repos/:id/context/reindex`. `SpecFile`
  (`contracts/platform.ts:255`, under a `// ---- Project Context ----` heading) has
  `path / content / size / updated_at` — no id, no `title`, no `enabled`, no `order`, so it
  cannot carry this feature. `client/messages/en/context.json` exists in full, with keys for
  chunking, re-indexing and a `Preview | Edit` editor that this spec puts **out of scope**.
  This is precisely the pattern root `INSIGHTS.md` (2026-08-02, *"A feature cut from the starter
  leaves its scaffold behind"*) predicts. **Decision, to be confirmed:** add a new
  `ProjectContextDoc` contract rather than widening `SpecFile`; leave `SpecFile` and
  `IndexStatus` in place (they are the retrieval lesson's shapes, root `CLAUDE.md` § Gotchas);
  **delete** `useContextFiles` and `useReindexContext` from `core.ts` in the same step that adds
  the real hook, because after Step 3 the first is a hook typed against a route that returns a
  different shape — a live lie, not dormant scaffold — and the second calls an endpoint this
  spec has ruled out ever existing. Recorded as Step 6.
- **Contradiction between AC-05/AC-06 and `server/CLAUDE.md` § Conventions.** That file says
  *"Route schemas come from `@devdigest/shared`; invalid input is rejected with **422** before the
  handler runs."* AC-05 demands **400** for a wrong extension and AC-06 demands **413** for an
  oversize body. A Zod route schema cannot produce either. **Decision:** the route body schema
  stays deliberately loose (`filename: string`, `content: string`) and the four rejections
  (AC-05 to AC-08) are thrown by the service as
  `new AppError(code, message, 400 | 413 | 409 | 400)` — `server/src/platform/errors.ts:7` takes
  an explicit `statusCode`, and `app.ts:154` forwards it. Recorded in Step 3. Without this the
  criteria as written are unsatisfiable.
- **Ambiguity — "upload" has no transport in this repo.** `@fastify/multipart` is **not** a
  dependency (`server/package.json:23-33`). Two readings: add multipart, or post JSON. **Taken:**
  a JSON body, exactly like `POST /skills/import/preview`, whose `ImportPreviewBody` already
  carries `filename: z.string().min(1).max(255)` (`server/src/modules/skills/routes.ts:59`) —
  which is also what makes AC-05's server-side extension check possible. The browser reads the
  file with `FileReader`. `app.ts:49` sets `bodyLimit: 1_048_576`, so a 256 KB body plus JSON
  escaping fits with room to spare, and no dependency is added for one lesson.
- **Ambiguity — AC-24 says "агентами … цього репозиторію", and agents are not repo-scoped.**
  `agents` is keyed on `workspace_id` only (`server/src/db/schema/agents.ts:8-12`). **Taken:**
  the counter is *enabled agents in this workspace whose `project_context` is on*, and the string
  says so rather than implying a per-repo or per-document number — which is the same trap the
  spec's own Design analysis flags for "Used by 3 agents".
- **Ambiguity — "replacing the two hardcoded `[]`" (§ In scope).** `run-executor.ts:310` is the
  success path and must be filled. `:508` is inside `traceFromBuffer`, the failure/cancel trace,
  whose `prompt_assembly` is `{ system, skills: null, memory: null, specs: null, user: '' }` — a
  run that never assembled a prompt read nothing. **Taken:** fill `:310`; leave `:508` as `[]`,
  because AC-19 is written over a run that *finishes* with a non-empty section, and claiming
  documents were read on a failed run would make the trace lie. Recorded in Step 5.
- **Gap, closed by precedent — no agent-editor UI for the new switch.** `grep -rn repo_intel
  client/src` returns nothing outside `vendor/shared`: the existing per-agent flag has no UI
  either, and it is reached through `PATCH /agents/:id`. No AC asks for one, and the spec's
  client scope names only the context page. `Agent.project_context` therefore ships
  contract-and-API-only, exactly like `repo_intel`.
- **Unverifiable as written — AC-09's second half.** *"…і залишити репозиторій користувача на
  `repos.clone_path` без змін"*, checked by *"`git status` у клоні"*. An integration test has no
  clone: `repos.clone_path` is populated by a real import. What is checkable, and what Step 8
  will do, is AC-02's grep (no filesystem write API is imported by the module at all) plus the
  prompt half of AC-09. Wording that would make the second half testable: *"the module imports no
  filesystem write API"* — which is AC-02, so AC-09's clone clause is already covered by its
  neighbour and needs no test of its own.
- **Ordering constraint the spec implies but does not state.** The `agents.project_context`
  column and the `project_context_docs` table are one migration, not two — `pnpm db:generate`
  emits one file per invocation and migrations are applied by hand
  (root `CLAUDE.md` § Commands). Both schema edits therefore land in Step 1, before the contract
  that describes them.
- **Verified — the `NAV` edit AC-25 requires touches a do-not-touch file.**
  `client/src/vendor/ui/nav.ts` is under `client/src/vendor/ui/**`, *"edit only on explicit
  request"* (root and `client/CLAUDE.md`). AC-25 is that explicit request. Root `INSIGHTS.md`
  (2026-08-06) records that this exact edit produced a scripted CRITICAL in `/pr-self-review`
  during L02 and that `--override` does **not** clear it — expect it again at the pull request,
  and expect to answer it in prose rather than with the flag.

## Constraints in force

| Constraint | Source | What it forbids here |
|---|---|---|
| SQL only in `repository.ts`, HTTP only in `routes.ts`, pure transforms in `helpers.ts`, literals in `constants.ts` | `server/CLAUDE.md` § Conventions | a Drizzle query in `modules/context/service.ts`; the budget number inline in `helpers.ts` |
| Dependencies come from `container`, never by importing a sibling module | `server/CLAUDE.md` § Conventions; `.claude/skills/onion-architecture` | `modules/reviews/**` importing `modules/context/**` — it goes through a `container.projectContext` getter, the way `container.skillsService` and `container.conventions` already do (`server/src/platform/container.ts:135-142`) |
| `no-cross-module-import` is `severity: 'warn'`, so `arch:check` **exits 0 on it** | `server/INSIGHTS.md` 2026-08-06; `server/.dependency-cruiser-onion.cjs:96` | trusting the exit code — read the output, and never append to `.dependency-cruiser-known-violations.json` |
| Every route starts with `getContext(container, req)` and every query is scoped by `workspaceId` | `server/CLAUDE.md` § Conventions | a `repoId`-only `WHERE` clause; AC-01 is the same rule stated as a criterion |
| A new module is `modules/<name>/routes.ts` plus **one line** in `modules/index.ts` | `server/CLAUDE.md`; `server/src/modules/index.ts:29-43` | filesystem autoload, a second registration path |
| Invalid input is rejected with 422 by the route schema, before the handler | `server/CLAUDE.md` § Conventions | putting AC-05/AC-06's checks in the Zod body schema — see Requirements review |
| A contract edit in `server/src/vendor/shared` requires the mirror edit in `client/src/vendor/shared`, diffed before committing | root `CLAUDE.md` § Gotchas | splitting the mirror across two steps or two commits |
| After editing an object in `vendor/shared`, grep the other contract files for its **member names**, not the symbol | root `CLAUDE.md` § Gotchas | assuming an import search found every re-declaration of `Agent`'s members |
| `server/src/db/migrations/**` is generated; a new migration is `pnpm db:generate`, applied manually with `pnpm db:migrate` | root + `server/CLAUDE.md` § Do not touch | hand-writing or hand-editing SQL; assuming boot migrates |
| A DB test must carry the `*.it.test.ts` suffix | root `CLAUDE.md`; `TESTING.md` | putting the persistence tests in the unit lane |
| Each integration file starts its **own** Postgres container; the lane holds 13 today and adding one is a **load** change | `server/INSIGHTS.md` 2026-08-28; `server/test/helpers/pg.ts` | reading an unrelated red in `skills.it.test.ts` as a regression — remove the new file and re-run to separate the two |
| `client/src/vendor/ui/**` is do-not-touch except on explicit request | root + `client/CLAUDE.md` § Do not touch | any `nav.ts` edit beyond the single entry AC-25 names |
| No `fetch` in a component; a new endpoint means a new hook in `client/src/lib/hooks/`, exported through `hooks/index.ts` | `client/CLAUDE.md` § Conventions | calling `/repos/:id/context` from the page |
| No hardcoded copy in a component — strings live in `client/messages/en/` | `client/CLAUDE.md` § Map | inline English in the empty state |
| Only `<Name>.tsx` and `index.ts` are mandatory in a component folder; the wider six-file list is the older rule | `client/docs/component-anatomy.md:20`; `client/INSIGHTS.md` 2026-08-05 | creating empty `constants.ts` / `helpers.ts` to satisfy a convention the tree does not follow |
| `@testing-library/user-event` is **not installed** | `client/INSIGHTS.md` 2026-08-22 | `userEvent` in any new test — drive interaction with `fireEvent` |
| `defaultNow()` is the transaction's timestamp | root `CLAUDE.md` § Gotchas | ordering documents by `updated_at`; the list sorts on `order`, with `id` as the tie-break |
| The design lives at `reference/devdigest-design/` and is never committed or pointed at from a tracked file | user memory; `reference/devdigest-design/CLAUDE.md` | quoting the artboard's path into a repo file |

## Implementation plan

### Step 1 — the table and the agent column, in one migration   ·   package: server
Files:   `server/src/db/schema/context.ts` (edit — add `projectContextDocs`) ·
         `server/src/db/schema/agents.ts` (edit — add `projectContext`) ·
         `server/src/db/migrations/0014_*.sql` + journal (generated, never hand-edited)
Skills:  drizzle-orm-patterns, postgresql-table-design
Do:      Add `project_context_docs`: `id` uuid pk, `workspace_id` → `workspaces` cascade,
         `repo_id` → `repos` cascade (AC-26), `title` text, `path_label` text, `body` text,
         `enabled` boolean not null default true, `order` integer not null (the quoting
         precedent is `agent_skills.order`, `schema/agents.ts:60`), `size_bytes` integer not
         null, `updated_at` timestamptz default now not null; index on `(repo_id, order)`.
         Add `agents.project_context` boolean not null default true, worded after the
         `repo_intel` comment two lines above it (`schema/agents.ts:28-31`). One
         `pnpm db:generate`, then `pnpm db:migrate` by hand. `code_chunks` is not touched.
Verify:  `cd server && pnpm db:generate` adds exactly one `.sql` · `grep -c "cascade" the new
         migration` ≥ 2 · `cd server && pnpm db:migrate` · `cd server && pnpm typecheck`
Covers:  AC-01, AC-26
Depends: none
Commit:  `feat(db): the project-context document table, and the agent switch that reads it`

### Step 2 — the contract, in both copies at once   ·   package: server + client
Files:   `server/src/vendor/shared/contracts/knowledge.ts` (edit) ·
         `client/src/vendor/shared/contracts/knowledge.ts` (mirror) ·
         `server/src/vendor/shared/contracts/platform.ts` (edit) ·
         `client/src/vendor/shared/contracts/platform.ts` (mirror)
Skills:  zod, onion-architecture
Do:      In `knowledge.ts`: `Agent.project_context: z.boolean().default(true)` and
         `AgentVersionConfig.project_context: z.boolean()`, each carrying the comment that says
         it is gated again by `PROJECT_CONTEXT_ENABLED`, mirroring `repo_intel` at `:375-377`
         and `:409`. In `platform.ts`, under the existing `// ---- Project Context ----` heading
         at `:254`: `ProjectContextDoc` (`id`, `title`, `path_label`, `body` nullish for the
         list projection, `enabled`, `order`, `size_bytes`, `updated_at`),
         `ProjectContextUpload` (`filename`, `content`, `title` optional),
         `ProjectContextPatch` (`enabled` optional, `title` optional) and
         `ProjectContextReorder` (`ids: z.array(z.string())`). Export them from the barrel if the
         file is new — it is not, so nothing changes in `index.ts`. `SpecFile` and `IndexStatus`
         stay exactly as they are. **Two packages in one step deliberately**: split across two,
         the tree is broken in between and the mirror gotcha is exactly what AC-18 tests.
Verify:  `diff server/src/vendor/shared/contracts/knowledge.ts client/src/vendor/shared/contracts/knowledge.ts`
         → empty · same diff for `contracts/platform.ts` → empty ·
         `grep -rn "repo_intel" server/src/vendor/shared/ client/src/vendor/shared/` re-read to
         confirm no other file re-declares `Agent`'s members inline ·
         `cd server && pnpm typecheck && cd ../client && pnpm typecheck`
Covers:  AC-18
Depends: Step 1
Commit:  `feat(shared): project-context documents, and the per-agent switch — both mirrors`

### Step 3 — the `context` module   ·   package: server
Files:   `server/src/modules/context/{constants,repository,service,routes}.ts` (new) ·
         `server/src/modules/index.ts` (one line) ·
         `server/src/platform/container.ts` (a `projectContext` getter + a `ContainerOverrides`
         slot) · `server/test/context-service.test.ts` (new, unit)
Skills:  onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns,
         postgresql-table-design, typescript-expert
Do:      Routes, repo-scoped like `conventions/routes.ts`, each opening with
         `getContext(app.container, req)`:
         `GET /repos/:id/context` (list, ordered by `order, id`, bodies omitted),
         `GET /context/:id` (one document with its body),
         `POST /repos/:id/context` (upload),
         `PATCH /context/:id` (enable/disable, retitle),
         `DELETE /context/:id`,
         `PUT /repos/:id/context/order` (the full id list).
         `constants.ts` holds `MAX_DOC_BYTES = 262_144`, `MAX_DOCS_PER_REPO = 50` and
         `ALLOWED_EXTENSIONS = ['.md', '.txt']`. The service throws `AppError` with an explicit
         status — 400 wrong extension naming the allowed ones (AC-05), 413 naming the limit
         (AC-06), 409 naming the ceiling (AC-07), 400 for a body that is empty or whitespace
         (AC-08) — and creates enabled with `order = max(order) + 1` (AC-04). `path_label` is
         stored and returned and never reaches `join`/`resolve`/`readFile` (AC-03); nothing in
         the module imports `node:fs` (AC-02). All SQL in `repository.ts`, scoped by
         `workspaceId` **and** `repoId` (AC-01). The unit test covers the four rejections and the
         `order` assignment against a stubbed repository.
Verify:  `cd server && pnpm exec vitest run test/context-service.test.ts` ·
         `cd server && pnpm arch:check` — **read the output, not the exit code** ·
         `grep -rn "writeFile\|mkdir\|createWriteStream\|rename\|rm(" server/src/modules/context/`
         → empty · `grep -rn "pathLabel" server/src/modules/context/` → no `join`/`resolve`/`readFile`
Covers:  AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10
Depends: Step 2
Commit:  `feat(context): the project-context module — upload, order, enable, delete`

### Step 4 — the two gates   ·   package: server
Files:   `server/src/platform/config.ts` (edit) ·
         `server/src/modules/agents/{helpers,repository,service,routes}.ts` (edit) ·
         `.env.example` (edit, if it lists `REPO_INTEL_ENABLED`)
Skills:  onion-architecture, typescript-expert, zod
Do:      `PROJECT_CONTEXT_ENABLED: z.string().optional()` in `EnvSchema` and
         `projectContextEnabled: parsed.PROJECT_CONTEXT_ENABLED !== 'false'` in `AppConfig`,
         both commented like `REPO_INTEL_ENABLED` at `:24-28` and `:76-79`, and stating why it is
         a second flag rather than a reuse (the spec's Open questions #3). Thread
         `project_context` through the agents module along every line `repo_intel` already
         travels: `helpers.ts:33` (row → contract), `:62`/`:79`/`:91` (the version-snapshot
         patch shape and the "did the config change" test), `repository.ts:27/41/98/137/162`,
         `service.ts:35/48/94/117`, `routes.ts:42/55/100`. No secret goes near `AppConfig`
         (root `CLAUDE.md` § Conventions).
Verify:  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` ·
         `grep -c "project_context" server/src/modules/agents/*.ts` matches the `repo_intel` count
         per file · `cd server && pnpm typecheck && pnpm arch:check`
Covers:  none — enabling work for AC-16 and AC-17
Depends: Step 2
Commit:  `feat(agents): the per-agent project-context switch and its global gate`

### Step 5 — the prompt slot   ·   package: server
Files:   `server/src/modules/reviews/constants.ts` (edit) ·
         `server/src/modules/reviews/helpers.ts` (edit) ·
         `server/src/modules/reviews/inputs.ts` (edit) ·
         `server/src/modules/reviews/run-executor.ts` (edit) ·
         `server/test/reviews-helpers.test.ts` (edit) ·
         `server/test/context-prompt.test.ts` (new, unit)
Skills:  onion-architecture, typescript-expert
Do:      `MAX_PROJECT_CONTEXT_CHARS = 24_000` in `constants.ts`, beside `MAX_SKILLS_CHARS`
         (`:26`) and carrying the spec's own sentence that the number has no independent
         justification yet. `renderProjectContextBlocks()` in `helpers.ts`, modelled on
         `renderSkillBlocks` (`:105-131`) and returning `{ blocks, included, dropped }` — every
         body through `wrapUntrusted()`, **no `source === 'manual'` branch of any kind** (AC-11),
         whole documents dropped from the tail of `order` (AC-13). `buildProjectContextBlocks()`
         in `inputs.ts`, modelled on `buildSkillBlocks` (`:58-91`): reads through
         `container.projectContext`, returns `undefined` when nothing survives so the spread at
         the call site adds no key (AC-15), logs the included names, logs `dropped` (AC-13), and
         degrades to `undefined` on any error. In `run-executor.ts`, beside the `repoIntelOn`
         block at `:180-194`: `const projectContextOn = agent.projectContext !== false &&
         container.config.projectContextEnabled`, with a run-log line naming which of the two
         gates was shut (AC-16, AC-17); `...(specBlocks ? { specs: specBlocks } : {})` in the
         `reviewPullRequest` call; and `specs_read: includedNames` at `:310`. `:508`
         (`traceFromBuffer`) keeps `[]` — see Requirements review. `prompt_assembly.specs` needs
         no work: `assemblePrompt` already writes it (`prompt.ts:200`), which is what gives
         AC-20 its immutable copy. Nothing in `reviewer-core` is edited.
Verify:  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` ·
         `grep -rn "code_chunks\|codeChunks" server/src/modules/reviews/` → empty ·
         `grep -rn "source === 'manual'" server/src/modules/context/ server/src/modules/reviews/helpers.ts`
         → only the pre-existing skills branch · `cd server && pnpm arch:check` (read the output)
Covers:  AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-19, AC-20
Depends: Step 3, Step 4
Commit:  `feat(reviews): fill the Project context slot, and say so in the trace`

### Step 6 — the client's data path   ·   package: client
Files:   `client/src/lib/hooks/context.ts` (new) · `client/src/lib/hooks/index.ts` (edit) ·
         `client/src/lib/hooks/core.ts` (edit — delete `useContextFiles` and
         `useReindexContext`) · `client/src/vendor/ui/nav.ts` (edit — one entry) ·
         `client/messages/en/context.json` (rewrite)
Skills:  react-best-practices, typescript-expert
Do:      One hook file over the six endpoints, keyed `["context", repoId]`, invalidating that key
         after every mutation (`client/CLAUDE.md` § Conventions), shaped like
         `hooks/conventions.ts`. Remove the two dead hooks from `core.ts` and their now-unused
         `SpecFile` / `IndexStatus` imports — the contracts themselves stay. Add
         `{ key: "context", label: "Project Context", icon: …, href: "/repos/:repoId/context" }`
         to the `SKILLS LAB` group in `nav.ts` **with no `gKey`** (AC-25; `c` is Conventions').
         Rewrite `context.json`: drop the `chunks` / `reindex` / `resync` / `indexStatus` /
         `mode` / `editor` keys — every one of them names something this spec puts out of scope —
         and correct the empty-state body, which today promises *"under .devdigest/specs/. Every
         agent … read them"*: after AC-03 there is no such folder and after AC-16 it is not every
         agent. This is the one `vendor/ui` edit in the plan and it is the one AC-25 asks for.
Verify:  `grep -n "context" client/src/vendor/ui/nav.ts` shows the entry and **no** `gKey` ·
         `grep -rn "useContextFiles\|useReindexContext" client/src` → empty ·
         `grep -rn "devdigest/specs" client/messages/` → empty ·
         `cd client && pnpm typecheck && pnpm test`
Covers:  AC-25
Depends: Step 2 (types), Step 3 (the routes the hook calls)
Commit:  `feat(web): the project-context hook, its nav entry, and honest copy`

### Step 7 — the Project Context page   ·   package: client
Files:   `client/src/app/repos/[repoId]/context/page.tsx` (new) ·
         `client/src/app/repos/[repoId]/context/_components/ProjectContextView/**` (new) ·
         further `_components/<Name>/` folders as the view splits ·
         `*.test.tsx` beside each
Skills:  **design-reference first, before any code**, then frontend-architecture,
         react-best-practices, next-best-practices, react-testing-library
Do:      Read the design first: screen key `project-context`, artboards `context` and
         `e-context` (`docs/design-manifest.json:214`, `SCREEN_CATALOG.md`,
         `src/features/intelligence/tour-and-project-context.jsx`), then `BRIDGE.md` §
         Navigation — which currently files `project-context` under "future lessons", so this
         step is what makes the route real. Thin `page.tsx` over one view, the way
         `conventions/page.tsx` is. Document list in `order` with the path **label** (never
         presented as somewhere to `cd`, AC-03) and a footer counting documents and total size —
         **not** the mockup's chunk counter, which has no source here. Read-only preview: no
         `textarea`, no `Edit` toggle (AC-23). Upload control, delete, an enable/disable toggle
         with a distinct visual for a disabled document, and reorder. Empty state from the
         artboard with the corrected copy (AC-22). The header counter reads *"read by N of M
         enabled agents"* from `useAgents`, worded as a property of the workspace's agents rather
         than of the document (AC-24). Add the states the mockup omits and `@devdigest/ui`
         already ships: `Skeleton` while loading, `ErrorState` on a failed list, a disabled
         control while an upload is in flight, and an inline place to render the AC-05 to AC-08
         rejection messages. Tests drive interaction with **`fireEvent`** — `user-event` is not
         installed (`client/INSIGHTS.md` 2026-08-22) — and import strings from
         `messages/en/context.json` like every neighbouring suite.
Verify:  `cd client && pnpm test && pnpm typecheck` ·
         `grep -rn "textarea" client/src/app/repos/\[repoId\]/context/` → empty
Covers:  AC-21, AC-22, AC-23, AC-24
Depends: Step 6
Commit:  `feat(web): the Project Context screen`

### Step 8 — the integration lane   ·   package: server
Files:   `server/test/project-context.it.test.ts` (new)
Skills:  onion-architecture
Do:      One integration file — a 14th Postgres container, and the load change
         `server/INSIGHTS.md` (2026-08-28) warns about. Cover: a row readable after upload,
         scoped by `workspace_id` + `repo_id` (AC-01); the four rejections, each asserting the
         status **and** `SELECT count(*)` unchanged (AC-05 to AC-08); create-enabled with
         `order` above the tail (AC-04); delete removes the document from the next prompt
         (AC-09); reorder persists and the section follows it (AC-10); a finished run writes
         `specs_read` and `prompt_assembly.specs` (AC-19), following `runAndReadAssembly` in
         `test/skills.it.test.ts:767` — and, per that same insight, **asserting the condition
         `waitForPrRuns` waited for** rather than dereferencing the trace blind; deleting a
         document afterwards leaves the stored trace unchanged (AC-20); deleting the repository
         removes its documents (AC-26). Use `src/adapters/mocks.ts`, never a hand-rolled mock.
Verify:  `cd server && pnpm exec vitest run .it.test` — the **whole** lane, not the new file
         alone. If an unrelated file goes red, remove this one and re-run before calling it a
         regression.
Covers:  AC-01, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-19, AC-20, AC-26
Depends: Step 5, Step 3
Commit:  `test(context): the persistence, rejection and trace criteria`

### Step 9 — the structural criteria, checked   ·   package: server + client
Files:   none (verification pass) · `specs/L05-project-context-folder.md` (`Status:` only)
Do:      Run every `How it is checked` entry that is a shell command, AC-01 to AC-26, top to
         bottom — the five structural ones (AC-02, AC-03, AC-14, AC-18, AC-25) are the point of
         this step, since nothing else in the plan fails when they drift. Then the full lanes for
         both packages. Any red is a fix in the step that owns it, never a note here. The one
         thing no test covers is the spec's own manual check: upload a document, run a review,
         open the Run Trace drawer, and confirm the name under `specs_read` and the wrapped text
         under `## Project context` — the drawer already renders both
         (`RunTraceDrawer/_components/TraceBody/TraceBody.tsx:39,95`).
Verify:  the AC table, top to bottom ·
         `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck && pnpm arch:check` ·
         `cd client && pnpm test && pnpm typecheck`
Covers:  AC-02, AC-03, AC-14, AC-18, AC-25 (re-checked); the structural half of every other id
Depends: Step 8
Commit:  `chore(specs): the project-context criteria, checked`

## Out of scope

Copied verbatim from `specs/L05-project-context-folder.md` § Out of scope.

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

## Coverage

| AC | Step | AC | Step |
|---|---|---|---|
| AC-01 | 1, 3, 8 | AC-14 | 5, 9 |
| AC-02 | 3, 9 | AC-15 | 5 |
| AC-03 | 3, 9 | AC-16 | 4, 5 |
| AC-04 | 3, 8 | AC-17 | 4, 5 |
| AC-05 | 3, 8 | AC-18 | 2, 9 |
| AC-06 | 3, 8 | AC-19 | 5, 8 |
| AC-07 | 3, 8 | AC-20 | 5, 8 |
| AC-08 | 3, 8 | AC-21 | 7 |
| AC-09 | 3, 8 | AC-22 | 7 |
| AC-10 | 3, 5, 8 | AC-23 | 7 |
| AC-11 | 5 | AC-24 | 7 |
| AC-12 | 5 | AC-25 | 6, 9 |
| AC-13 | 5 | AC-26 | 1, 8 |

All 26 ids in the spec appear. No step's `Covers:` names an id the spec does not carry. AC-09's
clone-untouched clause is covered structurally by AC-02's grep rather than by a test — see
Requirements review.

## Commit plan

**One commit per step, nine at the ceiling.** Every step above ends in a command that passes or
fails, and that command is the commit's gate: a step whose `Verify` is red does not get
committed.

| # | Step | Commit |
|---|---|---|
| 1 | schema + migration | `feat(db): the project-context document table, and the agent switch that reads it` |
| 2 | contracts, both mirrors | `feat(shared): project-context documents, and the per-agent switch — both mirrors` |
| 3 | the `context` module | `feat(context): the project-context module — upload, order, enable, delete` |
| 4 | the two gates | `feat(agents): the per-agent project-context switch and its global gate` |
| 5 | the prompt slot | `feat(reviews): fill the Project context slot, and say so in the trace` |
| 6 | client data path | `feat(web): the project-context hook, its nav entry, and honest copy` |
| 7 | the page | `feat(web): the Project Context screen` |
| 8 | integration lane | `test(context): the persistence, rejection and trace criteria` |
| 9 | structural check | `chore(specs): the project-context criteria, checked` |

Rules that make those boundaries defensible:

- **The mirror is never split.** Step 2 edits four files across two packages in one commit. Split,
  the tree is broken between them and AC-18 fails in the gap — which is the whole point of the
  gotcha it comes from.
- **The migration is its own commit**, so a bad `db:generate` is revertible without dragging the
  module with it. `pnpm db:migrate` is manual and is **not** part of any commit.
- **Step 6 is where dead code dies.** Deleting `useContextFiles` in the same commit that adds its
  replacement keeps the tree honest at every point in history; deleted a commit earlier, the
  client has no hook for a route that exists.
- **Never one giant commit**, and never a commit for a step that turned out to be a no-op. Nine
  is the ceiling, not a quota.
- **`/pr-self-review` runs before the pull request, not before each commit** (root `CLAUDE.md` §
  Session protocol). Expect it to raise the `vendor/ui/nav.ts` edit as a scripted CRITICAL, and
  expect `--override` not to clear it (root `INSIGHTS.md` 2026-08-06) — the answer is AC-25 in
  prose, or `DEVDIGEST_SKIP_PR_REVIEW=1` with a stated reason.
- **Commit only when asked.** This plan says where the boundaries are; it authorises no push and
  no pull request.

## Handoff

Plan file:      `specs/plans/L05-project-context-folder.md`
Entry point:    Step 1
Execution mode: **single-agent pass through `/implement`** — I agree with the caller, and the
                dependency graph says the same thing. 1 → 2 → {3, 4} → 5 → 8 → 9 is a chain:
                the schema must exist before the contract that describes it, the contract before
                the module, the module and the gates before the prompt, the prompt before the
                trace assertions. The only genuine fork is {3, 4, 5} against {6, 7} once Step 2
                lands — but Step 6 calls the routes Step 3 defines, so a parallel client branch
                would be writing a hook against an endpoint that does not exist yet, and both
                branches are small enough that two contexts would spend more on re-reading
                `run-executor.ts` and `conventions/` than they save.
Tests:          **run without `--tests`.** `implementer` writes them inside the steps that own
                them: the service unit test in Step 3, the prompt-composition unit tests in
                Step 5, the component tests in Step 7, the integration file as its own Step 8.
                Every one of them is inseparable from the code it guards — the budget and
                byte-identity tests (AC-13, AC-15) are assertions about `renderProjectContextBlocks`'s
                own return shape, and a dedicated `test-writer` pass would have to re-derive the
                module it is testing from scratch. Step 8 is the one place a `--tests` pass could
                have earned its context, and it is also the riskiest file in the plan (a 14th
                Postgres container); it is called out as its own step for exactly that reason, so
                it can be run and re-run in isolation without a second agent.
Verification:   per step above. Closing lanes:
                `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck && pnpm arch:check`
                (read `arch:check`'s **output**, not its exit code) ·
                `cd server && pnpm exec vitest run .it.test` ·
                `cd client && pnpm test && pnpm typecheck`. `reviewer-core` and `mcp` are not
                touched and their lanes are not part of this plan.
Closing step:   after Step 9 is green, set the spec's `Status:` to `done` and remove its pointer
                from any `CLAUDE.md` **Read when** list that carries one (`specs/README.md`
                rule 6). Then `/engineering-insights` — the scaffold finding (a dead hook, a
                stale message file and a `SpecFile` contract all waiting in the tree) belongs in
                `client/INSIGHTS.md`, and the 422-vs-413 collision between Zod route schemas and
                an explicit status code belongs in `server/INSIGHTS.md`. `/pr-self-review` last,
                before the pull request.
Deviation policy: stop at the step, report the divergence, finish the independent steps.
                  Do not re-plan, and do not amend the spec — a gap goes to `spec-creator`.

## Recommendations

Each is a **proposal**, not a step, and none is implemented unless it is picked up.

- **Take the spec's first UX proposal in Step 7 and leave the other three.** Showing each
  document's size and the repository's total against the 256 KB / 50 ceilings costs one line of
  copy and turns AC-05 to AC-07 from discovered into predictable. "Which documents fit the
  budget at current order" is the more interesting one but needs the budget arithmetic on the
  client, i.e. a second implementation of `renderProjectContextBlocks` that can drift from the
  server's — worth doing only when the server returns the answer.
- **Sort the list `order, id`, never `order` alone.** `defaultNow()` ties a batch insert to the
  microsecond (root `CLAUDE.md` § Gotchas) and two documents can share an `order` after a
  concurrent reorder; without a tie-break the "latest per group" answer is planner order. Cheap
  now, invisible later.
- **Consider deleting `SpecFile` when the retrieval lesson lands, not before.** It is exported
  from the shared barrel and named in `client/src/lib/types.ts`, and its only two consumers die
  in Step 6. Leaving an unused contract under a `// ---- Project Context ----` heading that this
  feature does not use is a small trap for the next reader; removing it is a four-file change in
  two mirrors that has nothing to do with this spec.
- **Write Step 7 last even if context runs short, and never first.** It is the only step whose
  requirements come from a source outside the repository (`reference/devdigest-design/`), and it
  is the step most likely to grow — the artboard shows an editor, a chunk counter and a coverage
  ring that the spec has already ruled out three times over.
- **Do not add `@fastify/multipart`.** The JSON-body decision above is not just the cheaper
  route: it is what lets the server see `filename` and reject an extension with a 400, which is
  AC-05. A multipart upload would move that check into a stream handler for no gain.
- **Run `/workflow-retro` after Step 9.** This is the pipeline's first end-to-end feature run,
  and the retro is the only place the cost of it gets written down.
