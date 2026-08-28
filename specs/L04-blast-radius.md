# L04 part two — Blast Radius

Status: in-progress
Owner: devsiteua
Packages touched: server · client · mcp

## Goal

A reviewer opening a pull request can see, without reading the repository, what else the
diff can reach: which symbols the changed files declare, who calls them, and which HTTP
endpoints and scheduled jobs sit downstream of those callers. Every node and every edge
comes from the pre-built `repo-intel` index — the request costs no AST parse, no import-graph
build and no model call. The same map is available to an agent over MCP through
`get_blast_radius`, which stops being a stub.

## Context

### What already exists and is being used

- **The facade.** `repoIntel.getBlastRadius(repoId, changedFiles)`
  (`server/src/modules/repo-intel/service.ts:220`) with its persistent path
  `tryPersistentBlast` (`:315`), which reads `symbols`, `references.decl_file`, `file_rank`
  and `file_facts` from Postgres and parses nothing. Today it has **no consumers** —
  `grep -rn "getBlastRadius" server/src` outside `modules/repo-intel/` is empty — so its
  behaviour is ours to correct where it is wrong.
- **The reverse import graph.** `file_edges` with the index `file_edges_repo_to_idx
  (repo_id, to_file)` (`server/src/db/schema/repo-intel.ts`), written by the indexer through
  dependency-cruiser. This is what "who depends on this file" reads in O(degree).
- **Per-file facts.** `file_facts.endpoints` / `.crons`, extracted at index time by
  `extractEndpoints` / `extractCrons` (`server/src/adapters/codeindex/extract.ts:182,202`).
- **The read-time limits, already named.** `MAX_CALLERS_PER_SYMBOL = 20` and `BFS_DEPTH = 2`
  (`server/src/modules/repo-intel/constants.ts`) — the two numbers the brief asks for are
  already constants in this repo.
- **The contract.** `ChangedSymbol` / `BlastCaller` / `DownstreamImpact` / `BlastRadius`
  (`server/src/vendor/shared/contracts/brief.ts:91-118`) — exactly the
  "symbol → callers → endpoints → crons" shape this feature needs. It is already a member of
  `PrBrief` (`:192`).
- **The design.** Screen key `blast-radius-study`, artboards `blast-tree` (default) and
  `blast-graph`, entry `reference/devdigest-design/src/features/pull-requests/blast-radius.jsx`.
  In the prototype it is a `Card` with `SectionLabel icon="Workflow"` inside the PR detail's
  `BriefCard` (`pr-detail.jsx:76`), beside Intent and Risks.
- **Copy, already written.** `client/messages/en/blast.json` carries `stat.{symbols,callers,
  endpoints,crons}`, `view.{tree,graph}`, `callerCount`, `noDownstream`, `graph.empty`.
  Separately, `client/messages/en/brief.json` has `block.blast` — that is L05's PR Brief
  block label, not ours.
- **The module template.** `modules/smart-diff/` (L03): `routes.ts` → `service.ts` →
  `repository.ts`, a `GET /pulls/:id/…` read derived per request from tables other flows
  maintain, and a route log line carrying `llmCalls: 0`.
- **The MCP stub.** `mcp/src/tools/get-blast-radius.ts` returns `isError: true` with
  `status: "not_implemented"`, and `getBlastRadiusOutput` (`mcp/src/schemas.ts:227`) **is**
  that error shape.

### The demo data, verified against the live database

The demo repository is `devsiteua/devdigest-review-fixtures` (registered, cloned, indexed).
On 2026-08-28 its index was resynced and is `status: full`, `last_indexed_sha 13d9abb`,
23 files. Its `main` gained an HTTP/service/job layer and three new demo pull requests.

**PR #10 — "Widen order visibility for support agents"** changes exactly one file,
`src/auth/authorization.ts`. Queried directly from Postgres with the same joins
`tryPersistentBlast` uses:

