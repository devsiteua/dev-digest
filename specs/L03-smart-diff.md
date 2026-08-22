# L03 — Smart Diff (reviewer-ordered diff)

Status: draft
Owner: devsiteua
Packages touched: server · client · e2e

## Goal

A reviewer opening **Files changed** sees the PR's business logic first and its
lock file last, collapsed. Once a review has run, each file card carries a
findings badge that jumps the reader to the offending line in the diff.

The ordering is **deterministic**: it is computed from data that is already in the
database (`pr_files` + the latest review's `findings`) and costs no model call.

## Context

Everything this feature consumes already exists:

- `GET /pulls/:id` persists `pr_files` (`path`, `additions`, `deletions`, `patch`) —
  `server/src/modules/pulls/routes.ts:220`.
- `GET /pulls/:id/reviews` returns `ReviewRecord[]` with `findings[{file,start_line,severity}]` —
  `server/src/modules/reviews/routes.ts:129`.
- The response contract is already written and **already mirrored**: `SmartDiff`,
  `SmartDiffRole`, `SmartDiffFile`, `SmartDiffGroup`, `ProposedSplit` in
  `server/src/vendor/shared/contracts/brief.ts:154-187`, re-exported as
  `SmartDiffResponse` in `contracts/review-api.ts:118`. `diff` over the two
  `vendor/shared` copies is empty today, so this feature needs **no contract edit**
  and therefore no mirror edit.
- `server/test/contracts.test.ts:113` already parses the design's `DIFF` fixture
  through `SmartDiff`.
- The i18n keys exist and are dead: `client/messages/en/prReview.json` → `smartDiff`
  (`coreLabel`, `wiringLabel`, `boilerplateLabel`, `largeTitle`, `largeBody`,
  `filesCount`, `findingLines`, `groupedByRole`). Nothing in `client/src` reads them.
  This is the "scaffold left behind by a cut feature" that root `INSIGHTS.md`
  (2026-08-02) tells us to grep for before building.

Design reference (read before any UI step):

- screen key **`pull-request-detail`**, artboard **`pr-files`**
- files read: `docs/design-manifest.json`, `docs/SOURCE_INDEX.md`,
  `src/features/pull-requests/reviewer-diff.jsx` (symbols `ROLE`, `CodeLine`,
  `DiffFileCard`, `SplitBanner`, `SmartDiff`), `src/features/pull-requests/pr-detail.jsx`
  (`FilesTab`), `src/data/core-mock-data.jsx` (`DIFF`), `BRIDGE.md`.

What the design specifies, and this spec adopts:

| Element | Design |
|---|---|
| Header row | `9 files · +247 −38` left; a two-button segmented control `Smart order` / `Original order` right |
| Group header | role dot (`--accent` / `--warn` / `--text-muted`) · bold label · muted description · `N files` right, `position: sticky` |
| Role copy | core "Core logic — The substance of the change — review closely" · wiring "Wiring — Hooks the core into the app" · boilerplate "Boilerplate — Generated / mechanical — skim" |
| File card | chevron · `FileText` · mono path · finding dot · `summary` chip · `+N −M` |
| Open by default | `file.finding_lines.length > 0` |
| Line marker | 3 px severity bar on the left edge + severity word on the right (`blocker` for CRITICAL) |
| Split banner | `--warn` border/background, `AlertTriangle`, "This PR is N lines. Consider splitting:", one row per proposed split |

## In scope

**server** — a new module `server/src/modules/smart-diff/`

- `constants.ts` — every pattern and every threshold. Nothing classifying lives outside it.
- `helpers.ts` — pure: `classifyPath(path) → SmartDiffRole`, group assembly + ordering,
  `buildSplitSuggestion(files)`.
- `repository.ts` — the only SQL: `pr_files` for a PR; the **latest** `kind:'review'` row
  and its findings.
- `service.ts` — joins the two, returns `SmartDiffResponse`.
- `routes.ts` — `GET /pulls/:id/smart-diff`, plus one line in `server/src/modules/index.ts`.
- `server/src/db/seed.ts` — complete PR #482 from 4 `pr_files` rows to the design's 9,
  with real `patch` text, idempotently (see § Risks).

**client**

- `src/lib/hooks/smart-diff.ts` — `useSmartDiff(prId)`, exported from `hooks/index.ts`.
- `src/components/diff-viewer/` — `FileCard` and `CodeLine` gain optional finding props;
  `FileCard` is exported from the component's public surface.
- `src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/` — the feature
  component (groups, badges, split banner, order toggle).
- `DiffTab` renders it, falling back to today's flat `DiffViewer`.
- `messages/en/prReview.json` — extend the existing `smartDiff` block.

**e2e** — `e2e/specs/09-pr-smart-diff.flow.json`.

## Out of scope

- **`pseudocode_summary`.** The contract field stays `null`. Filling it needs a model
  call, and "no new LLM call" is an acceptance criterion. The design's `summary` chip
  and its "What this does:" block therefore never render — the code paths are not
  written, not written-and-hidden.
- **"Generate split PRs"** button and the split checkboxes in the design's `SplitBanner`.
  There is no split-PR machinery anywhere in this repo; a dead control is worse than an
  absent one. The banner lists the proposed splits as read-only rows.
- **Persisting the smart diff.** It is derived on read from two tables. No new table, no
  migration, no cache row.
- **Changing how findings are produced, grounded or scoped** (`reviewer-core`). This
  feature reads findings; it never influences them. `reviewer-core` is not touched at all.
- **A new tab.** Smart Diff replaces the body of the existing Files-changed tab
  (`?tab=diff`). Adding a tab would mean touching the route's `?tab=` allow-list, which
  `client/INSIGHTS.md` (2026-08-12) records as a second copy of the tab bar.
- **Reordering the Findings tab** or the PR list. One surface only.
- **Localisation beyond `en`.** `client/messages/` has one locale.

## Decisions taken (and where they diverge from the mock)

1. **Classification is a first-match ladder**, evaluated boilerplate → wiring → core,
   on the lowercased repo-relative path. `core` is the default, so an unknown path is
   treated as business logic — the safe direction for a reviewer.
2. **Tests and docs are `boilerplate`.** The design's mock puts `test/ratelimit.test.ts`
   in boilerplate, and `server/src/modules/repo-intel/service.ts:710` already treats
   tests/configs/migrations as skip-worthy through `JUNK_PATH_PATTERNS`. Two precedents
   agree; the assignment names only lock/dist/snapshots, so this is an addition, stated
   here rather than buried in a constant.
3. **`package.json` is `wiring`, not `boilerplate`.** The mock groups it with its lock
   file; the written rule is "wiring = configuration", and a new dependency is a thing a
   reviewer must see. The lock file stays boilerplate — that is the acceptance criterion.
4. **The mock's `src/api/users.ts` in boilerplate is not reproduced.** It is
   business logic under `src/api/`; nothing about its path makes it mechanical. The mock
   is hand-made data, not a rule.
5. **Empty groups are omitted.** A "Boilerplate · 0 files" header is noise.
6. **Order inside a group**: findings count desc → changed lines desc → path asc. The
   path tie-break is deliberate: root `CLAUDE.md` records that a sort without a
   secondary key answers in planner order.
7. **"Latest review" means the newest `kind:'review'` row**, tie-broken by `id` — the
   same rule `server/src/modules/pulls/routes.ts:140` uses for the list's severity
   counters, and the same one `client/src/lib/findings.ts` `latestReviewFindings` uses.
   Three surfaces, one definition. Dismissed findings are **included**, because the PR
   list's counters include them and two tallies that disagree are worse than one that is
   arguably generous.
8. **`finding_lines` carries no severity** — the contract has no room for it. The client
   colours the badge from `usePrReviews`, which the PR-detail page already fetches for
   the Findings tab. With reviews absent, the badge still renders in a neutral colour
   from `finding_lines` alone.
9. **`split_suggestion` is deterministic**: `total_lines` = Σ(additions+deletions);
   proposals group `core`+`wiring` files by their first two path segments; `too_big` is
   true only when the total clears `SPLIT_MIN_TOTAL_LINES` **and** at least
   `SPLIT_MIN_PROPOSALS` (2) areas qualify — so the banner can never suggest splitting a
   PR into one PR.
10. **The patches stay on `GET /pulls/:id`.** `/smart-diff` returns paths, stats and
    finding lines — never `patch` text. The client joins the two by path; the diff bytes
    cross the wire once.
11. **"Original order" is the PR's own file order**, not the mock's alphabetical sort.
    GitHub's order is information; `localeCompare` is not.

## Acceptance criteria

- [ ] `GET /pulls/:id/smart-diff` returns a body that `SmartDiff.parse` accepts.
- [ ] A lock file (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`,
      `Cargo.lock`, `poetry.lock`, `go.sum`, `Gemfile.lock`, `composer.lock`) is
      classified `boilerplate` **regardless of directory**, and its card starts collapsed.
- [ ] Groups come back in the order `core`, `wiring`, `boilerplate`; empty groups absent.
- [ ] Before any review exists, every `finding_lines` is `[]` and the viewer still
      groups and orders — the degraded path is the normal path on a fresh PR.
- [ ] After a review, a file with findings shows a badge with the count, starts expanded,
      and clicking the badge scrolls the diff to that line and highlights it.
- [ ] The badges appear after a Run Review **without a page reload** — the reviewer
      returns to the Files tab and sees them, with no 30-second staleness window.
- [ ] A finding whose line is not inside any hunk of the file's patch does not break the
      click: the file opens and scrolls to its card header instead.
- [ ] Serving `/smart-diff` makes no LLM call: an integration test that overrides all
      three provider ids with stubs throwing on every method still gets 200.
- [ ] Every threshold and pattern lives in `server/src/modules/smart-diff/constants.ts`;
      `grep -nE "package-lock|dist/|\.snap" server/src/modules/smart-diff/{helpers,service,routes}.ts`
      finds nothing.
- [ ] `split_suggestion.too_big` is `false` with `proposed_splits: []` for a small PR,
      and the banner is absent.
- [ ] **No file disappears.** Every `path` in `PrDetail.files` renders in exactly one
      group. A path the server did not classify (a race with the detail refresh, a file
      added between the two reads) is appended to `core` rather than dropped.
- [ ] Unchanged: the Files-changed tab still renders inline GitHub comments, the
      hover-`+` composer, and the outdated-comment list. `client/src/test/smoke.test.tsx`
      — the only test that renders `DiffViewer` today — passes untouched.
- [ ] Unchanged: `e2e/specs/05-pr-diff.flow.json` still passes (it asserts
      `src/config.ts` renders in the Files tab).

## Test plan

| Suite | File | Covers |
|---|---|---|
| server-unit | `server/test/smart-diff-helpers.test.ts` (new) | the classification table (one case per bucket + the lock-file-anywhere rule), in-group ordering incl. the path tie-break, `buildSplitSuggestion` above/below threshold, and `SmartDiff.parse` over an assembled response |
| server-integration | `server/test/smart-diff.it.test.ts` (new) | the route on the seeded PR #482: group order, `package-lock.json` in boilerplate, `finding_lines` populated from the **latest** review only (an older review with different findings is inserted and must not leak), 404 on an unknown PR, and 200 with an `llm` that throws |
| client | `.../SmartDiffViewer/SmartDiffViewer.test.tsx` (new) | three group headers render; a core file with findings is open while `package-lock.json` is collapsed; the badge shows the count; clicking it opens the file and calls `scrollIntoView`; the order toggle switches to a flat list; a `PrFile` absent from every group still renders |
| client | `src/test/smoke.test.tsx` (existing, unedited) | regression — the optional props must not change `DiffViewer`'s default rendering |
| e2e | `e2e/specs/09-pr-smart-diff.flow.json` (new) | seeded PR #482 → Files changed → "Core logic" header present, `package-lock.json` present, a core path present. No model call |

`scrollIntoView` is not implemented in jsdom — the component test stubs it on
`Element.prototype`. `@testing-library/user-event` is **not installed**
(`client/INSIGHTS.md`, 2026-08-22) — use `fireEvent`.

## Risks

- **The seed does not converge.** `seed.ts:108` guards PR #482's files behind
  `if (!pr)`, so an existing database never receives the five new rows —
  root `INSIGHTS.md` (2026-08-06) records exactly this failure for skills. The seed step
  therefore backfills `pr_files` for #482 **outside** the creation branch, keyed by path,
  and refreshes `additions/deletions/files_count` on the PR row. Noticed by running
  `pnpm db:seed` twice on a seeded DB and diffing the row count.
- **e2e flows assert seed literals** (root `CLAUDE.md`; `INSIGHTS.md` 2026-08-02). The
  seed step ends by grepping `e2e/specs/*.json` for every value it touched. Only
  additions are made; `src/config.ts`, used by flow 05, stays.
- **Read ordering.** `GET /pulls/:id` rewrites `pr_files` inside a transaction on every
  detail load. A `/smart-diff` request racing that transaction would read the pre-refresh
  snapshot. Mitigated on the client: `useSmartDiff` is `enabled` only once `usePullDetail`
  has resolved. Noticed as a file present in the diff but missing from a group.
- **A PR with no `pr_files`** (imported but never opened) yields empty groups. The viewer
  falls back to the flat `DiffViewer` over `PrDetail.files` rather than showing nothing.
- **The seeded files could be overwritten by a GitHub refresh.** `GET /pulls/:id` deletes
  and re-inserts `pr_files` wholesale on every successful detail fetch
  (`pulls/routes.ts:249-262`). The seeded repo `acme/payments-api` does not exist on
  GitHub, so the call throws and the `catch` serves the persisted rows — the nine seeded
  files survive. On a *real* imported repo the refresh is the correct behaviour and the
  classifier simply runs over the fresher list. Noticed as the demo PR losing its lock
  file after a detail load, which would mean the fictional repo had become resolvable.
- **Cross-module reach.** `smart-diff` resolves the PR through
  `container.reviewRepo.getPull` for workspace scoping, then queries by `prId`. This is
  the pattern `modules/intent/repository.ts:7-16` already documents. `pnpm arch:check`
  warns but does not fail on cross-module imports (`container.ts:145-150`) — the
  discipline is the container, so nothing imports another module's service directly.

## Open questions

None.

## Constraints in force

| Constraint | Source | What it forbids here |
|---|---|---|
| SQL only in `repository.ts`, HTTP only in `routes.ts`, pure transforms in `helpers.ts`, literals in `constants.ts` | `server/CLAUDE.md` § Conventions | a classifier inlined into the route; a threshold inlined into the service |
| Every route starts with `getContext(container, req)` and every query is workspace-scoped | `server/CLAUDE.md` § Conventions | reading `pr_files` by `prId` without first resolving the PR through a workspace-scoped query |
| Dependencies come from `container`, never by importing a concrete class | `server/CLAUDE.md` § Conventions | `new SmartDiffService()` inside the route; a direct import of `IntentService`/`ReviewService` |
| A new module is `routes.ts` + one line in `modules/index.ts`, registered statically | `server/CLAUDE.md`, `server/docs/module-anatomy.md` | filesystem autoload; registering from `app.ts` |
| Route schemas come from `@devdigest/shared`; no hand-rolled `.parse(req.body)` | root `CLAUDE.md`, `server/docs/module-anatomy.md` | a locally declared params schema instead of `IdParams` |
| No route in this codebase declares a `response` schema | verified: `grep -rn "response:" server/src/modules/*/routes.ts` is empty | inventing a response-serialization convention for one endpoint; the guard is the typed return + `SmartDiff.parse` in the unit test |
| A test that touches the DB must be `*.it.test.ts` | root `CLAUDE.md`, `TESTING.md` | putting the route test in `smart-diff-helpers.test.ts` |
| `client/src/vendor/ui/**` is do-not-touch | root + `client/CLAUDE.md` | adding a group header or badge primitive to `@devdigest/ui`; it becomes a feature component |
| No `fetch` in components; data comes from a hook in `src/lib/hooks/` | `client/CLAUDE.md` | `SmartDiffViewer` calling `api.get` itself |
| A component is a folder `<Name>/` with `<Name>.tsx · styles.ts · constants.ts · helpers.ts · index.ts · <Name>.test.tsx` | `client/CLAUDE.md`, `client/docs/component-anatomy.md` | a single-file `SmartDiffViewer.tsx` |
| No hardcoded copy in components | `client/CLAUDE.md`, `BRIDGE.md` rule 2 | the design's "Core logic" / "review closely" strings inline; they go to `messages/en/prReview.json` |
| Never hardcode a colour; use `var(--…)` | `BRIDGE.md` rule 5 | a hex value for the role dot or the severity bar |
| Design: copy layout/wording, not architecture or mock data | `BRIDGE.md` rules 1 & 4 | treating `core-mock-data.jsx` `DIFF` as the contract, or reproducing its `users.ts` placement |
| `server/src/db/migrations/**` generated only | root + `server/CLAUDE.md` | any migration — this feature adds no table |
| Every repo file is English | root `CLAUDE.md` § Conventions | Ukrainian in code, comments, spec or messages |

## Implementation plan

### Step 1 — classification and split rules, as pure functions   ·   package: server
Files:    `server/src/modules/smart-diff/constants.ts` (new) · `server/src/modules/smart-diff/helpers.ts` (new) · `server/test/smart-diff-helpers.test.ts` (new)
Skills:   `onion-architecture`, `typescript-expert`
Do:       `constants.ts` holds `ROLE_ORDER`, the lock-file basenames, the boilerplate path
          patterns (`dist/`, `build/`, `out/`, `.next/`, `coverage/`, `vendor/`,
          `generated/`, `__generated__/`, `__snapshots__/`, `.snap`, `.min.js`, `.min.css`,
          `.d.ts`, `migrations/`, tests, docs), the wiring basenames (`package.json`,
          `tsconfig*.json`, `server.ts`, `app.ts`, `main.ts`, `index.*`, `Dockerfile`,
          `Makefile`) and patterns (`.config.`, `.env`, `.github/`), plus
          `SPLIT_MIN_TOTAL_LINES`, `SPLIT_MIN_PROPOSALS`, `SPLIT_MAX_PROPOSALS`,
          `SPLIT_AREA_DEPTH`, `SPLIT_MIN_AREA_FILES`. `helpers.ts` exports
          `classifyPath`, `buildGroups`, `buildSplitSuggestion` — no imports outside
          `constants.ts`, `@devdigest/shared` types and `src/db/rows.ts`.
          `.dependency-cruiser-onion.cjs` rule `db-schema-only-in-data-layer` is an
          **error** for any `src/modules/**` file whose path does not contain
          `repository`, with `src/db/rows.ts` the single exemption — so `helpers.ts`
          takes row types from `rows.ts` and never from `src/db/schema.js`.
Verify:   `cd server && pnpm exec vitest run smart-diff-helpers`
Depends:  none

### Step 2 — the read, the join and the endpoint   ·   package: server
Files:    `server/src/modules/smart-diff/repository.ts` (new) · `server/src/modules/smart-diff/service.ts` (new) · `server/src/modules/smart-diff/routes.ts` (new) · `server/src/modules/index.ts` (edit) · `server/src/db/rows.ts` (edit — add `PrFileRow`) · `server/README.md` (edit — API map)
Skills:   `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`
Do:       Repository: `filesForPr(prId)`; `latestReviewFindings(prId)` — newest
          `kind:'review'` ordered by `created_at desc, id desc`, then its findings.
          Service: resolve the PR via `container.reviewRepo.getPull(workspaceId, prId)`
          (404 when absent), map findings → `Record<path, number[]>` of unique
          `start_line`s ascending, call the Step-1 helpers, return `SmartDiffResponse`.
          It takes `Container` and constructs its own repository from `container.db` —
          it must not import anything under `src/db/` itself (`db-schema-only-in-data-layer`
          is an error), and must not import `src/adapters/` or `fastify`
          (`no-concrete-adapter-in-app-layer`, `no-fastify-below-delivery`).
          Route: `GET /pulls/:id/smart-diff`, `schema: { params: IdParams }`, no rate-limit
          override (it spends no money), and a `req.log.info` line carrying
          `{ prId, files, groups, findingLines, llmCalls: 0, durationMs }` — the log the
          "no new model call" criterion is checked against. Logging stays in the route
          because a logger parameter would drag `fastify` types below the delivery ring.
          **No `container` getter.** `intent` has one only because `modules/reviews`
          consumes it; nothing consumes smart-diff, so `routes.ts` instantiates
          `new SmartDiffService(container)` the way `modules/reviews/routes.ts:22` (`new ReviewService(container)`) does.
          `server/README.md` § "API map (starter)" is a Mermaid graph with one node per
          module (`README.md:60-73`) — add the `smart-diff` node in the same step, or the
          map silently stops describing the server.
Verify:   `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run routes-smoke`
Depends:  Step 1

### Step 3 — make the seeded PR demonstrable   ·   package: server
Files:    `server/src/db/seed.ts` (edit)
Skills:   `drizzle-orm-patterns`
Do:       Bring PR #482 to the design's nine files —
          `src/middleware/ratelimit.ts`, `src/api/public/webhooks.ts`,
          `src/api/public/index.ts`, `src/server.ts`, `src/config.ts`,
          `src/api/users.ts`, `test/ratelimit.test.ts`, `package.json`,
          `package-lock.json` — with the design's `additions`/`deletions` and real
          `patch` text whose hunk headers place the four seeded finding lines
          (`config.ts:12`, `webhooks.ts:61`, `users.ts:45`, `ratelimit.ts:28`) inside
          rendered lines. Written as a path-keyed backfill **outside** the `if (!pr)`
          branch so an already-seeded database converges. `pr_files` has **no unique
          index on `(pr_id, path)`** (`server/src/db/schema/pulls.ts:36-44`), so the
          backfill is `select existing paths → insert only the missing ones` — an
          `onConflictDoUpdate` would need a migration, which this spec does not add.
          The PR row's
          `additions`/`deletions`/`files_count` are recomputed from the rows. That moves
          `deletions` 38 → 36, because the design's own header (`−38`) does not match its
          file list (36). Recomputing is safe: nothing asserts the seeded value —
          `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.test.tsx:54` uses
          its own 247/38 fixture, not the seed, and no `e2e/specs/*.json` mentions either.
Verify:   `cd server && pnpm db:seed && pnpm db:seed` (idempotent; nine `pr_files` rows for #482 both times), then `grep -rn "src/config.ts\|package-lock\|482" e2e/specs/*.json`
Depends:  none (independent of Steps 1–2; ordered here because Step 4 uses it)

### Step 4 — the route, end to end, against real Postgres   ·   package: server
Files:    `server/test/smart-diff.it.test.ts` (new)
Skills:   `fastify-best-practices`
Do:       Model it on `server/test/intent.it.test.ts`: `startPg`, `buildApp`, migrate,
          seed. Assert group order, `package-lock.json` in boilerplate and
          `src/middleware/ratelimit.ts` first in core, `finding_lines` for
          `src/config.ts` = `[12]`; insert a second, older review with a finding on a
          different file and assert it does not appear; 404 for an unknown id; and a
          200 with `ContainerOverrides.llm` — which is
          `Partial<Record<'openai'|'anthropic'|'openrouter', LLMProvider>>`
          (`container.ts:55`), so all three ids are mapped to a throwing stub.
          Note the belt-and-braces: `container.llm(id)` resolves a secret first
          (`container.ts:236-245`), so an accidental call would already fail in a
          key-free test — the override makes the intent explicit rather than incidental.
Verify:   `cd server && pnpm exec vitest run smart-diff.it.test`
Depends:  Steps 2, 3

### Step 5 — the data hook   ·   package: client
Files:    `client/src/lib/hooks/smart-diff.ts` (new) · `client/src/lib/hooks/index.ts` (edit) · `client/src/lib/hooks/reviews.ts` (edit)
Skills:   `next-best-practices`, `react-best-practices`
Do:       `useSmartDiff(prId, enabled)` over `GET /pulls/${prId}/smart-diff`, query key
          `["smart-diff", prId]`, `enabled: !!prId && enabled`. A 404 resolves to `null`
          (the PR is gone / never imported), like `usePrIntent` does; anything else
          rejects.
          **Staleness is a real hazard here, so it gets two answers.** The global
          `staleTime` is `30_000` (`client/src/lib/providers.tsx:28`) and the smart-diff
          response is refetched by nothing today: `useRunReview` invalidates
          `["reviews", prId]` at *mutation* success, but the review is fire-and-forget
          (`server/CLAUDE.md`: "`runReview()` always returns `reviews: []`"), and the only
          thing that reacts to the run *finishing* is `onRunDone` in `page.tsx:161-165`,
          which calls `refetchReviews()` — a refetch, not an invalidate. So:
          (a) badges and severity are overlaid client-side from `usePrReviews` (Step 7),
          which `onRunDone` already refreshes — that is the criterion "badges appear after
          a review", and it does not depend on this query at all;
          (b) `["smart-diff", prId]` is additionally invalidated in `useDeleteRun` and
          `useDeleteReview` (both already invalidate `["reviews", prId]`), so *ordering*
          follows too. `useFindingAction` is deliberately left alone: accept/dismiss
          changes no `finding_lines`.
Verify:   `cd client && pnpm typecheck`
Depends:  Step 2

### Step 6 — teach the diff viewer about findings   ·   package: client
Files:    `client/src/components/diff-viewer/FileCard/FileCard.tsx` (edit) · `client/src/components/diff-viewer/CodeLine/CodeLine.tsx` (edit) · `client/src/components/diff-viewer/styles.ts` (edit) · `client/src/components/diff-viewer/helpers.ts` (edit) · `client/src/components/diff-viewer/index.ts` (edit)
Skills:   `design-reference` (artboard `pr-files`), `react-best-practices`, `frontend-architecture`
Do:       Add **optional** props only, so every current call site renders byte-identically:
          `FileCard` gains `findingLines?: number[]`, `severityByLine?: Record<number, Severity>`,
          `defaultOpen?: boolean`, `focusLine?: number | null`, `focusToken?: number`;
          `CodeLine` gains `severity?: Severity` (3 px left bar + right-hand severity word,
          per the design) and `focused?: boolean`. When `focusToken` changes, the matching
          line's element is scrolled into view (`block: "center"`) and highlighted for a
          moment; when no rendered line matches, the card header is scrolled to instead.
          Export `FileCard` and its props type from `index.ts`.
          `open` stays **uncontrolled** — `defaultOpen` seeds the existing `useState` and a
          `focusToken` effect calls `setOpen(true)`. Turning it into a controlled prop
          would change how `DiffViewer` behaves for every current caller.
Verify:   `cd client && pnpm typecheck && pnpm test` — `client/src/test/smoke.test.tsx` is the only test rendering `DiffViewer`, and it must pass without an edit
Depends:  none

### Step 7 — the Smart Diff surface   ·   package: client
Files:    `client/messages/en/prReview.json` (edit) · `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/{SmartDiffViewer.tsx,styles.ts,constants.ts,helpers.ts,index.ts,SmartDiffViewer.test.tsx}` (new) · `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (edit) · `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (edit)
Skills:   `design-reference` (artboard `pr-files`), `frontend-architecture`, `react-best-practices`, `react-testing-library`, `next-best-practices`
Do:       Extend the existing `smartDiff` message block with the role descriptions, the
          `Smart order` / `Original order` labels, the findings-badge label and the split
          banner's rows. `SmartDiffViewer` takes `groups`, `splitSuggestion`, the
          `PrFile[]` from `usePullDetail` (the patches) and the latest review's findings;
          it renders the header row, the split banner, sticky group headers and the
          `FileCard`s, owning `focus: {path, line, token}`. Boilerplate cards get
          `defaultOpen={false}` unconditionally — that is the lock-file criterion, and it
          must not be left to the 200-line heuristic. `helpers.ts` joins groups to
          `PrFile[]` by path and **appends any unmatched file to `core`**, so a race with
          the detail refresh can never hide a changed file. `DiffTab` calls `useSmartDiff` and
          renders `SmartDiffViewer` when groups exist, else today's flat `DiffViewer`.
          Inline commenting keeps working in both.
          `page.tsx` gains two lines: it passes the latest review's findings into
          `DiffTab` (today it passes only `prId/filesCount/files/canComment`,
          `page.tsx:169-176`, while `usePrReviews` is already loaded at `page.tsx:41`),
          and it adds `["smart-diff", prId]` to the `onRunDone` refresh at
          `page.tsx:161-165`.
          Two things about the demo path that must NOT be "fixed" on the way past:
          `PrDetailHeader`'s `onRunStart` switches the user to the Findings tab
          (`page.tsx:137`), so running a review from the Files tab jumps away and the
          reviewer comes back — that is why the client-side overlay in (a) above is what
          makes the badges appear, not a query invalidation; and `DiffTab` is unmounted
          while another tab is active (`{tab === "diff" && …}`), so `SmartDiffViewer` must
          not keep anything in local state it needs across a tab switch.
          `DiffTab`'s `SectionLabel` keeps reading "Files changed · N files" rather than
          the design's "Reviewer-ordered diff": the tab's own name is "Files changed" and
          the count is live information the design's static label does not carry.
Verify:   `cd client && pnpm test && pnpm typecheck`
Depends:  Steps 5, 6

### Step 8 — the browser flow   ·   package: e2e
Files:    `e2e/specs/09-pr-smart-diff.flow.json` (new)
Skills:   none (flows are data — `e2e/docs/flow-authoring.md`)
Do:       Model it on `05-pr-diff.flow.json`: root → PR list → PR #482 → Files changed →
          wait for the "Core logic" group header, for `src/middleware/ratelimit.ts`, and
          for `package-lock.json`. Seeded data only, no model call.
Verify:   `cd e2e && pnpm e2e:hermetic`
Depends:  Steps 3, 7

### Step 9 — close the spec   ·   package: —
Files:    `specs/L03-smart-diff.md` (edit) · `specs/README.md` (edit)
Skills:   `engineering-insights`, `pr-self-review`
Do:       Flip Status to `done`, tick the criteria against evidence, update the L03 row in
          the spec index (it currently reads "Smart Diff not yet specced"), run
          `/engineering-insights`, then `/pr-self-review` before `gh pr create`
          (a PreToolUse hook blocks the PR until it passes). The PR body states what was
          implemented and which checks were run — that is an acceptance criterion of the
          assignment, not a formality. Finally, draft three short takeaways for the
          homework notes (the assignment's last item); they are the author's to edit, so
          they are a draft handed over, not a repo file.
Verify:   `/pr-self-review` returns no CRITICAL
Depends:  Steps 1–8

## Commits

Derived from `git log`, not from a general convention — this repository has a specific
habit and a session that guesses will produce a history that reads differently from the
rest. Branch: `lesson-03` (already checked out; nothing here targets `main`).

**A commit boundary is a behaviour that ends green, not a step.** `7acbcd3` committed the
L03 spec alone; `71941c5` then committed constants + helpers + repository + routes +
service + `container.ts` + `modules/index.ts` + `rows.ts` + 40 unit tests as **one**
commit, because that is where the server first did something. Steps are for ordering the
work; commits are for a reviewer reading it afterwards.

| # | Message | Contents | Green when |
|---|---|---|---|
| C1 | `docs(specs): plan L03 Smart Diff before writing any of it` | `specs/L03-smart-diff.md` · `specs/README.md` (L03 row → link the spec) | — (documentation only) |
| C2 | `feat(smart-diff): classify a PR's files and serve them in review order` | Steps 1–2 · the whole module · `rows.ts` · `modules/index.ts` · `server/README.md` API map · `smart-diff-helpers.test.ts` | `pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| C3 | `feat(smart-diff): give the demo PR the nine files the design shows` | Steps 3–4 · `seed.ts` · `smart-diff.it.test.ts` | `pnpm db:seed` twice, then `pnpm exec vitest run .it.test` |
| C4 | `feat(smart-diff): the reviewer-ordered diff, its badges and the jump to the line` | Steps 5–8 · hook · `diff-viewer` props · `SmartDiffViewer` · `DiffTab` · `page.tsx` · messages · component test · `09-pr-smart-diff.flow.json` | `cd client && pnpm test && pnpm typecheck`, then `cd e2e && pnpm e2e:hermetic` |
| C5 | `docs(smart-diff): close the spec, and record what it taught` | Step 9 · Status → `done` · ticked criteria · `specs/README.md` · `INSIGHTS.md` appends | `/pr-self-review` returns no CRITICAL |

Why these four boundaries and not nine:

- **C1 is committed before Step 1 begins**, alone, with the `specs/README.md` row in the
  same commit — exactly `7acbcd3 docs(specs): plan the L03 Intent layer before writing any
  of it` (2 files, 723 insertions). It is what lets a later session start from `git log`
  instead of from this conversation.
- **C2 merges Steps 1 and 2** because helpers with no route are a library nobody calls.
  `71941c5` is the precedent, down to the file list.
- **C3 merges Steps 3 and 4** because the integration test asserts the seeded nine files:
  seed alone leaves a commit whose only proof is a screenshot, and the test alone does not
  pass. `47ff38b` likewise carried `seed.ts` together with the migration and the tests
  that needed it.
- **C4 merges Steps 5–8** because Step 6 adds *optional props with no consumer* — a commit
  a reviewer cannot judge, since nothing shows whether the props are the right ones. The
  e2e flow rides along rather than trailing behind, as `614cf93` did with
  `08-skills.flow.json`; it can only pass once C3's seed and C4's UI both exist.
- **C5 is the closing commit**, mirroring `322ab6e docs(specs): close L03 Round 2 against
  evidence, and record what it taught` (spec + `specs/README.md` + three `INSIGHTS.md`).

Message style, from the same history — this is not generic Conventional Commits:

- Subject is `type(scope): ` plus **prose**, often two clauses joined by "and", naming what
  changed for a person: "log what the prompt was made of, and what it cost". Not
  "add smart diff endpoint". Scope for this work is `smart-diff`; `docs(specs)` for C1.
- Body opens by locating the commit in the plan — `71941c5` starts "Steps 5-7 of
  `specs/L03-intent-layer.md`" — then explains **why**, including the traps found while
  writing it. These bodies run long on purpose; a one-line body here is off-convention.
- Trailers stay: `Co-Authored-By` and `Claude-Session`.

The PR is opened after C5, and `/pr-self-review` must pass first — a PreToolUse hook blocks
`gh pr create` until it does (`DEVDIGEST_SKIP_PR_REVIEW=1` is the emergency door).

## Handoff

Plan file:      `specs/L03-smart-diff.md`
Entry point:    commit C1 (this file), then Step 1
Verification:   `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm exec vitest run .it.test`
                `cd client && pnpm test && pnpm typecheck`
                `cd e2e && pnpm e2e:hermetic`
Deviation policy: stop at the step, report the divergence, finish the independent steps.
                  Do not re-plan.
