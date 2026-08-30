# Implementation plan — Export to CI

Spec: [`../export-to-ci.md`](../export-to-ci.md) · Spec ID `EXPORT-TO-CI` · Branch: `feat/export-to-ci`

> **Revised after `spec-creator` amended the spec.** The spec now carries **35** criteria
> (`AC-01`…`AC-35`) and answers all three items this plan sent back: AC-24 drops its per-severity
> clause, `GET /agents/:id/export-ci/preview` is confirmed in § In scope and gains **AC-34**, and
> the export ships the whole `agent-runner/dist/` directory, which gains **AC-35** and rewrites
> AC-03 and AC-16. The shape below is unchanged — ten steps, three tracks, the same wave table and
> the same step numbers. What moved is recorded in Requirements review and in the coverage table.

Ten steps, ten commits, three of them written by `test-writer`. The tree is clean at `5530da3`
(`git status --porcelain` empty), so nothing below works around uncommitted work.

**The overriding constraint, restated because every step is measured against it:** this pass is
*very simple*. The spec's § Out of scope is copied verbatim below and is load-bearing. No step
here builds anything it excludes, and no step does anything "while we are in the file".

## Requirements review

Every claim below was checked against the tree at `5530da3`, not remembered. `file:line` is
where it was checked, and every number in a `Verify:` line was executed today.

### Closed by the spec amendment — the three items this plan sent back

- **AC-24's per-severity clause is gone; the row shows the total.** The counters do arrive
  (`CiResultArtifact.critical/warning/suggestion`,
  `server/src/vendor/shared/contracts/eval-ci.ts:234-243`) and there is nowhere to keep them:
  `ci_runs` has `findings_count` and nothing per-severity (`server/src/db/schema/ci.ts:14-26`),
  `agent_runs` has `findings_count` and `blockers` (`server/src/db/schema/runs.ts:8-36`), and
  AC-31 fixes the migration at exactly two columns — so any breakdown cost a second migration.
  The second reason is the one worth remembering: a third severity tally would have had to pick a
  counting rule on purpose, and two already coexist deliberately in this repository (root
  `INSIGHTS.md` 2026-08-02). A thin first pass does not make that choice by accident.
  **Consequence for the plan:** Step 1 is unblocked and unchanged, the migration is the one
  already planned, and the CI Runs row renders the total with `—` for a null cost and for a
  `0`/null findings count — two facts the mockup collapses into one dash.
- **`GET /agents/:id/export-ci/preview` is confirmed and is now AC-34.** The module serves five
  routes, not four. It is read-only over the same pure generator: no GitHub call, no row, no
  persistence, no new contract (`CiFile` is already in both mirrors). It is also what makes the
  runner refusal (AC-16) surface at Preview rather than at Install, where the user can act on it.
  AC-34 adds the side-effect freedom AC-03 only implied, so it gets an integration case of its
  own in Step 7 rather than riding along on AC-03's.
- **The export ships all three files `ncc` emits, and that removes the ESM risk as a class.**
  Verified on disk: `agent-runner/dist/` is `index.js` (1 604 629 B), `300.index.js` (5 796 B) and
  `package.json` (**23 bytes**, exactly `{"type": "module"}`). `dist/index.js` opens with a
  top-level `import` and closes with `export { … as main }`, so Node must read it as ESM; `ncc`
  emits that `package.json` precisely to scope the module type to its own directory, so copying
  the directory makes `node .devdigest/runner/index.js` correct whatever the target repository
  declares. The chunk is reached only from `openai`'s `fileFromPath` shim
  (`dist/index.js:22576`) — shipping it costs 5 796 bytes and removes a lazily-imported cliff.
  **The reason this had to be fixed in the generator rather than by hand:**
  `devsiteua/devdigest-review-fixtures` already declares `"type": "module"` (verified with `gh`),
  so a single-file export would have worked along the entire demo path and failed for the first
  real user with a CommonJS repository. AC-03, AC-16 and the new AC-35 now carry it, and the
  `isDirectRun` guard survives bundling, so the command really does call `main()`.

### Gaps — named and decided

- **Nothing defines the value written into `ci_runs.status`.** AC-24 requires a status column and
  AC-20 does not say what it holds. **Taken:** `findings_count === 0 → 'no_findings'`, else
  `exit_code === 0 → 'succeeded'`, else `'failed'` — a rendering of what the runner *told* us,
  never a recomputation of the gate (Non-goal 4). The `agent_runs` row gets `status: 'done'`, the
  vocabulary the executor already writes (`server/src/modules/reviews/run-executor.ts:87,292`), and
  `blockers` stays null because the artifact carries no such number.
- **AC-27 needs `RUNNER_VERSION` on a client that cannot import `agent-runner`.** Verified:
  `RUNNER_VERSION = '1'` at `agent-runner/src/artifact.ts:6`, and no tsconfig path alias exposes
  that package to `server/` or `client/`. **Taken:** `server/src/modules/ci/constants.ts` declares
  its own `RUNNER_VERSION = '1'` and `GET /agents/:id/ci` returns it. The duplication is
  unavoidable — an import would either break the dependency rule or need a path alias into a
  package this stream must not touch — but it does not have to drift *silently*: Step 4 adds a
  unit test that reads `agent-runner/src/artifact.ts` **as text** with `node:fs` and asserts the
  same literal appears in both files.
  **Checked before writing that gate, as asked:** it trips no rule. `pnpm arch:check` cruises
  `src` only (`server/package.json:11`), so `server/test/**` is never in the graph; even inside
  `src`, `options.exclude.path: '\\.test\\.ts$'` drops every test file
  (`server/.dependency-cruiser-onion.cjs:112`); and a `readFileSync` of a path string is not a
  dependency edge at all — dependency-cruiser follows imports, which `tsPreCompilationDeps: true`
  extends to type-only imports, not to runtime file reads.
- **The export needs a YAML serializer and `server/` has none.** Verified: no `yaml` or `js-yaml`
  in `server/package.json`; `agent-runner` depends on `yaml@^2.6.1` and parses the manifest with it
  (`agent-runner/src/manifest.ts:3`). **Taken:** `pnpm add yaml` in `server/`, same major as the
  runner's, inside Step 3 and its commit. JSON-in-YAML would validate (JSON is YAML) and was
  rejected: the Preview pane and the reviewer of the generated PR both read this file.

### Ambiguities — the reading this plan takes