| Fact | Value |
|---|---|
| Changed symbols | `canManageUsers` (function, exported, line 3), `canViewOrder` (function, exported, line 7) |
| Resolved callers | 8 references across 4 files: `src/orders/order-access.ts:5,11` · `src/api/admin-router.ts:28,39` · `src/jobs/order-digest.ts:18` · `tests/authorization.test.ts:30,34,39` |
| Endpoints, depth 1 | `src/api/admin-router.ts` → `GET /admin/users`, `GET /admin/orders/:id` |
| Endpoints, depth 2 | `src/api/orders-router.ts` (via `order-access.ts`) → `GET /orders`, `GET /orders/:id` |
| Crons, depth 1 | `src/jobs/order-digest.ts` → `0 * * * *` |
| Direction control | the changed file itself imports `../domain/models`; if the traversal direction is ever inverted, `domain/models.ts` appears in the map and the bug is visible at a glance |

So the acceptance number ("at least two real callers and one HTTP endpoint") is met with
margin, and the depth-2 endpoint is what proves the reverse traversal is real rather than a
one-hop lookup dressed up as one.

**PR #11** (README only) and **PR #12** (a new isolated `src/utils/format-currency.ts`) both
produce zero changed symbols — a new file has no rows in an index built from `main`
(`select count(*) from symbols where path='src/utils/format-currency.ts'` → 0). They exercise
the same empty state, not two different ones.

`pr_files` is currently populated for PR #10 only: that table is rewritten by
`GET /pulls/:id`, so a PR whose detail page was never opened has no file rows at all.

### How the index actually resolves a caller — the constraint everything else follows from

`RepoIntelRepository.resolveReferences` (`repository.ts:406`) sets `references.decl_file`
only when **all** of the following hold: there is a `file_edges` row from the referencing
file to the declaring file; the declaring file exports a symbol of exactly that name; and
there is exactly one such candidate (`HAVING count(*) = 1`). `getResolvedCallers` (`:503`)
then inner-joins `file_rank`, so a caller file with no rank row is invisible.

Two consequences: a call reached through the barrel (`src/index.ts`) is never attributed, and
a symbol name that two modules both export is dropped rather than guessed. The fixtures repo
satisfies both conditions by construction, and the verification greps that keep it that way
live in its own repository.

## In scope

### Server

- **`modules/repo-intel` — two facade additions and two corrections.**
  - `getBlastRadiusFromIndex(repoId, files): Promise<BlastResult | null>` — the existing
    `tryPersistentBlast` promoted to the `RepoIntel` interface, returning `null` when the
    index cannot answer. **The blast route never calls `getBlastRadius`**, because its
    fallback path spawns ripgrep over the clone (`container.codeIndex.symbols/references`,
    `adapters/codeindex/ripgrep.ts`) and re-reads clone files for `extractEndpoints` — which
    is precisely the request-time repository parse the brief forbids.
  - `getDependents(repoId, files, depth = BFS_DEPTH)` — reverse breadth-first walk over
    `file_edges` keyed on `(repo_id, to_file)`, returning `{ file, depth, endpoints, crons }`
    per dependent. New repository method `getReverseEdges(repoId, toFiles)`.
  - The caller cap becomes **per changed symbol**. Today `tryPersistentBlast` ends with
    `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` over the whole flat array, which is a global
    cap of 20 and contradicts the constant's own documented meaning.
  - The caller sort gains tie-breakers: `rank DESC, file ASC, line ASC`. Equal ranks are
    common (two references from one file share a rank exactly), and ordering ties by planner
    output is the same defect the root `CLAUDE.md` records about `defaultNow()`.
- **`contracts/review-api.ts`: `BlastRadiusResponse`** = `BlastRadius` extended with
  `status: 'ok' | 'partial' | 'degraded'`, `reason: string | null` and
  `indexed_sha: string | null`. The base `BlastRadius` in `brief.ts` is **not** touched — it
  is a member of `PrBrief`, and widening it would drag L05's Brief into this change. The
  mirror edit in `client/src/vendor/shared/contracts/review-api.ts` ships in the same commit.
- **New module `server/src/modules/blast/`** (`routes.ts` · `service.ts` · `repository.ts` ·
  `helpers.ts` · `constants.ts`) plus one line in `modules/index.ts`. `GET /pulls/:id/blast`:
  resolve the PR through `container.reviewRepo.getPull(workspaceId, prId)` (the one
  workspace-scoped PR query), read `pr_files`, call the two facade methods, assemble
  `DownstreamImpact[]`, log `{ prId, symbols, callers, endpoints, crons, status, llmCalls: 0,
  durationMs }`.
- **Endpoint attribution is per symbol, and the traversal is seeded from that symbol's own
  callers.** `DownstreamImpact.endpoints_affected` is a per-symbol field, so a single
  traversal from the changed file would give every symbol the same list. Level 1 is the
  symbol's caller files (which are, by construction, direct importers of the changed file);
  one further reverse hop reaches level 2. Total depth from the changed file is exactly two,
  as the brief requires. Verified against the demo data: `canViewOrder` gets four endpoints,
  `canManageUsers` two.
- **Four honest states**, carried by `status` + `reason`, never by an empty array alone:

  | `status` | `reason` | When |
  |---|---|---|
  | `degraded` | `index_missing` · `index_failed` · `repo_intel_disabled` | no usable index; the facade returned `null` |
  | `partial` | `index_partial` | `repo_index_state.status = 'partial'` — the map is real but incomplete |
  | `ok` | `no_changed_files` | the PR has no `pr_files` rows (its detail was never loaded) |
  | `ok` | `no_indexed_symbols` | files present, but none declares a symbol in the index at `indexed_sha` |
  | `ok` | `no_callers` | symbols present, nothing downstream |
  | `ok` | `null` | a populated map |

- **Endpoints are read from non-test files only.** A test file can declare routes — in the
  demo repo `tests/router.test.ts` has `file_facts.endpoints = ["GET /orders","POST /orders"]`
  while `POST /orders` exists nowhere in production code. One constant and one filter in
  `helpers.ts`. **Callers from test files are kept**: those are real calls of real code.

### Client

- `client/src/lib/hooks/blast.ts` — `useBlast(prId, enabled)`, 404 → `null`, modelled on
  `hooks/smart-diff.ts`. The `enabled` gate is not a convenience: `GET /pulls/:id` rewrites
  `pr_files` inside a transaction, so the request waits until `usePullDetail` has resolved.
  It is additionally gated on `tab === "blast"`, so opening a PR does not fetch a map nobody
  asked for.
- A `blast` tab in `PrDetailHeader` (`Tabs`, icon `Workflow`) and a `{tab === "blast" && …}`
  branch in `…/pulls/[number]/page.tsx`. The page resolves `?tab=` with
  `search.get("tab") ?? "overview"` and carries no allow-list array, so there is no second
  copy of the tab list to fall out of sync.
- `_components/BlastTab/` composed of `BlastSummaryStats`, `BlastTree`, `BlastGraph` —
  the design's card verbatim: the four-stat row (symbols · callers · endpoints · cron/jobs),
  the `tree | graph` toggle, the collapsible symbol rows, the caller lines, the endpoint and
  cron badges. Built as a self-contained card so L05 can mount the same component inside the
  Brief without a rewrite.
- **Clickable `file:line`** — `MonoLink href={githubBlobUrl(repoFullName, indexed_sha, file,
  line)}`. The link is pinned to `indexed_sha`, **not** to the PR head: the line number came
  out of the index built at that commit, and it is the only sha at which it is guaranteed to
  be right.
- Empty and degraded states rendered from `blast.json` (extended with the new reasons), with
  the degraded banner offering "Re-analyze" (`POST /repos/:id/resync`, `useResyncRepoIntel`
  already exists).