- **AC-01 says the button is «Add to CI»; AC-29's empty-state CTA says «Export to CI».** The design
  has neither (`reference/devdigest-design/src/features/agents/agents.jsx:117-125` shows only
  "Update CI config", which is out of scope). Read as two states of one surface: the CI tab's empty
  state carries «Export to CI» (AC-29, and the design's literal), the populated tab carries «Add to
  CI» (AC-01). One control, one handler, two labels.
- **AC-03's «вміст лише перших трьох».** With N skills the bundle has 3 + N files, so "the first
  three" is read as *the first three kinds* — the manifest, every skill file and the workflow get
  contents; the runner bundle gets a path and a byte count and nothing else. That is also the only
  reading compatible with the NFR "runner bundle bytes crossing the API: 0".

### Verified rather than assumed

- **The runner bundle's three files and their sizes** — see the closed item above; the sizes are
  what AC-03's Preview renders and what the 8 MB NFR is measured against
  (1 604 629 + 5 796 + 23 = 1 610 448 bytes, a fifth of the ceiling).
- **The module's file names are already chosen by the runner's own source.**
  `server/src/modules/ci/constants.ts` and `workflow.ts` are named at `agent-runner/src/index.ts:5-7`,
  and `manifest.ts` at `agent-runner/src/manifest.ts:10`. This plan uses those names.
- **Reading the bundle from disk in a service does not break the onion.**
  `no-concrete-adapter-in-app-layer` forbids a service importing `src/adapters/**`
  (`server/.dependency-cruiser-onion.cjs:47-53`); nothing forbids `node:fs`, and
  `server/src/modules/repo-intel/service.ts:29` already imports `readFile` from `node:fs/promises`
  with `arch:check` green.
- **The client mirror drift is exactly what the spec describes.** Today the filtered diffs are 9
  lines (`eval-ci.ts`) and 5 lines (`adapters.ts`) — the exact commands are in Step 2's `Verify`.
  The three names we leave alone (`sessionId`, `sync()`, `diffNameOnly()`) are visible in the same
  diff and belong to other streams.
- **No producer sweep is outstanding.** `grep -rn ": AgentManifest = {" server/src server/test client/src`
  → **0 lines** today, and `AgentManifest` appears nowhere outside `vendor/shared`. Step 2 adds new
  exports rather than fields on existing types, so no literal in either package gains a key (root
  `INSIGHTS.md` 2026-08-29).
- **AC-28's grep is checkable, with its arithmetic stated.** `grep -c "ci_fail_on"` against the file
  that *does* carry it — `server/src/modules/agents/routes.ts` — prints **3** today (the create
  body, the update body, the handler mapping). Against `server/src/modules/ci/routes.ts` after Step
  5 it must print **0**. `grep -c` on a missing file prints nothing and exits 2: no output is "the
  step did not run", not a pass (root `INSIGHTS.md` 2026-08-30).
- **Baselines every whole-package gate below is read against**, all executed today:
  server `pnpm typecheck` clean · server unit lane **28 files / 497 tests** green ·
  `pnpm arch:check` prints `✔ no dependency violations found (189 modules, 650 dependencies cruised)`
  and `‼ 16 known violations ignored` · client **42 files / 321 tests** green and `pnpm typecheck`
  clean · `cd agent-runner && pnpm test` **3 files / 23 tests** green · `git diff --name-only
  lesson-07...HEAD` lists **21 paths, all under `agent-runner/`**, and `grep -c "vendor/ui/nav.ts"`
  over it prints **0**. The next migration is `0016_*` (`server/src/db/migrations/` ends at `0015`).

### Ordering constraints the spec implies but does not state

- **The migration, the mirror and the generators depend on nothing and on each other not at all.**
  The server copy of `AgentManifest` already exists, so generation needs no contract work; the
  client mirror needs no column; the columns need no generator. That is what makes three parallel
  tracks possible and it is the whole argument for the execution mode in § Handoff.
- **Every test step names the step that produces the data it reads** (root `INSIGHTS.md`
  2026-08-30). Step 4 asserts only over pure generators (Step 3). Step 7 asserts over rows written
  by the routes of Steps 5 and 6 and columns added by Step 1, and its `Depends:` says so. Step 9
  asserts over components rendered from fixtures it writes itself, with the hook module mocked, so
  it needs no server step at all.
- **AC-34 and AC-35 are integration criteria, not unit ones.** Both are about what the service
  does with the real directory and what reaches `commitFiles` — the preview's *equality* with the
  export's files can only be asserted where both routes are served. They sit in Step 7, whose
  `Depends:` already names Steps 5 and 6.
- **AC-10 splits across two lanes.** "No generated file contains the key" is provable in the unit
  lane, where the generator is handed no secret at all (Step 4). "No field of the response contains
  it" needs the real endpoint served by a `MockSecretsProvider` holding a fake key, which is the
  integration lane (Step 7). Placing both in the unit lane would have made Step 4 depend on Step 5.

### Accepted consequences

- **A strict `CiResultArtifact` at ingest rejects a *newer* runner's artifact.** AC-22 requires
  unknown keys to be refused; a future counter added to the artifact therefore 422s until the studio
  is updated. Accepted for this pass, recorded so nobody later reads it as an accident.
- **The ingest route does not call `getContext`.** `server/CLAUDE.md` § Conventions says every route
  does, "no exceptions"; AC-23 says the workspace comes from the installation's agent and never from
  the request. AC-23 wins, the exception is drawn to that one route, and the reason is written in the
  route — the same shape as the documented 422 exception (`server/INSIGHTS.md` 2026-08-29).

## Constraints in force

| Constraint | Source | What it forbids here |
|---|---|---|
| SQL only in `repository.ts`, HTTP only in `routes.ts`, pure transforms in `helpers.ts`, literals in `constants.ts` | `server/CLAUDE.md` § Conventions | a Drizzle query in `modules/ci/service.ts`; the 8 MB ceiling or an action SHA inline in `workflow.ts` |
| A service takes dependencies from `container`, never from `src/adapters/**` | `server/CLAUDE.md`; `.dependency-cruiser-onion.cjs:47-53`; `onion-architecture` skill | importing `adapters/github/octokit.js` — GitHub arrives as `await container.github()` |
| No new adapter for GitHub | spec § Context ("never a new adapter"); ports at `server/src/vendor/shared/adapters.ts:129,134,161` | re-implementing `commitFiles` / `findOpenPr` / `openPullRequest`, all three already written (`server/src/adapters/github/octokit.ts:264,332,245`) |
| `no-cross-module-import` is `severity: 'warn'`, so `arch:check` **exits 0 on it** | `server/INSIGHTS.md` 2026-08-06; `.dependency-cruiser-onion.cjs:96-103` | trusting the exit code; importing `modules/reviews/helpers.ts` for the skill-wrap branch — re-implement it in `modules/ci/manifest.ts` |
| A new module is `modules/<name>/routes.ts` plus **one line** in `modules/index.ts`, appended at the end | `server/CLAUDE.md`; `server/src/modules/index.ts:32-46`; `WORKING-ORDER.md` § Спільні файли | inserting alphabetically into a file two other streams also append to |
| A second param name at the same path position breaks the router | `server/src/modules/agents/routes.ts` owns `/agents/:id/skills` | `/agents/:agentId/ci` — every new route under `/agents/` uses `:id` and `IdParams` |
| A route schema can only ever answer 422 | `server/INSIGHTS.md` 2026-08-29 | putting AC-18's 401 in the body schema — it lives in an `onRequest` hook, before validation |
| Secrets are read only through `SecretsProvider` | root `CLAUDE.md`; `server/src/adapters/secrets/local.ts` | `process.env.DEVDIGEST_CI_TOKEN` anywhere in `modules/ci/**` |
| A contract edit in `server/src/vendor/shared` requires the mirror edit, diffed before committing | root `CLAUDE.md` § Gotchas | splitting Step 2 across two commits |
| After editing an object in `vendor/shared`, grep the other contract files for its **member names** | root `CLAUDE.md` § Gotchas | assuming an import search found every inline re-declaration |
| Migrations are generated by drizzle-kit and applied by hand; **reading the emitted SQL is a gate that can fail** | root + `server/CLAUDE.md` § Do not touch; `server/INSIGHTS.md` 2026-08-30 | hand-editing `0016_*.sql`; assuming boot migrates; assuming a clean-looking file applies |
| A DB test carries `*.it.test.ts`, and adding one is a **load** change | root `CLAUDE.md`; `server/INSIGHTS.md` 2026-08-28 + its 2026-08-29 correction | reading an unrelated red as a regression before re-running the reduced lane five times |
| `pnpm typecheck` does not see `server/test/**` | `server/INSIGHTS.md` 2026-08-29 | treating a green server typecheck as proof the new fixtures compile |
| `client/src/vendor/ui/**` is do-not-touch; `nav.ts` is **owned by L07-A** | root + `client/CLAUDE.md`; `WORKING-ORDER.md`; AC-26 | any `nav.ts` edit before the rebase, and any edit beyond the single entry |
| No `fetch` in a component; a new endpoint means a hook in `src/lib/hooks/`, exported through `hooks/index.ts` | `client/CLAUDE.md` § Conventions | calling `/ci/runs` from the page |
| No hardcoded copy; and a message file can carry a factual lie | `client/CLAUDE.md` § Map; `client/INSIGHTS.md` 2026-08-29 | leaving `client/messages/en/ci.json`'s `publishDialog`, filter chips, auto-refresh, `blockMerge*` and `editable` keys in place for surfaces this pass does not build |
| `@testing-library/user-event` is not installed | `client/INSIGHTS.md` 2026-08-22 | `userEvent` in any new test — drive interaction with `fireEvent` |
| `noUncheckedIndexedAccess` is on and `pnpm test` cannot see it | `client/INSIGHTS.md` 2026-08-30 | calling a client step done on `pnpm test` alone |
| Only `<Name>.tsx` and `index.ts` are mandatory in a component folder | `client/docs/component-anatomy.md:20`; `client/INSIGHTS.md` 2026-08-05 | creating empty `constants.ts` / `helpers.ts` to satisfy the wider rule |
| `defaultNow()` is the transaction's timestamp | root `CLAUDE.md` § Gotchas | ordering CI runs by `ran_at` alone |
| `agent-runner/**` is finished and untouched | spec § Out of scope; `WORKING-ORDER.md` | any edit there — `cd agent-runner && pnpm test` (23) is the proof this stream kept out |
| `.github/workflows/**` of **this** repository is untouched | spec § Out of scope | confusing the generated workflow for the target repo with our own CI |
| The design reference is local-only and never committed or pointed at from a tracked file | user memory; `reference/devdigest-design/CLAUDE.md` | quoting an artboard path into a repo file |
| Every repo file is English | root `CLAUDE.md` § Conventions | Ukrainian anywhere outside the spec's EARS table |

## Implementation plan

### Gate discipline

Three rules, because a `Verify` that cannot go green stops a correct implementation and sends the
implementer hunting a bug in its own work:

1. **A step whose `Verify` runs a whole-package gate owns, in its `Files:`, everything that gate
   covers** — otherwise the gate is narrowed and the step says which file stays red and which step
   closes it. Every gate below was executed today and its baseline is written into the step.
2. **Read `arch:check`'s output, never its exit code.** The line to compare against is
   `✔ no dependency violations found` plus `‼ 16 known violations ignored`. A new warning prints and
   still exits 0 (`server/INSIGHTS.md` 2026-08-06).
3. **A test step's `Depends:` points at the step that writes the data it asserts against**, not at
   the step that shares its subject (root `INSIGHTS.md` 2026-08-30).

### Step 1 — the two `ci_runs` columns, in one migration   ·   package: server
Files:   `server/src/db/schema/ci.ts` (edit) ·
         `server/src/db/migrations/0016_*.sql` + `meta/_journal.json` + `meta/0016_snapshot.json`
         (generated by drizzle-kit, never hand-edited)
Skills:  drizzle-orm-patterns, postgresql-table-design
Do:      Add to `ciRuns` exactly two nullable columns: `agentRunId: uuid('agent_run_id')
         .references(() => agentRuns.id, { onDelete: 'set null' })` and
         `commitSha: text('commit_sha')`. `ci.ts` today imports only `./agents`; it gains an import
         of `agentRuns` from `./runs`, which introduces no cycle (`runs.ts` does not import `ci`).
         Nothing else changes — `server/src/db/schema.ts` already re-exports and registers
         `./schema/ci` (`:24,44,85-86`). One `pnpm db:generate`, then `pnpm db:migrate` by hand.
Verify:  `cd server && pnpm db:generate` adds exactly one `.sql`, numbered `0016` (the tree ends at
         `0015_massive_imperial_guard.sql`) · **read that file**: two `ALTER TABLE "ci_runs" ADD
         COLUMN` lines, one `ADD CONSTRAINT` for the FK, and no other table named anywhere in it —
         a generated migration can be inapplicable and reading it is the gate (`server/INSIGHTS.md`
         2026-08-30) · `cd server && pnpm db:migrate` (it does not run on boot) ·
         `cd server && pnpm typecheck`
Covers:  AC-31 (schema half)
Depends: none
Commit:  `feat(db): link a CI run to its agent run and the commit it reviewed`

### Step 2 — the CI half of the contract mirror, and the two contracts the routes need   ·   package: server + client
Files:   `client/src/vendor/shared/contracts/eval-ci.ts` (edit) ·
         `client/src/vendor/shared/adapters.ts` (edit) ·
         `server/src/vendor/shared/contracts/eval-ci.ts` (edit — the two new contracts only) ·
         (the same two new contracts in the client copy of `eval-ci.ts`)
Skills:  zod, onion-architecture
Do:      Repair the CI-owned drift, and nothing else. Into the client's `eval-ci.ts`: the whole
         `AgentManifest` + `AgentManifestInput` block, the `Provider, CiFailOn` members of the
         `knowledge.js` import line, and `'openrouter'` in `ConformanceInput.provider`. Into the
         client's `adapters.ts`: `CommitFile`, `CommitFilesPayload`, the `commitFiles` and
         `findOpenPr` members of `GitHubClient`, and `'openrouter'` in `LLMProvider.id`.
         **Do not copy** `StructuredRequest.sessionId`, `GitClient.sync()` or
         `GitClient.diffNameOnly()` — three other streams' lines that the same diff will show.
         Then add to **both** copies, under the existing `Export-to-CI + CI Runs` heading:
         `CiIngestInput` — `repo`, `pr_number` int, `commit_sha` matching `/^[0-9a-f]{40}$/`,
         `run_url` url, `exit_code` int, `result: CiResultArtifact.strict()`, the whole object
         `.strict()` (AC-22, AC-19); and `AgentCiView` — `installations: CiInstallation[]`,
         `runs: CiRun[]`, `runner_version: string`. Byte-identical in both files.
Verify:  `diff server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts | grep -E "AgentManifest|CiFailOn|CommitFile|CommitFilesPayload|openrouter" | wc -l`
         → **0** (it prints **9** today) ·
         `diff server/src/vendor/shared/adapters.ts client/src/vendor/shared/adapters.ts | grep -E "AgentManifest|CiFailOn|CommitFile|CommitFilesPayload|openrouter" | wc -l`
         → **0** (it prints **5** today) ·
         `grep -rn ": AgentManifest = {" server/src server/test client/src` → no output (0 today;
         both additions are new exports, so no existing literal gains a key) ·
         `cd server && pnpm typecheck` · `cd client && pnpm test && pnpm typecheck`
         (42 files / 321 tests green before this step, and still after)
Covers:  AC-30; AC-22's mechanism (its test is Step 7)
Depends: none
Commit:  `feat(shared): the CI contracts, mirrored — manifest, commit files, ingest`

### Step 3 — the bundle generators, pure string work   ·   package: server
Files:   `server/src/modules/ci/constants.ts` (new) · `server/src/modules/ci/helpers.ts` (new) ·
         `server/src/modules/ci/manifest.ts` (new) · `server/src/modules/ci/workflow.ts` (new) ·
         `server/package.json` + `server/pnpm-lock.yaml` (the `yaml` dependency)
Skills:  zod, typescript-expert, onion-architecture
Do:      `pnpm add yaml` in `server/` (same major as `agent-runner`'s `^2.6.1`).
         `constants.ts`: `RUNNER_VERSION = '1'`, `CI_BRANCH = 'devdigest/ci'`,
         `RUNNER_DIR = '.devdigest/runner'`, `RUNNER_ENTRY = RUNNER_DIR + '/index.js'` — the one
         string the workflow's run line and AC-07's assertion both read —
         `RUNNER_FILES = ['index.js', '300.index.js', 'package.json'] as const` — the three files
         `ncc` emits, named here once so the reader, the refusal (AC-16) and the commit (AC-35)
         cannot disagree — `WORKFLOW_PATH = '.github/workflows/devdigest-review.yml'`,
         `MAX_BUNDLE_BYTES = 8 * 1024 * 1024`, `CI_RUNS_LIMIT = 50`, and one pinned 40-character
         commit SHA per external action, each with the tag it corresponds to in a comment beside
         it. **Resolved 2026-08-30 via `gh api repos/<action>/git/ref/tags/<tag>`, so no lookup is
         needed at implementation time** — use these verbatim and do not re-resolve:
         `actions/checkout` v7.0.1 → `3d3c42e5aac5ba805825da76410c181273ba90b1`;
         `actions/setup-node` v7.0.0 → `820762786026740c76f36085b0efc47a31fe5020`;
         `actions/upload-artifact` v7.0.1 → `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`.
         Each dereferences to an object of type `commit`, which is what AC-08's regex asserts.
         `helpers.ts`: `skillSlug(name)` (kebab-case of `skills.name`; the table has no slug column
         — `server/src/db/schema/skills.ts:10`); `assertUniqueSlugs()` throwing an `AppError`
         whose message names **both** colliding skills (AC-33); and `bundleFiles()`, the pure
         assembly of the `CiFile[]` — manifest, one per skill, workflow, then one entry per
         `RUNNER_FILES` member at `.devdigest/runner/<name>` carrying its byte size and an empty
         `contents` (AC-03, AC-35). It takes the runner sizes as an argument, so the list stays a
         pure function and Step 5 owns the only disk read.
         `manifest.ts`: build the manifest object from an agent row plus ordered skill slugs,
         validate it with `AgentManifest.parse`, serialize with `yaml.stringify`; and produce one
         skill file per attached skill whose body is `source === 'manual' ? body :
         wrapUntrusted('skill:' + name, body)` — the same branch as
         `server/src/modules/reviews/helpers.ts:105-118`, **re-implemented rather than imported**
         (`no-cross-module-import`), because the runner reads bodies from disk with no provenance
         (`agent-runner/src/skills.ts`).
         `workflow.ts`: emit the GitHub Actions YAML — `on.pull_request.types` from the input and
         no other trigger, the string `pull_request_target` nowhere (AC-09); `permissions` with
         exactly `contents: read` and `pull-requests: write` (AC-06); a job-level
         `if: github.event.pull_request.head.repo.full_name == github.repository` (AC-11);
         `actions/checkout` and `actions/setup-node` (Node 22) pinned to their SHAs (AC-08); a run
         step `node .devdigest/runner/index.js` and no `uses: devdigest/review-action@v1` (AC-07)
         whose `env` carries `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`,
         `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `DEVDIGEST_POST_AS` from the input and
         `PR_NUMBER` from `github.event.pull_request.number` (AC-10, AC-12); an
         `actions/upload-artifact` step, SHA-pinned, `if: always()`, uploading
         `devdigest-result.json` (AC-32); and last, the ingest step — the secret is mapped into
         `env` at the step (`INGEST_URL: ${{ secrets.DEVDIGEST_INGEST_URL }}`) and the condition
         reads `if: always() && env.INGEST_URL != ''`, because the `secrets` context is not
         available in an `if:` — with `continue-on-error: true` so it can never redden the job
         (AC-13). No `github.event.*` string is interpolated into any `run:` line.
Verify:  `cd server && pnpm typecheck` ·
         `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — still the baseline
         **28 files / 497 tests** green (this step adds no test; Step 4 owns them) ·
         `cd server && pnpm arch:check` — output still `✔ no dependency violations found` and
         `‼ 16 known violations ignored`
Covers:  none by itself — enabling work whose criteria are proven by Step 4
Depends: none
Commit:  `feat(ci): the manifest, skill and workflow generators`

### Step 4 — the generator criteria, in the unit lane   ·   package: server   ·   **agent: `test-writer`**
Files:   `server/test/ci-workflow.test.ts` (new) · `server/test/ci-manifest.test.ts` (new) ·
         `server/test/ci-runner-version.test.ts` (new)
Skills:  onion-architecture (the `server/test/**` lane), zod
Do:      Two files over the pure generators of Step 3, no DB and no container.
         `ci-workflow.test.ts`, asserting over `YAML.parse` of the output and over its raw text:
         `permissions` has exactly two entries, `contents: read` and `pull-requests: write`
         (AC-06); the run line is exactly `node .devdigest/runner/index.js` and
         `uses: devdigest/review-action@v1` appears nowhere (AC-07); **every** `uses:` value matches
         `/@[0-9a-f]{40}$/` — a regex over all of them, not a spot check (AC-08); `on` has the single
         key `pull_request` and the string `pull_request_target` appears nowhere (AC-09); the job's
         `if:` compares `head.repo.full_name` with `github.repository` (AC-11); a changed trigger
         list reaches `on.pull_request.types` and a changed publish mode reaches
         `DEVDIGEST_POST_AS` (AC-12); the ingest step's `if:` depends on the mapped `env` variable
         and it carries `continue-on-error: true` (AC-13); the upload step exists, its `if:` is
         `always()` and does not name the review job's outcome, and its `uses:` is SHA-pinned
         (AC-32); the literal `sk-` never appears anywhere in the output, which is trivially true
         because the generator is handed no secret at all (AC-10, files half).
         `ci-manifest.test.ts`: `AgentManifest.parse(YAML.parse(file))` succeeds for an agent with
         skills and for one with none (AC-04); one case per skill `source` — a `manual` body is
         byte-identical to the row's, an `imported_url` body is wrapped as `skill:<name>` and the
         delimiter appears exactly once, so a later well-meaning second wrap fails loudly (AC-05,
         and root `INSIGHTS.md` 2026-08-29); the file list is manifest + one per skill + workflow +
         **three** runner entries — `.devdigest/runner/index.js`, `.devdigest/runner/300.index.js`
         and `.devdigest/runner/package.json`, each with a byte size and an empty `contents`, in
         that order (AC-03, bundle half; AC-35's shape, its real bytes are Step 7's); two skills
         named `Secret leakage gate` and `secret-leakage-gate` throw a message naming both
         (AC-33, slug half).
         `ci-runner-version.test.ts`: read `agent-runner/src/artifact.ts` as **text** with
         `node:fs` and assert the literal it declares for `RUNNER_VERSION` equals
         `modules/ci/constants.ts`'s. A file read, not an import — it crosses no boundary
         `arch:check` polices, for the two reasons recorded in Requirements review. This is the
         only guard against the one duplication this feature could not avoid.
Verify:  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — the whole unit lane, green,
         now above the 28-file / 497-test baseline by these two files
Covers:  AC-03 (bundle half), AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10 (files half), AC-11,
         AC-12 (generator half), AC-13, AC-27 (the `RUNNER_VERSION` literal), AC-32,
         AC-33 (slug half)
Depends: Step 3
Commit:  `test(ci): the workflow, manifest and slug criteria`

### Step 5 — the module, the export and the preview   ·   package: server
Files:   `server/src/modules/ci/repository.ts` (new) · `server/src/modules/ci/service.ts` (new) ·
         `server/src/modules/ci/routes.ts` (new) ·
         `server/src/modules/index.ts` (one import + one entry, appended last) ·
         `server/src/platform/config.ts` (edit — `DEVDIGEST_RUNNER_DIR` → `runnerBundleDir`)
Skills:  onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns
Do:      `config.ts`: one optional env var and one `AppConfig` field, resolved to an absolute path
         exactly as `cloneDir` is (`config.ts:85`), defaulting to
         `resolve(process.cwd(), '../agent-runner/dist')` — a **directory**, because the export
         ships all three files `ncc` emits. It exists so AC-16's four cases are testable without
         deleting a real file, and it is the only config this feature adds.
         `repository.ts` — the only file in the module importing `src/db`: find an installation by
         `(workspaceId, agentId, repo)`, insert one, and read the agent plus its ordered skills.
         SQL only, every query scoped by `workspaceId`.
         `service.ts` — `buildBundle(workspaceId, agentId, input)`: load the agent (404 as
         `GET /agents/:id` already does) and its skills → `assertUniqueSlugs` (AC-33) → read every
         member of `RUNNER_FILES` from `config.runnerBundleDir` with `readFile` from
         `node:fs/promises`, refusing with an `AppError` naming `pnpm build` in `agent-runner/`
         when the directory is absent **or any one of the three files is missing** — the message
         names the missing file (AC-16) — and when their total exceeds `MAX_BUNDLE_BYTES`
         (1 610 448 bytes today) → hand the sizes to `bundleFiles()` and return the list, the three
         runner entries carrying a path and a byte count with empty contents (NFR: 0 bundle bytes
         cross the API).
         `exportToCi(...)`: `buildBundle` first, so a missing bundle costs no GitHub call, then
         `const gh = await container.github()` → `commitFiles(...)` on `CI_BRANCH` from
         `input.base`, whose `files` are the generated three kinds plus the three runner files
         with their **real contents and their names preserved** under `.devdigest/runner/`
         (AC-35) → `findOpenPr(repo, CI_BRANCH)` → `openPullRequest` **only when none is open**
         (AC-15) → insert the `ci_installations` row **after** GitHub has succeeded, reusing the
         existing row for the same agent + repo (AC-15, AC-17). The base branch is never committed
         to (AC-14).
         `routes.ts` — `POST /agents/:id/export-ci` (`params: IdParams`, `:id` to match
         `modules/agents/routes.ts`, or the router rejects the tree) with a body schema that
         narrows `CiExportInput.action` to `'open_pr'`, so `'files'` is a 422 before the handler
         (§ Out of scope), and `GET /agents/:id/export-ci/preview` returning `CiFile[]` from
         `buildBundle` — that path never calls `container.github()` and never writes a row
         (AC-34). Both start with `getContext(container, req)`.
Verify:  `cd server && pnpm typecheck` ·
         `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (Step 4's three files
         still green) · `cd server && pnpm arch:check` — read the output: `✔ no dependency violations
         found` and `‼ 16 known violations ignored`, i.e. no new line and no growth in the known
         count; the module count rises above 189 and that is expected ·
         `grep -c "ci_fail_on" server/src/modules/ci/routes.ts` → **0** (the same grep prints **3**
         against `server/src/modules/agents/routes.ts`, which is the contrast it is read against; no
         output at all means the file is missing, not a pass)
Covers:  AC-14, AC-15, AC-16, AC-17, AC-28 (grep half), AC-33 (refusal half), AC-34, AC-35
Depends: Step 3
Commit:  `feat(ci): export an agent into a target repository's pull request`

### Step 6 — ingest, CI Runs and the agent CI view   ·   package: server
Files:   `server/src/modules/ci/routes.ts` (edit) · `server/src/modules/ci/service.ts` (edit) ·
         `server/src/modules/ci/repository.ts` (edit) · `server/src/modules/ci/constants.ts` (edit)
Skills:  onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns, typescript-expert
Do:      `POST /ci/ingest`. An `onRequest` hook on that route does the bearer check **before**
         validation, so a bad token is 401 and never 422: read `DEVDIGEST_CI_TOKEN` through
         `container.secrets.get`, treat unset **or shorter than 32 characters** as unset (fail
         closed), compare with `crypto.timingSafeEqual` after a length check, and throw
         `new AppError('unauthorized', …, 401)` (AC-18, and the NFR on token length). Route options
         carry `bodyLimit: 65_536` (NFR; the app-wide limit is 1 MB, `server/src/app.ts:49`). The
         body schema is `CiIngestInput` from Step 2, strict (AC-22). No per-route rate limit — the
         plugin is not registered under `NODE_ENV=test` at all (`server/INSIGHTS.md` 2026-08-30) and
         the spec's Open question 5 already settled it.
         The service resolves the installation by `repo` — none, and it is a 4xx with no row
         written (AC-19) — and takes `workspace_id` and `agent_id` from that installation's agent,
         never from the body (AC-23). This route deliberately does not call `getContext`; the
         reason goes in a comment above it. When no `ci_runs` row already carries the same
         installation, `pr_number` and `commit_sha` (AC-21), it writes in one transaction: one
         `agent_runs` row (`source: 'ci'`, `status: 'done'`, `ranAt` now, `durationMs`, `costUsd`,
         `findingsCount` from the artifact, `prId: null`, `blockers: null` — the studio never
         recomputes the gate, Non-goal 4) and one `ci_runs` row (`agentRunId`, `commitSha`,
         `prNumber`, `githubUrl` from `run_url`, `source: 'gha'`, and `status` mapped as
         Requirements review records) (AC-20).
         `GET /ci/runs` — `CI_RUNS_LIMIT` rows, `orderBy(desc(ranAt), desc(id))` because
         `defaultNow()` ties a batch to the microsecond and a uuid tie-break is at least
         deterministic; workspace-scoped through `ci_installations → agents`, joined to
         `agent_runs` for `duration_s` and to `agents` for `agent`.
         `GET /agents/:id/ci` — `AgentCiView`: that agent's installations, its recent CI runs and
         `RUNNER_VERSION`. It returns **no** `ci_fail_on`: the CI tab reads that from the agent it
         already holds, which is what keeps AC-28's grep at 0 and its endpoint count at one.
Verify:  `cd server && pnpm typecheck` ·
         `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (unchanged, still green) ·
         `cd server && pnpm arch:check` — output unchanged: `✔ no dependency violations found`,
         `‼ 16 known violations ignored` ·
         `grep -c "ci_fail_on" server/src/modules/ci/routes.ts` → **0**, re-run after this edit ·
         `grep -c "getContext" server/src/modules/ci/routes.ts` → **5**, and the arithmetic is one
         import line plus four call sites (export, preview, `GET /ci/runs`, `GET /agents/:id/ci`);
         the ingest handler is the one route that must not appear, so read the matches, not only
         the count
Covers:  AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24 (data half), AC-27 (data half),
         AC-28 (grep half)
Depends: Step 1 (the two columns), Step 2 (`CiIngestInput`, `AgentCiView`), Step 5 (same files)
Commit:  `feat(ci): ingest a CI result, and the two reads that show it`

### Step 7 — the integration lane   ·   package: server   ·   **agent: `test-writer`**
Files:   `server/test/ci.it.test.ts` (new)
Skills:  onion-architecture
Do:      One integration file — the 16th in the lane, and therefore a **load** change. Build the app
         the way `server/test/brief.it.test.ts:185` does: `buildApp({ config: { ...loadConfig(…),
         nodeEnv: 'test', runnerBundleDir: <a directory this test controls> }, db: pg.handle.db,
         overrides: { github: new MockGitHubClient(), secrets: new MockSecretsProvider({
         GITHUB_TOKEN: 'x', DEVDIGEST_CI_TOKEN: <40 characters>, OPENROUTER_API_KEY:
         'sk-or-v1-FAKE…' }) } })`, with `seed()` for an agent. Never a real network — the mock
         already implements `commitFiles`, `findOpenPr` and `openPullRequest`
         (`server/src/adapters/mocks.ts:218-231`).
         The fixture directory holds the three real names — write `index.js`, `300.index.js` and
         `package.json` into a tmp dir in `beforeAll`, so a case can delete exactly one of them.
         Cases: install commits to `devdigest/ci` and opens exactly one PR, and the base branch is
         never a commit target (AC-14); a second install for the same agent + repo leaves one
         `ci_installations` row, consults `findOpenPr` and calls `openPullRequest` once in total
         (AC-15); **four** refusal cases — the directory absent, and each of the three files
         missing in turn — each naming `pnpm build` and the missing file, and each leaving zero
         installations, zero commits and zero PRs (AC-16); the committed payload carries all three
         runner files at `.devdigest/runner/<name>` with their names preserved and a `package.json`
         whose contents are exactly `{"type": "module"}` — read off the `CommitFilesPayload` the
         `MockGitHubClient` recorded (`server/src/adapters/mocks.ts:223`) (AC-35); the preview
         route returns a list **equal** to the export's `files` for the same input while the mock
         records zero calls and `ci_installations` stays empty — assert the call count on the mock,
         not the absence of an error (AC-34); a
         `MockGitHubClient` whose `commitFiles` rejects leaves no installation row and answers with
         the reason (AC-17); the successful export's response body contains the fake
         `OPENROUTER_API_KEY` in no field, including `files[].contents` (AC-10, response half);
         ingest with no header, with a wrong token, and with the secret absent from the provider →
         401 and no rows, three separate cases (AC-18); a body failing the contract, a 39-character
         `commit_sha`, and a `repo` matching no installation → 4xx and no rows (AC-19); a valid post
         writes an `agent_runs` row with `source='ci'`, duration, cost and findings count and a
         linked `ci_runs` row carrying `pr_number`, `commit_sha`, `agent_run_id` and the job URL
         (AC-20, and the read/write half of AC-31); the identical post twice → one `agent_runs`, one
         `ci_runs` (AC-21); a body with one extra key → rejected, no rows (AC-22); the run's
         `workspace_id` is the installation's agent's, asserted with a second workspace present so
         the case can actually fail (AC-23); two skills colliding on a slug → refusal, no rows
         (AC-33, refusal half).
Verify:  `cd server && pnpm exec vitest run .it.test` — the **whole** lane, not the new file alone.
         A red in an unrelated file is a load symptom before it is a regression: re-run the lane
         with this file excluded **at least five times** before concluding anything
         (`server/INSIGHTS.md` 2026-08-28 and its 2026-08-29 correction — the race sits near 20% at
         13 files, so one clean run proves nothing)
Covers:  AC-10 (response half), AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22,
         AC-23, AC-31 (read/write half), AC-33 (refusal half), AC-34, AC-35
Depends: Step 5, Step 6, Step 1
Commit:  `test(ci): install, refusal and ingest against real Postgres`

### Step 8 — the three client surfaces   ·   package: client
Files:   `client/src/lib/hooks/ci.ts` (new) · `client/src/lib/hooks/index.ts` (edit, one line) ·
         `client/src/app/ci-runs/page.tsx` (new) ·
         `client/src/app/ci-runs/_components/CiRunsView/**` (new) ·
         `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (edit — a third tab) ·
         `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` (edit) ·
         `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/**` (new) ·
         `client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/**` (new) ·
         `client/messages/en/ci.json` (edit — prune and complete)
Skills:  **design-reference first, before any code**, then frontend-architecture,
         react-best-practices, next-best-practices, typescript-expert
Do:      Read the design before writing anything: screen keys `export-to-ci` (artboard `export`),
         `ci-runs` (artboards `ci-runs`, `e-ci`) and `agents` (artboard `agent-ci`), then map onto
         `@devdigest/ui`. Take the look as given; decide every interaction the mock never had to
         answer for (`client/INSIGHTS.md` 2026-08-30) — in particular the wizard's loading,
         already-installed, GitHub-failed and bundle-missing states, none of which the mockup has.
         `hooks/ci.ts`: `useCiRuns()`, `useAgentCi(agentId)`, `useCiPreview(agentId, repo)` and
         `useExportToCi()`, keyed `["ci-runs"]` / `["agent-ci", id]` / `["ci-preview", id, repo]`,
         the mutation invalidating the first two. No `fetch` in any component.
         `/ci-runs`: `AppShell` (the crumb key already exists) and a flat table of the most recent
         runs with repository, `#N` linked to GitHub, agent, status, findings total, cost, duration
         and the total findings count and the Actions job link (AC-24 as amended; per-severity
         chips are an § Out of scope bullet, not an omission);
         `—` for a null cost and a `0`/null findings count, which are two different facts; the
         `e-ci` empty state "No CI runs yet" with the CTA to export an agent (AC-25). **No** filter
         chips, **no** auto-refresh, **no** Trace link, **no** pagination and **no** PR-title
         column — every one of them is in § Out of scope.
         CI tab: a third entry in `TABS` (`{ key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" }`
         — `messages/en/agents.json` already carries `tabs.ci`) rendering installations (repository,
         target, installed at), `Runner v{runner_version}`, this agent's recent CI runs, and a
         `Fail CI on` control that saves through the existing `useUpdateAgent`
         (`client/src/lib/hooks/agents.ts:60-70`, whose patch already permits `ci_fail_on`) —
         no new endpoint (AC-27, AC-28); the "Not exported to CI" empty state with its
         «Export to CI» CTA, distinct from the loading state (AC-29); no uninstall, no
         "Update CI config", no workflow re-push.
         Export Wizard: a `Modal` + `ExportWizardSteps` with the four labels, opened from «Add to
         CI» / the empty state's CTA (AC-01); a Target step rendering **exactly one** card,
         GitHub Actions (AC-02); a read-only Preview fed by `useCiPreview`, listing every file and
         showing contents for the manifest, each skill and the workflow, and only a path and a byte
         size for each of the **three** runner files (AC-03); a Configure step with the `pull_request` event checkboxes and
         the publish mode, whose state is what the Install request carries (AC-12); an Install step
         that calls the export mutation once and shows the returned PR link, the GitHub failure
         with the sentence naming `gh auth refresh -h github.com -s workflow`, and the
         bundle-missing message naming `pnpm build` in `agent-runner/`.
         `messages/en/ci.json` — this file already exists and promises surfaces this pass does not
         build, which is exactly the trap `client/INSIGHTS.md` 2026-08-29 records. **Delete**
         `publishDialog` wholesale, `runs.filters`, `runs.autoRefresh`, `exportWizard.editable`,
         `exportWizard.blockMergeTitle`, `exportWizard.blockMergeDesc`, the `circle` / `jenkins` /
         `cli` target labels and descriptions, and `ciTab.publish` / `ciTab.update` /
         `ciTab.noRepo`. **Add** only the keys this pass renders, including the two failure
         sentences above. No hardcoded copy in a component.
Verify:  `cd client && pnpm test && pnpm typecheck` — **both**, because vitest cannot see
         `noUncheckedIndexedAccess` (`client/INSIGHTS.md` 2026-08-30); the baseline is 42 files /
         321 tests green and a clean typecheck ·
         `grep -rn "publishDialog\|autoRefresh\|blockMerge\|\"editable\"" client/src client/messages`
         → no output ·
         `git diff --name-only -- client/src/vendor/ui` → empty (AC-26 holds until Step 10)
Covers:  AC-01, AC-02, AC-03 (screen half), AC-12 (form half), AC-24 (screen half), AC-25, AC-27,
         AC-28, AC-29 — all of them proven by Step 9
Depends: Step 2
Commit:  `feat(web): the Export Wizard, the agent CI tab and the CI Runs page`

### Step 9 — the client criteria, in component tests   ·   package: client   ·   **agent: `test-writer`**
Files:   `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.test.tsx` (new) ·
         `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.test.tsx` (new) ·
         `client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/ExportWizard.test.tsx` (new)
Skills:  react-testing-library, react-best-practices
Do:      Render inside `NextIntlClientProvider` with the real `messages/en/ci.json`, mocking the
         hook module — the shape the existing suites use. Drive interaction with `fireEvent`;
         `@testing-library/user-event` is **not installed** (`client/INSIGHTS.md` 2026-08-22). Read
         a mock call through a named helper that throws when the mock was never called, never
         through `!` or a bare double index (`client/INSIGHTS.md` 2026-08-30).
         Cases: the wizard renders the four step labels through `ExportWizardSteps` (AC-01) and
         **exactly one** target card — assert the count, so a re-added CircleCI card fails the test
         (AC-02); Preview lists manifest + one row per skill + workflow + the three runner files,
         shows contents for the first three kinds and a path with a byte size for each runner file
         — assert the runner rows by count, so dropping back to a single-file export fails the test
         (AC-03); changing a
         trigger checkbox and the publish select changes the object handed to the export mutation
         (AC-12); a fixture run renders repository, `#N`, agent, status, findings, cost, duration
         and a link whose `href` is the job URL (AC-24); zero runs renders "No CI runs yet" with the
         export CTA (AC-25); the CI tab renders an installation row, `Runner v1`, recent runs and
         the `Fail CI on` control (AC-27), and changing that control calls the update-agent mutation
         with `{ ci_fail_on }` and issues no other request (AC-28) — asserted on the mutation's
         arguments, because a rule that lives in a callback the tab hands down is invisible to a
         grep (`client/INSIGHTS.md` 2026-08-30); zero installations renders "Not exported to CI"
         with «Export to CI» (AC-29).
Verify:  `cd client && pnpm test && pnpm typecheck` — both, above the 42-file / 321-test baseline
Covers:  AC-01, AC-02, AC-03 (screen half), AC-12 (form half), AC-24 (screen half), AC-25, AC-27,
         AC-28, AC-29
Depends: Step 8
Commit:  `test(web): the wizard, the CI tab and the CI Runs criteria`

### Step 10 — the nav entry, after L07-A has merged   ·   package: client
Files:   `client/src/vendor/ui/nav.ts` (edit — one entry)
Skills:  frontend-architecture
Do:      **Do not begin this step until `feat/multi-agent-review` is merged into `lesson-07` and
         this branch is rebased onto it** (`git fetch && git rebase lesson-07`). L07-A owns this
         file (`WORKING-ORDER.md` § Спільні файли; AC-26), and the rebase comes first so the entry
         is added to the merged version rather than to a copy that will conflict. Then add one item
         — `{ key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs" }` — to the group
         L07-A's merged file uses for global items, with **no `gKey`**: reshuffling a shipped
         shortcut is a worse change than one entry without one, which is the call `context` already
         made (`nav.ts:46-49`). Nothing else changes; `activeKeyFor` already maps `/ci-runs`
         (`client/src/components/app-shell/helpers.ts:38`).
Verify:  **Before the rebase**, and at every point until it happens:
         `git diff --name-only lesson-07...HEAD | grep -c "vendor/ui/nav.ts"` → **0**, reading the
         OUTPUT and never the exit code — `grep -c` exits 1 on zero matches (root `INSIGHTS.md`
         2026-08-22). That diff lists 21 paths today, all under `agent-runner/`, and the count is 0.
         **After the rebase and this edit**: the same command prints **1** ·
         `cd client && pnpm test && pnpm typecheck`
Covers:  AC-26
Depends: Step 8, **and the external merge of `feat/multi-agent-review` into `lesson-07`**
Commit:  `feat(web): the CI Runs nav entry`

## Out of scope

Copied verbatim from `specs/export-to-ci.md` § Out of scope. It is the section that keeps this pass
small; restating it in other words is how it loosens.

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

## Coverage

Built from the spec's 35 ids, in order — not from the steps.

| AC | Step | AC | Step |
|---|---|---|---|
| AC-01 | 8, 9 | AC-19 | 2, 6, 7 |
| AC-02 | 8, 9 | AC-20 | 6, 7 |
| AC-03 | 3, 4, 5, 8, 9 | AC-21 | 6, 7 |
| AC-04 | 3, 4 | AC-22 | 2, 6, 7 |
| AC-05 | 3, 4 | AC-23 | 6, 7 |
| AC-06 | 3, 4 | AC-24 | 6, 8, 9 |
| AC-07 | 3, 4 | AC-25 | 8, 9 |
| AC-08 | 3, 4 | AC-26 | 10 |
| AC-09 | 3, 4 | AC-27 | 4, 6, 8, 9 |
| AC-10 | 3, 4, 5, 7 | AC-28 | 5, 6, 8, 9 |
| AC-11 | 3, 4 | AC-29 | 8, 9 |
| AC-12 | 3, 4, 8, 9 | AC-30 | 2 |
| AC-13 | 3, 4 | AC-31 | 1, 7 |
| AC-14 | 5, 7 | AC-32 | 3, 4 |
| AC-15 | 5, 7 | AC-33 | 3, 4, 5, 7 |
| AC-16 | 5, 7 | AC-34 | 5, 7 |
| AC-17 | 5, 7 | AC-35 | 3, 4, 5, 7 |
| AC-18 | 6, 7 | | |

All **35** ids appear, and every one of them has at least one step that can fail. No step's
`Covers:` names an id the spec does not carry — Step 3 covers nothing by itself and says so,
because its criteria are only observable through Step 4's assertions.

**Nothing is knowingly uncovered.** The one clause this plan previously carried as uncovered —
AC-24's per-severity breakdown — is no longer in the spec; it is an § Out of scope bullet, copied
verbatim above.

**Where the two new criteria landed, and why there:** AC-34 (the preview writes nothing and calls
nothing) is Step 5's route and Step 7's assertion, because equality with the export's `files`
needs both routes served. AC-35 (all three runner files, names preserved) is the shape in Steps 3
and 4 and the real bytes in Steps 5 and 7 — a unit test can prove the list, only the integration
lane can prove what reached `commitFiles`.

## Commit plan

**One commit per step, ten at the ceiling.** Every step ends in a command that passes or fails, and
that command is the commit's gate: a step whose `Verify` is red is not committed.

| # | Step | Commit |
|---|---|---|
| 1 | the two `ci_runs` columns | `feat(db): link a CI run to its agent run and the commit it reviewed` |
| 2 | the contract mirror | `feat(shared): the CI contracts, mirrored — manifest, commit files, ingest` |
| 3 | the generators | `feat(ci): the manifest, skill and workflow generators` |
| 4 | generator tests | `test(ci): the workflow, manifest and slug criteria` |
| 5 | export + preview | `feat(ci): export an agent into a target repository's pull request` |
| 6 | ingest + reads | `feat(ci): ingest a CI result, and the two reads that show it` |
| 7 | integration lane | `test(ci): install, refusal and ingest against real Postgres` |
| 8 | the client surfaces | `feat(web): the Export Wizard, the agent CI tab and the CI Runs page` |
| 9 | client tests | `test(web): the wizard, the CI tab and the CI Runs criteria` |
| 10 | the nav entry | `feat(web): the CI Runs nav entry` |

Rules that make those boundaries defensible:

- **The mirror is never split.** Step 2 edits four contract files across two packages in one commit.
  Split, the tree is broken in between and AC-30 fails in the gap — which is the whole point of the
  gotcha it comes from. The producer sweep is 0 today, so nothing else joins that commit.
- **The migration is its own commit**, so a bad `db:generate` is revertible without dragging the
  module with it. `pnpm db:migrate` is manual and belongs to no commit.
- **Tests are their own commits**, because the implementer does not write them: Steps 4, 7 and 9
  are `test-writer`'s, and folding them into the implementation steps would hide which agent
  produced the assertion that a criterion rests on.
- **Step 5 and Step 6 edit the same three files and are therefore sequential**, never two agents at
  once. Step 6 appends; it does not rewrite Step 5's handlers.
- **Step 10 is committed only after the rebase.** Committing it earlier makes AC-26 false and puts a
  conflict in L07-A's file.
- **Never one giant commit**, and never a commit for a step that turned out to be a no-op. Ten is a
  ceiling, not a quota.
- **`/pr-self-review` runs before the pull request, not before each commit** (root `CLAUDE.md`
  § Session protocol). Expect `check:contract-mirror` to raise Step 2 as a scripted CRITICAL: it
  compares changed *lines*, so repairing pre-existing drift on one side trips it even when the two
  files end up identical (root `INSIGHTS.md` 2026-08-06). Answer it with the `diff` output from
  Step 2's `Verify` and the override the gate now honours when `override.reason` is present and the
  diff digest matches; `DEVDIGEST_SKIP_PR_REVIEW=1` is the last resort, with the reason stated.
- **Commit only when asked.** This plan says where the boundaries are; it authorises no push and no
  pull request. The pull request, when it comes, targets `lesson-07`.

## Handoff

Plan file:      `specs/plans/export-to-ci.md`
Entry point:    **Step 1, Step 2 and Step 3 in parallel** — none of them depends on another, and
                that is checked, not assumed: the server copy of `AgentManifest` already exists, so
                generation needs no contract work, and the client mirror needs no column.
Execution mode: **multi-agent, three tracks, never more than three implementers at once** — the
                caller's ceiling is 3–5 and the dependency graph genuinely forks. The waves:

                | Wave | Steps | Agents |
                |---|---|---|
                | 1 | 1 · 2 · 3 | three implementers, disjoint files |
                | 2 | 4 (`test-writer`) · 5 · 8 | two implementers + one `test-writer` |
                | 3 | 6 · 9 (`test-writer`) | one implementer + one `test-writer` |
                | 4 | 7 (`test-writer`) | one `test-writer` |
                | 5 | 10 | one implementer, after the external merge |

                Steps 5 → 6 are strictly sequential (same three files). Steps 8 → 9 → (10) are
                strictly sequential. The server track and the client track never touch a shared
                file after Step 2, which is what makes wave 2 safe.
Tests:          **the implementer writes none.** Steps 4, 7 and 9 are `test-writer`'s, each named
                above with the implementation step it depends on: 4 → 3, 7 → 5 + 6 + 1, 9 → 8. Every
                one asserts only over data its dependencies already produce; none reads a row a
                later step writes.
Verification:   per step above. Closing lanes, with today's baselines so a regression is visible:
                `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (was 28 files /
                497 tests) · `cd server && pnpm typecheck` (clean) · `cd server && pnpm arch:check`
                — **read the output**: `✔ no dependency violations found` and `‼ 16 known
                violations ignored` · `cd server && pnpm exec vitest run .it.test` (Docker; 15 files
                today, 16 after Step 7) · `cd client && pnpm test && pnpm typecheck` (was 42 files /
                321 tests, clean) · `cd agent-runner && pnpm test` (3 files / 23 tests) — unchanged,
                and that is the point: it is the proof this stream did not touch that package.
                Ports for this worktree: API 3075, WEB 3074, database `devdigest_l07b`.
Manual checklist (nothing below is a step, and none of it has an automated `Verify`):
                **Two prerequisites are already done and were verified with `gh`, not assumed** —
                the token carries `gist, read:org, repo, workflow`, so no `gh auth refresh` is
                needed, and `devsiteua/devdigest-review-fixtures` is public with Actions enabled
                (`allowed_actions: all`) and `OPENROUTER_API_KEY` already in its Actions Secrets.
                `reference/lessons/WORKING-ORDER.md` still lists both as outstanding and is stale
                on this point; do not re-do them.
                1. `cd agent-runner && pnpm build` — `dist/` is git-ignored, so AC-16 fires on a
                   fresh clone. Today's three files total 1 610 448 bytes, a fifth of the 8 MB
                   ceiling.
                2. Put a 32-character-or-longer `DEVDIGEST_CI_TOKEN` in
                   `~/.devdigest/secrets.json` (mode 0600), and the same value in the fixtures
                   repository's Actions Secrets if the ingest step is to be exercised from CI.
                3. Run the wizard against `devsiteua/devdigest-review-fixtures`, read the
                   generated PR — the `permissions` block is what its reviewer is being asked to
                   approve — merge it, open a **non-fork** test PR, and confirm: the agent's review
                   appears; a CRITICAL turns the required check red; **no secret appears in the job
                   log or in the uploaded artifact**; `devdigest-result.json` is downloadable from
                   the run.
                4. POST the downloaded artifact to `POST /ci/ingest` with the same token, and
                   confirm the run appears in CI Runs with its job link. This is the spec's
                   Open question 1, answered: no tunnel.
                5. AC-11 against a genuine fork PR is the *second* run, deliberately after the
                   first, so the secrets scenario stays unambiguous.
                The ESM failure mode is **not** on this list any more: the export ships `ncc`'s own
                `package.json`, so the module type is scoped to `.devdigest/runner/` whatever the
                target repository declares (AC-35). Worth knowing while reading a job log: the
                fixtures repo already declares `"type": "module"`, so this checklist could never
                have caught the bug — which is the whole argument for having fixed it in the
                generator.
Closing step:   after Step 10 is green, set the spec's `Status:` to `done`, then `/engineering-insights`
                — the candidates this plan already knows about are the ESM shape of an `ncc` bundle
                landing in a repository that may declare `"type": "commonjs"`, and the fact that a
                message file (`client/messages/en/ci.json`) shipped a full description of four
                surfaces nobody had built. `/pr-self-review` last, before the pull request into
                `lesson-07`.
Deviation policy: stop at the step, report the divergence, finish the independent steps.
                  Do not re-plan, and do not amend the spec — a gap goes to `spec-creator`.

## Recommendations

Each is a **proposal**, not a step, and none is implemented unless it is picked up.

- **Keep `RUNNER_FILES` the single list.** The refusal (AC-16), the preview list (AC-03) and the
  commit payload (AC-35) are three readings of one fact, and the only way they can disagree is if
  someone re-types the names. One `as const` in `constants.ts`, three consumers.
- **Pin the action SHAs with their tags in a comment, and add a unit assertion that each one is
  40 hex characters.** AC-08 already forces the shape; what it cannot catch is a SHA that is
  well-formed and points at nothing. The comment is what makes the pin auditable a year later.
- **Write Step 8 last if context runs short, and never first.** It is the only step whose
  requirements come from outside the repository (`reference/devdigest-design/`) and the one most
  likely to grow — the artboards show filters, an editable workflow, a trace link and an "Update CI
  config" button that the spec has already ruled out four separate times.
- **Consider a freshness check on the runner bundle in iteration 2.** AC-16 catches *absent*, never
  *stale*, and nothing rebuilds `dist/`. Comparing the bundle's mtime against the newest mtime under
  `agent-runner/src` and `reviewer-core/src` is a warning line in the Preview step and would have
  saved the first person who exports an agent built against last week's engine.
- **Do not add a `run_traces` row for a CI run to make the Trace link work.** The link is out of
  scope precisely because there is nothing behind it; the trace lives in the target repository's job
  log, and inventing a local one would make the studio claim knowledge it does not have.
- **Run `/workflow-retro` after Step 10.** This is the first run in this repository with three
  parallel implementers and a separate `test-writer`, and the retro is the only place what that
  costs gets written down.