### MCP

- `get_blast_radius` becomes real: resolve `repo` + `pr` → pull id through the existing
  `src/api/resolve.ts`, then `GET /pulls/:id/blast`. `isError: false`.
- `getBlastRadiusOutput` is **replaced by a projection of the existing contract** — keys stay
  `changed_symbols`, `downstream[].{symbol, callers, endpoints_affected, crons_affected}`,
  `summary`, plus `status` / `reason`. Conciseness means fewer callers in the array, never
  different field names. (`mcp/INSIGHTS.md`, 2026-08-28: the contract "is not `mcp/`'s to
  invent".)
- `src/shape/blast.ts` for the projection, `src/copy.ts` description rewritten, the
  `mcp/README.md` tool row corrected, `test/tool-surface.test.ts` and the live lane updated.

### Optional — the one model call

- `POST /pulls/:id/blast/explain`: exactly one structured call that turns the already-computed
  map into one paragraph. Nodes and edges are passed **in**; the model invents none of them.
- The model comes from a module-local constant in `modules/blast/constants.ts`.
  `resolveFeatureModel` is **not** called and no sixth `FeatureModelId` is added:
  `FeatureModelId` is a fixed five-value enum (`contracts/platform.ts:15`), so a new entry
  would cost two mirror edits plus the client's duplicate registry plus a Settings row, for
  one paragraph — and the registry's `conventions` default (`gpt-5.4`) is exactly the trap
  `INSIGHTS.md` records about that helper.
- Triggered by an explicit "Explain" button. The `GET` route stays model-free, and that is
  what makes the "the main scenario calls no LLM" criterion checkable.

### Extra task — `devdigest review --mode working`

- **First, and before any `console.log` exists:** narrow the stdout rule in `mcp/CLAUDE.md`
  from "nowhere in `src/`" to "no stdout writes on any path reachable from `src/index.ts`",
  and point `test/stdio-purity.test.ts` explicitly at the MCP entry point. Recorded as an
  open question in `mcp/INSIGHTS.md` (2026-08-28) with this exact resolution: keep the rule
  as written and the CLI cannot print; delete it and the MCP transport breaks intermittently
  with the reason visible only on stderr.
- `POST /reviews/working` on the server — accepts a unified diff and an agent, runs the same
  `reviewPullRequest` engine through the same input builders as a PR review, returns the same
  grounded findings, persists nothing. It is **synchronous**, deliberately unlike its
  neighbour `POST /pulls/:id/review`, which is fire-and-forget and would leave the CLI with
  nothing to print.
- The reuse is a pure extraction: the private input builders in
  `modules/reviews/run-executor.ts` (`buildSkillBlocks`, the provider resolution) move to
  `modules/reviews/inputs.ts` and both callers use them. No second review implementation.
- CLI in `mcp/`: its own entry point, `git rev-parse --show-toplevel` → `git diff HEAD` →
  POST → severity · path:line · title. Untracked files are **excluded and said so in
  `--help`**. Exit codes are a documented contract: `0` no blocking findings, `1` blocking
  findings, `2` the review could not run. `--mode` is an enum whose only implemented value is
  `working`; `staged` and `branch` parse and fail with "not implemented".

## Out of scope

- **Touching `BlastRadius` in `brief.ts`.** It is `PrBrief`'s member; the response type is a
  separate extension in `review-api.ts`.
- **Any change to the indexer.** No new tables, no migration, no re-extraction. If the index
  cannot answer, the feature says so.
- **A `blast` entry in `FEATURE_MODELS`** and its Settings row — see the reasoning above.
- **An e2e flow.** The hermetic stack seeds `acme/payments-api`, which has no clone and no
  index, so a flow could only assert the degraded state; `e2e/specs/*.json` are additionally
  coupled to seed literals. The states are covered by the server and client suites instead.
- **A tab count badge.** `Tabs` supports `count`, but filling it would mean fetching the map
  on every PR page load.
- **Seed changes.** The demo is a real indexed repository, so `server/src/db/seed.ts` is not
  touched — and therefore neither is the `e2e/specs/*.json` grep that every previous lesson
  owed.
- **`--mode staged` / `--mode branch`.** Declared, not implemented.
- **Internal deep-links into the diff viewer.** Every `file:line` opens GitHub at
  `indexed_sha`; a caller usually lives outside the PR's diff, so there is nothing on the
  Files tab to jump to.

## Decisions

**D1 — the route reads the index or admits it cannot.** No ripgrep, no clone reads, on any
path reachable from `GET /pulls/:id/blast`. This is the difference between meeting and
failing the "server does not rebuild the AST and import graph during the request" criterion,
and it is why a new facade method exists at all.

**D2 — the blast module imports nothing from `modules/repo-intel`.** `container.repoIntel` is
already typed, so return types arrive by inference; the module declares its own DTOs. This
avoids a `no-cross-module-import` warning that `pnpm arch:check` **cannot** fail on — that
rule alone is `severity: 'warn'` (`.dependency-cruiser-onion.cjs:96`) and depcruise's exit
code counts errors only. The output is read, never the exit code, and
`.dependency-cruiser-known-violations.json` is not appended to.

**D3 — `status` and `reason` are two fields, not seven.** The brief asks for `partial` /
`degraded`; the emptiness cases are `ok` with a reason. One enum of reasons covers both.

**D4 — the caller cap is per symbol.** The constant says so, no test pins the current global
behaviour, and the method has no other consumer.

**D5 — the tab, not the Overview card.** The design places Blast in the Brief card; the brief
says "add a Blast tab". The brief is what is graded, so it is a tab — with the design's card
as its content, kept self-contained for L05.

**D6 — `indexed_sha`, not `head_sha`, in every link.** The line came from the index.

**D7 — the optional paragraph is one call, behind a button.** See the model-selection
reasoning above.

**D8 — the CLI's server route is synchronous.** See the fire-and-forget note above.

## The brief, item by item

Filled in with evidence before this spec moves to `done`. A line may say what is not built
yet; it may never say the brief does not require something.

| Brief item | Lands in | Verdict |
|---|---|---|
| Server module `blast/` and route `GET /pulls/:id/blast` | commit 2 | |
| Get the PR's changed files | commit 2 (`pr_files`) | |
| Symbols declared in those files, via the `repoIntel` facade | commits 1–2 | |
| Importers and callers per symbol | commit 1 | |
| Exclude the declaring file | commit 1 | |
| Cap at 20 callers per symbol | commit 1 | |
| Sort callers by file rank | commit 1 | |
| Path to HTTP routes via the reverse import graph | commit 1 | |
| Traversal limited to two levels | commits 1–2 | |
| Incomplete index → `partial` / `degraded` with an explanation | commit 2 | |
| Missing data is never masked as an empty array | commit 2 | |
| Blast tab: symbols → callers → endpoints | commit 3 | |
| `file:line` clickable, opens the right line | commit 3 | |
| `get_blast_radius` over the same server route | commit 6 | |
| Optional: one cheap model call explaining the map | commit 4 | |
| **Acceptance:** demo PR shows ≥2 real callers and ≥1 endpoint | verified in Context | |
| **Acceptance:** server does not rebuild AST / import graph per request | D1, commit 1 | |
| **Acceptance:** clear empty state | commit 2–3 | |
| **Acceptance:** separate `partial` / `degraded` state | commit 2–3 | |
| **Acceptance:** main scenario makes no LLM call; the optional summary is exactly one | commits 2, 4 | |
| **Acceptance:** `get_blast_radius` returns a concise structured result | commit 6 | |
| **Extra:** `devdigest review --mode working` reusing the reviewer and domain logic | commits 7–9 | |

## Implementation plan

Ten commits. Conventional commits, feature-scoped, in the repository's established rhythm:
the spec first, `docs(<scope>): close the spec, and record what it taught` last.

| # | Commit | Verify |
|---|---|---|
| 0 | `docs(specs): plan Blast Radius before writing any of it` | — |
| 1 | `feat(repo-intel): answer the blast question from the index, or not at all` | `cd server && pnpm exec vitest run repo-intel` · `pnpm arch:check` (read the output) |
| 2 | `feat(blast): what a PR's diff reaches, and the four ways it can say "nothing"` | `vitest run blast` · `vitest run blast.it.test` · `cd client && pnpm typecheck` |
| 3 | `feat(blast): the Blast tab, and a caller's file:line that opens where the index read it` | `cd client && pnpm test && pnpm typecheck` |
| 4 | `feat(blast): explain the map in one paragraph, only when asked` | the it-test that serves `GET` with providers throwing on every method |
| 5 | `docs(blast): the map in the architecture doc, and a glossary line that stops promising it` | — |
| 6 | `feat(mcp): get_blast_radius, and the output schema that had to go with it` | `cd mcp && pnpm typecheck && pnpm test` · the Inspector |
| 7 | `docs(mcp): scope the stdout rule to the process it protects` | `cd mcp && pnpm test` |
| 8 | `feat(reviews): review a diff with no pull request behind it` | `vitest run reviews.it.test` |
| 9 | `feat(mcp): devdigest review --mode working, and the exit code it promises` | `cd mcp && pnpm test` + a manual run |
| 10 | `docs(blast): close the spec, and record what it taught` | — |

Commits 4 and 7–9 are droppable without leaving a gap: the pull request still meets every
required criterion without them, which is why they sit at the end.

Commit 5 rewrites `docs/glossary.md:77`, which currently reads "Facade method exists; the
product feature arrives in L04" — the sentence this work makes true — and adds the read path
to `docs/architecture.md` plus the facade list in `modules/repo-intel/README.md`.

## Acceptance criteria

- [ ] `GET /pulls/:id/blast` on the demo PR returns 2 changed symbols, ≥4 caller files and
      ≥3 endpoints, and its log line carries `llmCalls: 0`.
- [ ] The endpoint list for `canViewOrder` contains a route from `src/api/orders-router.ts`,
      which is two import hops from the changed file — the reverse traversal is real.
- [ ] `domain/models.ts` never appears in the map: the graph is walked from the changed file
      outward to its dependents, not to its dependencies.
- [ ] No code path reachable from the route calls `container.codeIndex`, `container.git` or
      reads the clone. Checked over code lines only:
      `grep -vE '^\s*(\*|//|/\*)' server/src/modules/blast/*.ts | grep -nE 'codeIndex|container\.git|readFile'`
      finds nothing. (A grep criterion also matches prose; this one is scoped to code
      deliberately.)
- [ ] Each caller row's `file:line` opens GitHub at `indexed_sha` and lands on the line the
      index recorded — spot-checked against `src/orders/order-access.ts:5` and
      `src/api/admin-router.ts:28`.
- [ ] A PR whose files declare no indexed symbol renders "no indexed symbols", not "this PR
      affects nothing", and says which sha it looked at.
- [ ] A repository with no index (the seeded `acme/payments-api`) renders the `degraded`
      banner with a reason and a working "Re-analyze" action.
- [ ] An index whose state is `partial` yields `status: 'partial'` — covered by a test, since
      neither indexed repository is currently partial.
- [ ] `get_blast_radius` over MCP returns the same symbols, callers and endpoints as the tab,
      with `isError: false`, and its `structuredContent` validates against the new
      `outputSchema` **when driven through the Inspector**, not only through the unit lane.
- [ ] The optional explain endpoint makes exactly one model call and the `GET` route makes
      none.
- [ ] Unchanged: `POST /pulls/:id/review` still returns `reviews: []` and still runs in the
      background; `reviews.it.test.ts` passes untouched after the input-builder extraction.
- [ ] Unchanged: `cd mcp && pnpm typecheck` is green — it is the only drift guard that package
      has, and it has no CI workflow (`TESTING.md`).
- [ ] `pnpm arch:check` **output** is empty for the new module; the known-violations baseline
      is not appended to.

## Test plan

Server tests live in `server/test/`, not beside the module (the one colocated test in the
repository is a deliberate exception).

- **`server/test/blast-helpers.test.ts`** (unit) — per-symbol grouping and the 20 cap; the
  rank/file/line sort including a tie; the reverse-BFS level assignment at depth 1 and 2;
  the test-file endpoint filter; the `status`/`reason` decision table, one case per row.
- **`server/test/repo-intel-blast.test.ts`** (unit) — `getBlastRadiusFromIndex` returns
  `null` for a missing index, for `status: 'failed'` and when `repoIntelEnabled` is false,
  with a container whose `codeIndex` throws on every method: the ripgrep path must be
  unreachable.
- **`server/test/blast.it.test.ts`** (integration, real Postgres) — seeds symbols,
  references, edges, rank and facts for a small graph, then drives the route: the populated
  map, each empty state, `partial`, and a run with LLM providers that throw on every method
  to prove the route spends nothing.
- **`client`** — `BlastTab` renders symbols, callers and endpoint badges; the tree/graph
  toggle; each empty and degraded state; the `MonoLink` href contains `indexed_sha` and
  `#L<line>`. Interaction via `fireEvent` (`@testing-library/user-event` is not installed);
  style assertions read `element.getAttribute("style")`, because jsdom drops any declaration
  containing `var()`; the screen-level test stubs `components/app-shell`.
- **`mcp`** — hermetic: injected `fetch` returns a fixed blast payload, the tool projects it,
  `tool-surface.test.ts` asserts the new `outputSchema` and `isError: false`. Live lane:
  against the running API on the demo PR. Then the Inspector, flagless from `mcp/`
  (`node_modules/.bin/tsx src/index.ts` — `--cli` swallows the spawned command's own flags).
- **Extra task** — `reviews.it.test.ts` gains a case for `POST /reviews/working` with a mock
  provider; the CLI's diff parsing and exit-code mapping are unit-tested in `mcp/test/`.

## Risks

- **The input-builder extraction touches the live review path.** It is the only change in
  this work that can break something a user already relies on, and it serves the optional
  task. Mitigation: it is a pure move, it lands after the whole graded feature is finished,
  and `server/test/reviews.it.test.ts` is the guard.
- **The index goes stale.** The map is computed against `main` at `indexed_sha`. If the demo
  repository moves, the map silently describes an older commit. Mitigation: `indexed_sha` is
  in the response and rendered on screen, and the degraded banner offers a resync.
- **A caller file without a `file_rank` row disappears**, because `getResolvedCallers`
  inner-joins that table. The indexer ranks every walked file, so this only bites on a
  partial index — which is exactly what `status: 'partial'` is for.
- **`check:contract-mirror` in the pre-PR gate compares changed line sets**, so the two
  `vendor/shared` copies must be edited identically in one commit. `review-api.ts` and
  `brief.ts` are currently in sync (`diff -rq` shows drift only in `adapters.ts`,
  `contracts/eval-ci.ts`, `contracts/productionize.ts`), so identical edits produce identical
  line sets. Do not reconcile the unrelated drifted files here.
- **Scoring a grep criterion over whole files also scores the comments.** The one grep in
  the acceptance list is scoped to code lines for that reason.

## Open questions

None. Two earlier ones are settled: the optional model call is built (the brief marks it
optional but gives it its own acceptance criterion, "exactly one call"), and no extra demo
pull request is needed for the "symbols but no callers" state — it is covered by a test.
