# L03 — Intent layer

Status: draft
Owner: —
Packages touched: server, client, reviewer-core, e2e

## Goal

Before a review runs, DevDigest derives what the PR is *trying to do* — from the PR's own
documentation when it has any, and from indirect signals when it does not — persists that
derivation with an honest confidence tier, shows it on the PR's Overview tab, and feeds it to
every reviewing agent as a prompt section. A reviewer that today sees only a diff and a body
now also sees the claimed intent, the claimed scope, and how much that claim is worth.

## Context

The first half of the L03 row in [`README.md`](README.md). Smart Diff is the other half and is
out of scope here.

This is the fourth lesson in a row where most of the feature is already in the tree, unwired —
the pattern recorded in the root `INSIGHTS.md` (2026-08-02, *"A feature cut from the starter
leaves its scaffold behind — grep before building"*). Verified state before this spec:

| Piece | Where | State |
|---|---|---|
| `pr_intent` table | `server/src/db/schema/reviews.ts:48-56` | 3 columns, zero rows, zero writers |
| `upsertIntent` / `getIntent` | `server/src/modules/reviews/repository/pull.repo.ts:49,64` → `repository.ts:130,134` | implemented, **zero callers** |
| `Intent` contract | `server/src/vendor/shared/contracts/brief.ts:9-14` | used only by `PrBrief` (L05) and the dead repo methods |
| `PrIntentRecord` | `contracts/review-api.ts:60` | declared, no route serves it |
| `review_intent` feature-model id | `contracts/platform.ts:15-21`, registry row `52-58` | in the enum, in `FEATURE_MODELS`, **rendered in Settings**, zero code behind it |
| `INJECTION_GUARD` names "derived intent/scope" | `reviewer-core/src/prompt.ts:16-28` | written for this feature |
| `resolveLinkedIssue()` + `getIssue()` | `server/src/adapters/github/octokit.ts:127-136`, `:351` | `PrDetail.linked_issue` is fetched, returned on the online path, and persisted nowhere (`modules/pulls/routes.ts:286` returns it, `:291-318` — the offline path — omits it entirely) |
| `RunLogger` fan-out for pre-work | `server/src/platform/run-logger.ts:7,16` | doc comments already say "derive intent" |
| Design of record | `reference/devdigest-design/src/features/pull-requests/pr-detail.jsx:3-18,70-74` | `IntentBlock` inside a `Card` with `SectionLabel icon="Target"` |
| `ConfidenceNum`, `Badge`, `Chip`, `EmptyState` | `client/src/vendor/ui/primitives/` | ready |
| `brief.json` copy (`block.intent`, `unavailable`, `unavailableHint`) | `client/messages/en/brief.json` | L05's PR-Brief namespace — **not** reused here (see Decisions) |

Read alongside: `reviewer-core/docs/prompt-contract.md` (the slot checklist this feature must
satisfy), `.claude/skills/onion-architecture/SKILL.md` (ring map), and
`specs/L02-conventions-extractor.md`, which is the reference implementation of a single cheap
structured LLM call and the model this module is built from.

## In scope

- **Contracts** (both `vendor/shared` copies): the intent taxonomy, confidence tier, source
  and evidence shapes; a widened `PrIntentRecord`; an `intent` slot on `PromptAssembly`.
- **Schema**: extend `pr_intent` (never drop it) with kind, confidence + tier, sources,
  evidence, provider/model, token/cost/duration attribution, `head_sha`, `generated_at`; one
  migration.
- **`server/src/modules/intent/`** — a new module mirroring `modules/conventions/`:
  `constants.ts` · `helpers.ts` (pure) · `repository.ts` · `service.ts` · `routes.ts`.
- **Source resolution in code**, in descending evidence strength: (a) a repo-relative
  plan/spec path named in the body, read through `container.git.readFile`; (b) a linked GitHub
  issue via `GitHubClient.getIssue`; (c) the PR body; (d) the title; (e) commit messages +
  branch name; (f) changed file paths — **from the `UnifiedDiff` the caller already holds on
  the review path, and from `pr_files` only on the standalone `POST` path where no diff is in
  hand** (see D11).
- **A deterministic confidence ladder** over which sources were present. The model may lower
  the tier, never raise it.
- **The cheap model**: `container.featureModelOverride(ws, 'review_intent')` + a module-local
  `DEFAULT_INTENT_MODEL`; the registry row is corrected in all three places that carry it.
- **API**: `GET /pulls/:id/intent` (404 when never derived), `POST /pulls/:id/intent`
  (derive/re-derive, rate-limited).
- **Review path**: derived once per run batch in `ReviewRunExecutor.executeRuns` pre-work,
  through a brokered `container.intent`; cached on `head_sha`; failure degrades, never fails
  the run; logged into every consuming run's Live Log.
- **`reviewer-core`**: an `intent?: string` slot on `PromptParts` / `ReviewInput`, rendered as
  `## PR intent (derived)` between `## PR description` and `## Skills / rules`.
- **UI**: an Intent card at the top of the PR Overview tab (the design's `IntentBlock` +
  `ConfidenceNum` + source chips +
  Re-derive + empty state); a new prompt block in the Run Trace drawer.
- **Seed + e2e**: one seeded intent for demo PR #482 so the card is reviewable without
  spending a model call, and the flow that asserts it.

## Out of scope

- **Smart Diff** — the other half of L03. Separate spec, separate pass.
- **Scope conformance as a finding kind.** The reviewer receives the intent and may cite it in
  a rationale; there is no new gate, no new severity, no "this PR does more than it claims"
  check. That is a product decision, not an omission.
- **PR Brief / Risks / Blast radius / PR history** — L05. `brief.json`'s existing copy and the
  design's 2-up `BriefCard` grid stay untouched.
- **Jira / Linear / any non-GitHub ticket source.** No adapter exists; GitHub issues only.
- **Fetching arbitrary URLs found in the PR body.** Never, in any lesson. See Constraints.
- **Multi-agent** (L07) and **re-deriving intent on every GitHub poll.** Derivation happens on
  an explicit `POST` or as review pre-work, and only when `head_sha` moved.
- **Reading a plan file that the PR itself adds.** The clone is checked out at the repo's
  branch, not at the PR head (`server/src/adapters/git/simple-git.ts:129-131` reads the
  working tree). A spec file introduced *by this PR* is invisible to source (a) and the ladder
  degrades to (c)–(f), correctly. Reconstructing it from `pr_files.patch` is a later idea.
- **Widening the adapter's own `resolveLinkedIssue`** — see Decisions.
- **Reconciling the pre-existing `vendor/shared` drift** in `adapters.ts`,
  `contracts/eval-ci.ts` and `contracts/productionize.ts`. Found while verifying Step 1:
  the copies are not byte-identical today, so a whole-tree `diff -r` can never be this
  lesson's gate. `contracts/trace.ts` had drifted too (comment-only — lesson tags stripped
  on the client side) and IS reconciled, because this lesson edits that file anyway and an
  unverifiable diff on a file we are changing is worth less than three lines of comment.
- **Putting raw source text into the prompt slot** — see D10. The slot distils; it never
  pastes.
- **Deleting or repurposing `prBrief`, `Intent`'s use inside `PrBrief`,** or any other L05
  scaffold.

## Decisions

**D1 — `Intent` stays; `PrIntentRecord` grows.** `Intent` (`contracts/brief.ts:9`) is a member
of `PrBrief` (`:116-121`), which is L05's composed document. Widening it would change a
contract this lesson does not own. All new fields land on `PrIntentRecord`
(`contracts/review-api.ts:60`), which is the persisted/transport shape and has no other
consumer.

**D2 — one owner for the `pr_intent` table.** `ReviewRepository.upsertIntent` / `getIntent`
(`repository.ts:130-136`) have zero callers anywhere. They are **deleted** in this pass rather
than left beside the new module's repository: two repositories writing one table with two
different column sets is the drift trap, not a convenience. The class doc comment at
`repository.ts:6-14` ("Owns `reviews`, `findings`, `pr_intent`") is corrected in the same edit.

**D3 — the linked-issue regex lives in the intent module, and the adapter is not touched.**
The task brief asked for `octokit.ts:127`'s regex to be widened. It is not, for two reasons
that are checkable:
  1. *Layering.* The named constant belongs in `modules/intent/constants.ts` (ring 2,
     Application). `src/adapters/**` is ring 3 and may import rings 0–1 only
     (`.claude/skills/onion-architecture/SKILL.md` § Ring map). Importing it into the adapter
     would put the constant in two places or invert a ring; `arch:check` would not catch
     either, which makes it worse, not better.
  2. *It buys nothing.* `PrDetail.linked_issue` is persisted nowhere and read by no client
     code (`grep -rn "linked_issue" server/src client/src` → contract declarations, the
     adapter, and `mocks.ts:183` only). The intent module resolves the issue itself from the
     persisted `pull_requests.body`, which is also the only source available on the offline
     path where `PrDetail` has no `linked_issue` at all.
  So: one named regex, one place, `modules/intent/constants.ts`, unit-tested. The adapter's
  narrow private regex keeps feeding `PrDetail` exactly as it does today.

**D4 — the closing keyword is required.** The adapter's existing pattern makes the keyword
optional (`/(?:closes|fixes|resolves)?\s*#(\d+)/i`), so a bare "see #5" anywhere in the body
resolves as a linked issue. For source (b) — the strongest evidence tier alongside a plan file
— a GitHub closing keyword is **mandatory**: `close|closes|closed|fix|fixes|fixed|resolve|
resolves|resolved`, case-insensitive. Accepted forms: `#123`, `owner/repo#123`, and
`https://github.com/owner/repo/issues/123`. A cross-repo reference whose `owner/repo` is not
this repo is **discarded**, not fetched — `getIssue(repo, n)` takes this repo's ref, so
honouring it would fetch the wrong issue under the right number.

**D5 — confidence is computed in code.** Ladder over which sources were actually used:

| Sources present | Tier |
|---|---|
| (a) plan/spec file **or** (b) linked issue | `high` |
| substantive (c) body only | `medium` |
| only (d) title / (e) commits + branch / (f) file paths | `low` |

"Substantive" is a code test, not a judgement: after stripping HTML comments and an unticked
PR-template checklist, the body must exceed `MIN_SUBSTANTIVE_BODY_CHARS` (start at 200,
documented in the constant). The model returns a `suggested_tier`; the persisted tier is
`min(codeTier, suggestedTier)` over the ordered ladder — the model can say "this body is
boilerplate" and drop `medium` to `low`, and can never argue its way up. The numeric
`confidence` is `TIER_SCORE[finalTier]` — `high` 0.9 / `medium` 0.7 / `low` 0.4, chosen in
D12 to land inside `ConfidenceNum`'s own colour bands — so the number and the tier can
never disagree and no conditional in our code decides the colour.

**D6 — cost is attributed to the PR, not to a run.** The intent call is a PR-level artifact
shared by every agent in a batch. Writing it to `agent_runs` would either multiply-count it
across agents or create agent-less rows in the run history. Its `tokens_in` / `tokens_out` /
`cost_usd` / `duration_ms` / `provider` / `model` live on the `pr_intent` row, render on the
Intent card, and are named in the Live Log of every run that consumed it. The consequence is
stated in Risks.

**D7 — copy goes to `prReview.json`, not `brief.json`.** `client/messages/en/brief.json`
already carries `block.intent`, `unavailable` and `unavailableHint`. That namespace is L05's
PR Brief — a different surface with a different empty state. New keys land under
`prReview.intent.*`, beside the rest of the PR-detail copy. `brief.json` is left untouched.

**D8 — the UI extends the design, and says where.**

*Design lookup (`design-reference` § "Before editing any file, state").* Screen key
`pull-request-detail`; artboards `pr-overview` · `pr-runs` · `pr-files` · `pr-compose`; files
read: `docs/design-manifest.json`, `BRIDGE.md`, `src/features/pull-requests/pr-detail.jsx`,
`src/data/core-mock-data.jsx`, `src/foundation/primitives.jsx`.

`IntentBlock` (`pr-detail.jsx:3-18`) renders the quoted intent line and the 2-column
IN SCOPE (`var(--ok)`, `Icon.Check`) / OUT OF SCOPE (`var(--text-muted)`, `Icon.X`) grid, and
nothing else — its fixture (`core-mock-data.jsx:28-40`) has no confidence, no sources, no
kind, no empty state. Four things the card adds, each sanctioned rather than invented:

- **A confidence reading — rendered with the design's own primitive, not a new one.** See D12.
- **A source-chip row.** `Badge`, never `Chip`: the ported `Chip` renders a `<button>`, and N
  unlabelled buttons in one card is the `getByRole('button')` trap (client `INSIGHTS.md`
  2026-08-06).
- **A Re-derive action** — `Button kind="ghost" size="sm"`, the shape `PRHeader` uses
  (`pr-detail.jsx:128`).
- **An empty state.** Explicitly allowed: `BRIDGE.md` § Component map — "`@devdigest/ui` has
  extras the design does not show: `Skeleton`, `ErrorState`, … Use them for loading/error/empty
  states the prototype leaves implicit."

*Placement — corrected against the design.* The design's Overview tab is **only** the PR Brief:
`OverviewTab` (`pr-detail.jsx:135-140`) is one section, `SectionLabel icon="FileText"`
→ "PR Brief" → `BriefCard`. **The design has no Description section anywhere** — the `PR`
fixture (`core-mock-data.jsx:5-17`) has no `body` field and `PRHeader` (`:113-133`) never
renders one. Production's `OverviewTab` renders `Description` and the design does not; that is
a pre-existing production addition, not something this lesson introduces or removes. So the
Intent card goes **first on the Overview tab, above Description** — in the design the brief is
the whole tab, and demoting it below a section the design never had would inverte the
hierarchy the design is the authority on.

*Built to be absorbed, and the plan says so.* In the design the Intent block is the top half of
a `Card` that continues, below a 1px divider, into `SectionLabel icon="AlertTriangle"`
→ "Risk areas" (`pr-detail.jsx:69-74`) — the left column of `BriefCard`'s 2-up grid, with
Blast radius on the right. That whole composition is L05. Therefore `IntentCard` renders
**`Card` + `SectionLabel icon="Target"` + the block, and owns no page-level section wrapper**,
so L05 drops it into the grid's left column and appends the divider + Risk areas beneath it
without touching it. L05 must extend this component, not build a second Intent block from
`brief.json` — `brief.block.intent` already carries the same word, and two Intent cards on one
screen is the failure this note exists to prevent.

**D9 — the engine receives rendered strings — TWO of them.** `ReviewInput.intent?: string`
carries the distilled intent and scope lists, exactly like `callers` and `repoMap`; the
server composes it and `reviewer-core` resolves nothing (the purity law,
`reviewer-core/CLAUDE.md` § Conventions, and `docs/prompt-contract.md` § "Adding a slot"
item 7).

*Corrected during implementation.* This decision originally said ONE string containing the
tier line as well, which cannot coexist with Step 4's requirement that the tier line sit
OUTSIDE `wrapUntrusted`: once the caller concatenates them the engine has no way to tell
the trusted half from the untrusted one. So the slot is two fields —
`intent` (untrusted, wrapped, capped) and `intentNote` (one trusted line, rendered above
the delimiter, ignored when `intent` is empty). One section, two trust levels, which is
why `docs/prompt-contract.md` now says so explicitly.

**D10 — the prompt slot carries a DISTILLATION, never raw source text.** The PR body is
*already* in the prompt as `## PR description` (`prompt.ts:106-108`). So for a body-only PR the
intent slot adds no information the reviewer did not have — it distils it, and the distillation
is the point. The genuinely new information is sources (a) and (b), which the reviewer has
never seen in any form. The slot therefore contains exactly: the confidence sentence, the
one-line intent, the in-scope list, the out-of-scope list. It never contains the body, the
linked issue's body, or a plan file's text. `MAX_INTENT_CHARS` (Step 4) is what enforces this
mechanically, but the rule is the decision, not the number. Getting this wrong is the obvious
"helpful" implementation — paste the issue body in so the model can see it — and it doubles the
prompt of every review on every PR that has a linked issue, for content the model has already
been told the conclusion of.

**D11 — source (f) comes from the diff on the review path, from `pr_files` only on the POST
path.** `loadDiff` (`modules/reviews/diff-loader.ts:19-29`) *prefers* a real
`git diff base...head` and reconstructs from `pr_files` only when that fails or returns no
files. So `pr_files` can legitimately be empty for a PR whose diff loaded perfectly, and (f) is
the one source the ladder relies on being available for every PR. `IntentApi.forReview`
therefore takes the changed paths from its caller — Step 8 is holding the `UnifiedDiff` when it
calls — and the service falls back to `pr_files` only in `derive()`, the standalone path behind
`POST /pulls/:id/intent`, where no diff is in hand.

**D12 — confidence uses `ConfidenceNum`, and `TIER_SCORE` is chosen to fit its colour bands.**
The design already has one idiom for confidence: `ConfidenceNum({ value })`
(`primitives.jsx:126-134`, ported verbatim at
`client/src/vendor/ui/primitives/ConfidenceNum.tsx`) renders `NN% conf` with a dot coloured
`>= 85` `var(--ok)`, `>= 65` `var(--warn)`, else `var(--text-muted)`. It is what findings
(`findings.jsx:67`, `agent-runs.jsx:52`) and memory items (`memory.jsx:18`) already use.
Inventing a second confidence visual on the same screen would fracture that.

So the card uses `ConfidenceNum` and **no additional `Badge` for confidence**, and `TIER_SCORE`
is picked so each tier lands in the primitive's own band without any conditional in our code:

| Tier | `TIER_SCORE` | What `ConfidenceNum` renders |
|---|---|---|
| `high` | `0.9` | `90% conf`, `var(--ok)` |
| `medium` | `0.7` | `70% conf`, `var(--warn)` |
| `low` | `0.4` | `40% conf`, `var(--text-muted)` |

**The one inaccuracy this buys, recorded rather than hidden:** the primitive hardcodes
`title="Model confidence"`, and ours is precisely *not* model-reported — it is the code-computed
evidence ladder of D5, which the model may only lower. `client/src/vendor/ui/**` is
do-not-touch, so the tooltip cannot be corrected here. The source-chip row is what carries the
honesty: it names the evidence the number was computed from. This is an insight candidate for
the wrap-up, not a licence to edit the vendored primitive.

## Acceptance criteria

- [ ] A PR whose body names an existing repo-relative `.md` path gets that file's content into
      the derivation and a `high` tier, with `plan_file` in `sources` and the path in `evidence`.
- [ ] A PR whose body says `Closes #471` and nothing else substantive gets `high`, with
      `linked_issue` in `sources`, resolved through `GitHubClient.getIssue`.
- [ ] A PR with **no** body, no linked issue and no plan file still produces an intent, from
      title + commits + branch + changed paths, and is persisted with tier `low`. It is not an
      error and not an empty card.
- [ ] A PR with **zero `pr_files` rows** but a non-empty diff still yields file-path evidence
      on the review path (D11).
- [ ] The model cannot raise the tier: given a fixture whose `suggested_tier` is `high` over a
      body-only PR, the persisted tier is `medium`.
- [ ] The rendered prompt slot contains no substring of the PR body, the linked issue body, or
      a plan file beyond a short quoted evidence span (D10).
- [ ] `GET /pulls/:id/intent` returns `PrIntentRecord` for a derived PR and **404** for one
      that was never derived.
- [ ] `POST /pulls/:id/intent` re-derives and overwrites the row, and is rate-limited to the
      same budget as `POST /pulls/:id/review` (`reviews/routes.ts:29`).
- [ ] A review run reuses the persisted intent when `pr_intent.head_sha === pull.head_sha` and
      makes **zero** LLM calls for intent; the Live Log says it was a cache hit.
- [ ] A review run whose intent derivation throws still completes every agent run
      successfully, with the failure reason in the Live Log and no `## PR intent` section in
      the prompt — the same degradation `buildCallersDigest` / `buildRepoMapDigest` perform
      (`run-executor.ts:396-402`).
- [ ] **Regression:** with `intent` absent/undefined, `assemblePrompt` produces a prompt
      byte-identical to today's, and `PromptAssembly.intent` is null. Pinned by a literal in
      `reviewer-core/test/prompt.test.ts`, the shape used at `:86-103`.
- [ ] With `intent` present, the section sits after `## PR description` and before
      `## Skills / rules`, the model-written text is inside `wrapUntrusted('intent', …)`, and
      the confidence sentence is outside it.
- [ ] Every `vendor/shared` file this lesson touches is byte-identical across the two
      copies. **Not** the whole tree: `adapters.ts`, `contracts/eval-ci.ts` and
      `contracts/productionize.ts` already differ, and reconciling them is out of scope.
- [ ] The Settings row `PR Review · Intent` advertises the model the module actually uses.
- [ ] The Intent card renders intent, scope lists, a `ConfidenceNum` reading and source
      chips; it sits above the Description section and owns no page-level section wrapper; an
      un-derived PR renders the empty state with a Derive action and no card body.
- [ ] The Run Trace drawer shows an `Intent (dynamic)` prompt block for a run that had one,
      and no block for a run that did not.
- [ ] `pnpm arch:check` **output** is empty for `server/` (read the output, never the exit
      code — root `INSIGHTS.md` 2026-08-22 and 2026-08-06).

## Test plan

| Suite | Covers |
|---|---|
| `server/test/intent-helpers.test.ts` (unit) | the plan-path extractor incl. traversal rejection, the closing-keyword regex incl. the cross-repo discard, the substantive-body test, the confidence ladder, `min(codeTier, suggestedTier)`, the source list, and that `renderIntentForPrompt` emits no raw source text (D10) |
| `reviewer-core/test/prompt.test.ts` (unit, npm) | the omitted-slot byte-identical invariant; section order; the tier line outside the wrap |
| `server/test/intent.it.test.ts` (**Docker**) | derive → persist → `GET` reads back → second run on unchanged `head_sha` is a cache hit (assert `MockLLMProvider.calls` did not grow) → `head_sha` moves → re-derived. Degraded path (empty body, no issue) yields `low`. A PR with zero `pr_files` rows and a non-empty diff still gets file-path evidence (D11). A throwing git/LLM leaves every agent run `done`. Built on the `conventions.it.test.ts` shape (`test/helpers/pg.ts`, `buildApp`, `seed`, `MockLLMProvider` + `MockGitClient` + `MockGitHubClient` from `src/adapters/mocks.ts`; per-call fixtures via `structuredBySchema`, `mocks.ts:53`) |
| `client/…/IntentCard/IntentCard.test.tsx` | populated card, the `low` tier rendering `40% conf` via `ConfidenceNum`, source chips, empty state, Re-derive click. `fireEvent`, not `userEvent` — the package does not ship it (client `INSIGHTS.md` 2026-08-22) |
| `client/…/RunTraceDrawer/RunTraceDrawer.test.tsx` | the intent block appears with `prompt_assembly.intent`, absent without |
| `e2e/specs/02-repo-pulls-detail.flow.json` | one `wait --text` on the seeded intent line, after the PR-detail settle step |

## Risks

- **The PR-list COST column excludes intent cost.** By D6, intent tokens live on `pr_intent`
  and the column sums `agent_runs` only (`modules/pulls/routes.ts:165-184`). "What has
  reviewing this PR cost so far" is now an under-report by one cheap call per head SHA. Noticed
  by comparing the card's cost line with the column; accepted deliberately, because the
  alternatives are worse (see D6). Revisit if L05 adds more PR-level artifacts.
- **OpenRouter's structured-output support is per-endpoint and provider-dependent** — the
  default `DEFAULT_INTENT_MODEL` routes through it, so a schema guarantee that holds today can
  weaken when the upstream endpoint behind a model changes, with no signal on our side beyond a
  reprompt or a parse failure. The two first-party alternatives named in the constant's doc
  comment (`claude-haiku-4-5`, `gpt-5-mini`) enforce the schema at the API contract instead.
  That is what makes the `PR Review · Intent` Settings row load-bearing for this feature
  specifically rather than a nicety: it is the switch from "usually structured" to
  "contractually structured", and a workspace that needs the latter can take it without a code
  change.
- **`git.readFile` joins an author-controlled string into a filesystem path**
  (`adapters/git/simple-git.ts:129-131`). A body containing `../../../.ssh/id_rsa` would
  escape the clone. Mitigated by the path allow-list in Constraints; the unit test asserts
  every traversal form is rejected *before* the port is called.
- **`OpenRouterProvider` ignores `req.timeoutMs`** (root `INSIGHTS.md` 2026-08-06): the real
  ceiling is the 90 s fixed at construction. `POST /pulls/:id/intent` is synchronous, so a slow
  model shows as a long-held request. Same trade the conventions extractor documented; do not
  "fix" it by adding a per-request timeout that the default provider does not read.
- **`ADD COLUMN … NOT NULL` with no default fails on a populated table** (server
  `INSIGHTS.md` 2026-08-06). `pr_intent` is provably empty today (zero writers), so the
  migration is safe — but Step 3 verifies `select count(*) from pr_intent` on the target
  database rather than trusting this sentence.
- **A seeded intent is another `seed.ts` literal an e2e flow can assert.** Root `CLAUDE.md`
  Gotchas; Step 12 carries the grep obligation explicitly.
- **`waitForPrRuns` returns instead of throwing on timeout** (server `INSIGHTS.md` 2026-08-07):
  a failing intent `.it.test` assertion may be full-lane timing, not logic. Re-run the file
  alone before debugging.

## Open questions

- **Non-blocking — `MIN_SUBSTANTIVE_BODY_CHARS = 200`** is a starting value with no evidence
  behind it. The first live derivations against real PRs will say whether it is right; the
  constant's doc comment must invite that revision rather than present the number as settled.
- **Blocking — none.**

## Constraints in force

| Constraint | Source | What it forbids here |
|---|---|---|
| **No outbound fetch of an author-controlled URL.** Only the GitHub API and the local clone are sources | this spec § Out of scope; `reviewer-core/src/prompt.ts:16-28` (the PR body is a prime injection vector) | resolving `https://…` links found in a PR body, in any form, for any source tier — SSRF plus an injection vector with no upside |
| **Every path handed to `container.git.readFile` is validated first**: repo-relative, no leading `/`, no `..` segment, no `~`, no scheme, ends in an allow-listed doc extension, capped in count and in chars per file | `server/src/adapters/git/simple-git.ts:129-131` (`join(clonePath, path)`) | reading anything outside the clone; letting a PR body decide how many files the prompt pays for |
| SQL only in `repository.ts`, HTTP only in `routes.ts`, pure transforms in `helpers.ts`, literals in `constants.ts` | `server/CLAUDE.md` § Conventions; `.claude/skills/onion-architecture/SKILL.md` § Ring map | a query in the service, a `req`/`reply` below `routes.ts`, a regex literal inline in the service |
| A service takes its dependencies from `container`, never by importing a sibling module or a concrete adapter | `server/CLAUDE.md`; `.dependency-cruiser-onion.cjs` rules `no-concrete-adapter-in-app-layer` (error) and `no-cross-module-import` (**warn**) | `modules/reviews/` importing `modules/intent/`; `modules/intent/` importing `modules/settings/feature-models.ts` — both go through `container` |
| `arch:check` is judged by its **output**, not its exit code | root `INSIGHTS.md` 2026-08-22 + 2026-08-06; `.dependency-cruiser-onion.cjs:101` | a `Verify:` line that reads the exit status of `pnpm arch:check` and calls a new cross-module import clean |
| A `ContainerOverrides` field must be typed as a `Pick<>` verb set, never as the service class | server `INSIGHTS.md` 2026-08-06 | `intent?: IntentService` — a private field makes it satisfiable only by the real class, which is not an override |
| `resolveFeatureModel` is **not** used by a module being written now; use `container.featureModelOverride()` + a module-local constant | root `INSIGHTS.md` 2026-08-06; `modules/settings/feature-models.ts:30-35` | silently buying the registry's default on every review |
| `reviewer-core` is zero-I/O; its only side effect is the injected `LLMProvider` | root `CLAUDE.md`; `reviewer-core/CLAUDE.md` § Purity law; `.dependency-cruiser-onion.cjs` `core-stays-pure` | resolving the intent inside the engine; adding an import to reach the DB or the clone |
| An empty prompt slot must yield a **byte-identical** prompt, and section order is contract | `reviewer-core/CLAUDE.md`; `reviewer-core/docs/prompt-contract.md` § Rules 1–2 | emitting an empty `## PR intent` heading; moving any existing section |
| All external text goes through `wrapUntrusted()`; hardening lives only in `INJECTION_GUARD` | `reviewer-core/CLAUDE.md`; `docs/prompt-contract.md` § Rules 3–5 | keyword-scanning the derived intent; a second guard sentence in the new section |
| Every new slot has a cap | `docs/prompt-contract.md` § Rule 6; D10 | an intent block that grows with body/issue/plan-file size, or that pastes their raw text |
| A contract lives in `@devdigest/shared` and doubles as request validation and response schema; the two `vendor/shared` trees are hand-synced copies | root `CLAUDE.md` § Conventions + Gotchas; `scripts/pr-self-review-checks.sh:115-129` | `.parse(req.body)` in a handler; editing one copy and not the other |
| After editing an enum or object in `vendor/shared`, grep the **other contract files for its member names** | root `CLAUDE.md` § Gotchas | assuming an import search finds every re-declared shape |
| Every route starts with `getContext(container, req)` and every query is workspace-scoped | `server/CLAUDE.md` § Conventions | an intent route that reads a PR id without proving the workspace owns it |
| A DB-touching test is `*.it.test.ts` | root `CLAUDE.md`; `TESTING.md` § Conventions | putting the derive→persist→cache test in the unit lane |
| `src/db/migrations/**` is generated only by `pnpm db:generate`; migrations never run on boot | root + `server/CLAUDE.md` § Do not touch | hand-writing the SQL; assuming the column exists after a pull |
| `client/src/vendor/ui/**` is do-not-touch | root + `client/CLAUDE.md` | adding a confidence-badge primitive instead of composing existing ones |
| No `fetch` inside a component; a new endpoint means a new hook in `src/lib/hooks/` exported through `hooks/index.ts` | `client/CLAUDE.md` § Conventions | calling `/pulls/:id/intent` from `IntentCard.tsx` |
| No hardcoded copy in components | `client/CLAUDE.md` § Map (`messages/<locale>/`) | English strings inline in the card |
| After editing `server/src/db/seed.ts`, grep `e2e/specs/*.json` for the changed literals | root `CLAUDE.md` § Gotchas; root `INSIGHTS.md` 2026-08-02 | a seed edit that silently breaks a flow in another package |
| A seed addition guarded on its own absence upgrades in place; one guarded by `if (!pr)` needs a fresh volume | server `INSIGHTS.md` 2026-08-02 | attaching the seeded intent inside the `if (!pr)` block, where an existing dev DB never sees it |
| `defaultNow()` is the transaction's timestamp | root `CLAUDE.md` § Gotchas | ordering anything by `generated_at` without a tie-break |
| Every repo file is written in English | root `CLAUDE.md` § Conventions | non-English comments, copy, or spec prose |

## Implementation plan

### Step 1 — Contracts, in both `vendor/shared` copies · package: server + client
Files:  `server/src/vendor/shared/contracts/brief.ts` (edit) ·
        `server/src/vendor/shared/contracts/review-api.ts` (edit) ·
        `server/src/vendor/shared/contracts/trace.ts` (edit) ·
        the three identical mirrors under `client/src/vendor/shared/contracts/` (edit)
Skills: zod, onion-architecture, typescript-expert
Do:     In `brief.ts`, **below** the untouched `Intent`, add `IntentKind`
        (`feature|fix|refactor|perf|docs|test|chore|deps|revert|mixed`),
        `IntentConfidenceTier` (`high|medium|low`), `IntentSource`
        (`plan_file|linked_issue|pr_body|pr_title|commits|branch|file_paths`) and
        `IntentEvidence` (`{ source, ref, quote }`). In `review-api.ts`, widen
        `PrIntentRecord` with `kind`, `confidence`, `confidence_tier`, `sources`, `evidence`,
        `provider`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms`, `head_sha`,
        `generated_at` — nullish where a historical row could lack the key, following
        `RunStats.cost_usd`'s reasoning (`trace.ts:65-68`). In `trace.ts`, add
        `intent: z.string().nullish()` to `PromptAssembly` with a doc comment naming the
        slot. `Intent` and `PrBrief` are **not** edited (D1). Then grep the other contract
        files for the new MEMBER names, not the symbols (root `CLAUDE.md` Gotchas).
        (`specs/README.md`'s L03 row was already pointed at this file when the plan was
        committed — nothing to do here.)
Verify: for f in brief.ts review-api.ts trace.ts; do diff -q
        server/src/vendor/shared/contracts/$f client/src/vendor/shared/contracts/$f; done
        prints nothing;
        `cd server && pnpm typecheck`; `cd client && pnpm typecheck`;
        `cd reviewer-core && npm run typecheck`
Depends: none

### Step 2 — The cheap model: the module's constant and the Settings row it advertises · package: server + client
Files:  `server/src/modules/intent/constants.ts` (new) ·
        `server/src/vendor/shared/contracts/platform.ts` (edit, row `52-58`) ·
        `client/src/vendor/shared/contracts/platform.ts` (edit, mirror) ·
        `client/src/lib/feature-models.ts` (edit, row `21-27`)
Skills: typescript-expert, zod
Do:     Create the module's constants file with

            export const DEFAULT_INTENT_MODEL: FeatureModelChoice = {
              provider: 'openrouter',
              model: 'deepseek/deepseek-v4-flash',
            };

        Its doc comment, in the shape `DEFAULT_CONVENTIONS_MODEL`'s takes
        (`conventions/constants.ts:102-115`), states three things: why `resolveFeatureModel`
        is not used; why this model (it is what the conventions extractor chose for the same
        job, and `OpenRouterProvider` is the most-exercised structured path in this repo); and
        the two first-party alternatives a workspace can pick in Settings when it wants the
        schema guaranteed by the API contract rather than by whichever endpoint OpenRouter
        routes to — Anthropic **`claude-haiku-4-5`** ($1 / $5 per MTok, strict schema via
        `strict: true` on the tool definition) and OpenAI **`gpt-5-mini`** ($0.25 / $2,
        `json_schema` with `strict: true`). Use those ids exactly; the Anthropic one carries
        no date suffix. Then set the `review_intent` registry row's `defaultProvider` /
        `defaultModel` to `DEFAULT_INTENT_MODEL`'s values in all three copies, so the Settings
        screen stops advertising `openai / gpt-4.1`, which no code path buys. No enum member is
        added, so there is no enum mirror hunt.
Verify: `diff -q server/src/vendor/shared/contracts/platform.ts
        client/src/vendor/shared/contracts/platform.ts` prints nothing;
        `grep -n "review_intent" -A5 server/src/vendor/shared/contracts/platform.ts client/src/vendor/shared/contracts/platform.ts client/src/lib/feature-models.ts`
        shows `openrouter` / `deepseek/deepseek-v4-flash` three times, matching
        `DEFAULT_INTENT_MODEL`;
        `cd server && pnpm typecheck && cd ../client && pnpm typecheck`
Depends: none (independent of Step 1)

### Step 3 — Extend `pr_intent` + the migration · package: server
Files:  `server/src/db/schema/reviews.ts` (edit, `48-56`) ·
        `server/src/db/migrations/00NN_*.sql` + `meta/` (generated, do not hand-edit) ·
        `server/src/modules/reviews/repository.ts` (edit — delete `upsertIntent`/`getIntent`,
        correct the class doc) ·
        `server/src/modules/reviews/repository/pull.repo.ts` (edit — delete the `intent`
        section and its now-unused `Intent` import)
Skills: drizzle-orm-patterns, postgresql-table-design, onion-architecture
Do:     Add to `prIntent`: `kind` as `text('kind', { enum: [...] })` (a TS-level narrowing that
        emits a bare `text` column — server `INSIGHTS.md` 2026-08-06), `confidence`
        (`doublePrecision`), `confidenceTier` (`text({enum})`), `sources`
        (`jsonb().$type<IntentSource[]>()`), `evidence` (`jsonb().$type<IntentEvidence[]>()`),
        `provider`, `model`, `tokensIn`, `tokensOut`, `costUsd` (`doublePrecision`, nullable —
        null is *unpriced*, not free), `durationMs`, `headSha`, `generatedAt` (`now()`). Index
        nothing beyond the existing PK: reads are always by `pr_id`. Then
        `cd server && pnpm db:generate` and run `pnpm db:migrate` **manually** — migrations do
        not run on boot.
        NOT NULL is only legal on a provably empty table: check
        `select count(*) from pr_intent` on the target DB first. If it is not 0, add the
        columns nullable and tighten in a second migration (server `INSIGHTS.md` 2026-08-06).
        This migration only ADDs columns, so drizzle-kit's rename prompt should not fire; if it
        does, drive it with `expect` per the same INSIGHTS entry — never pipe into it.
        Do NOT use the `now()` helper for `generated_at`: it is hardcoded to a column named
        `created_at` (`db/schema/_shared.ts:9`), and this row is upserted in place rather
        than created once. Spell the column out.
        **D2's deletion happens HERE, not in Step 6** (moved during implementation): the
        widened table is what stops `pullRepo.upsertIntent` compiling — it inserts four
        columns of thirteen — so leaving it until Step 6 would mean three steps in a row
        that cannot typecheck, and a step that cannot typecheck cannot be committed.
Verify: `git status server/src/db/migrations` shows exactly one new `.sql` + the snapshot;
        `grep -rn "upsertIntent\|getIntent" server/src` returns nothing;
        `grep -c "DROP COLUMN" <the new sql>` returns 0;
        `cd server && pnpm db:migrate` exits clean; `pnpm typecheck`
Depends: Step 1 (the schema `$type<>`s import the new contract types)

### Step 4 — The `intent` prompt slot in `reviewer-core` · package: reviewer-core
Files:  `reviewer-core/src/prompt.ts` (edit) · `reviewer-core/src/review/run.ts` (edit) ·
        `reviewer-core/docs/prompt-contract.md` (edit) ·
        `reviewer-core/test/prompt.test.ts` (edit)
Skills: onion-architecture, typescript-expert, zod
Do:     Add `intent?: string` to `PromptParts` (`prompt.ts:39-73`) documented as **untrusted,
        derived, already distilled by the caller** (D10), and to `ReviewInput`
        (`run.ts:44-93`), threaded through `promptParts` (`run.ts:130-139`). In
        `assemblePrompt`, between the `prDescription` push (`prompt.ts:106-108`) and the
        `skillsBlock` push (`:109`), emit `## PR intent (derived)` when and only when the value
        is non-empty after trim: the caller-composed confidence sentence stays **outside** the
        wrap, the derived text goes inside `wrapUntrusted('intent', …)`. Cap it with a
        `MAX_INTENT_CHARS` const in the shape of `MAX_PR_DESCRIPTION_CHARS` (`:37`), sized for
        a distillation and not for a pasted document — `docs/prompt-contract.md` Rule 6 and
        D10. Record `intent: <the pre-wrap string> ?? null` in the returned `PromptAssembly`
        (`:129-138`), matching `pr_description`'s convention. Add the new row to the contract
        doc's section table (position 3, shifting the rest) and tick its "Adding a slot"
        checklist. Extend the test file with a describe block modelled on `## Skills / rules`
        (`:74-120`), including the pinned-literal byte-identical case for `undefined` / `''` /
        whitespace.
Verify: `cd reviewer-core && npm test && npm run typecheck`;
        `cd server && pnpm arch:check 2>&1 | grep -c "no dependency violations found"` is 1
Depends: Step 1 (`PromptAssembly.intent` must exist in both contract copies first)

### Step 5 — The intent module's pure core: constants + helpers + unit tests · package: server
Files:  `server/src/modules/intent/constants.ts` (edit) ·
        `server/src/modules/intent/helpers.ts` (new) ·
        `server/test/intent-helpers.test.ts` (new)
Skills: typescript-expert, zod, onion-architecture
Do:     `constants.ts` gains, each with the doc comment that explains the number rather than
        restating it (`conventions/constants.ts` is the house style):
        `LINKED_ISSUE_RE` (D4 — the one named regex, this repo's only copy),
        `DOC_PATH_RE` + `ALLOWED_DOC_EXTENSIONS` + `MAX_PLAN_FILES` + `MAX_PLAN_FILE_CHARS`,
        `MIN_SUBSTANTIVE_BODY_CHARS`, `MAX_COMMIT_MESSAGES`, `MAX_CHANGED_PATHS`,
        `MAX_EVIDENCE_ITEMS` + `MAX_EVIDENCE_CHARS`, `TIER_SCORE`, `TIER_ORDER`,
        `INTENT_SYSTEM_PROMPT` (carrying its own injection guard — `assemblePrompt`'s is not
        exported and this prompt has no diff, exactly the argument at
        `conventions/constants.ts:117-126`), `INTENT_TIMEOUT_MS`.
        `helpers.ts` is pure and imports nothing from `src/adapters/**` or `src/db/**`:
        `extractPlanPaths(body)` → validated repo-relative paths only (rejects leading `/`,
        any `..` segment, `~`, any scheme, anything outside the extension allow-list, capped
        at `MAX_PLAN_FILES`); `extractLinkedIssue(body, repoFullName)` → issue number or
        undefined, keyword required, cross-repo discarded; `isSubstantiveBody(body)` →
        strips HTML comments and an unticked template checklist, then compares length;
        `tierFromSources(sources)`; `settleTier(codeTier, suggestedTier)` = `min` over
        `TIER_ORDER`; `buildIntentPrompt(inputs)` — every external block `wrapUntrusted`-ed;
        `renderIntentForPrompt(record)` → the distilled string Step 8 hands the engine
        (confidence sentence + intent + scope lists, capped; **no raw source text** — D10);
        `toIntentDto(row)` → `PrIntentRecord`.
        Write the mapper as an explicit arrow at every call site, never `rows.map(toIntentDto)`
        (server `INSIGHTS.md` 2026-08-12).
Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' intent-helpers` green,
        with a case per traversal form (`/etc/passwd`, `../x.md`, `a/../../b.md`, `~/x.md`,
        `https://…/x.md`) asserting the path is dropped, and a case feeding a long body +
        issue text through `renderIntentForPrompt` asserting neither appears in the output;
        `pnpm typecheck`;
        `pnpm arch:check 2>&1 | grep -c "no dependency violations found"` is 1
Depends: Steps 1, 2

### Step 6 — Repository, service, and the brokered `container.intent` · package: server
Files:  `server/src/modules/intent/repository.ts` (new) ·
        `server/src/modules/intent/service.ts` (new) ·
        `server/src/platform/container.ts` (edit)
        (D2's deletions moved to Step 3 — the schema change is what breaks them.)
Skills: onion-architecture, drizzle-orm-patterns, postgresql-table-design, typescript-expert
Do:     `repository.ts` is the **only** SQL over `pr_intent`: `get(prId)`, `upsert(row)`.
        `service.ts` runs one pass, in the shape of `ConventionsService.extract`
        (`conventions/service.ts:80-190`), stepwise and commented: resolve the PR + repo →
        gather sources through the ports (`container.git.readFile` for plan files,
        `container.github()` + `getIssue` for the linked issue, the persisted `pull_requests`
        row and `pr_commits` for the rest) → compute `codeTier` → one `completeStructured`
        call on
        `(await container.featureModelOverride(ws, 'review_intent')) ?? DEFAULT_INTENT_MODEL`
        → `settleTier` → persist with usage, model and `head_sha`. A source that cannot be
        read is **skipped, never fatal** (`readOrSkip`, `conventions/service.ts:332-339`); the
        GitHub client being unavailable drops source (b) and nothing else.
        Changed paths for source (f) are a **parameter**, not a query (D11): `forReview(ws,
        pull, changedPaths)` takes them from its caller; `derive(ws, prId)` — the standalone
        `POST` path, which holds no diff — reads `pr_files` itself and is the only place that
        table is touched.
        When `pull.body` is null the Live Log must say so in those words: `pull_requests.body`
        is populated only by `GET /pulls/:id`, so a PR nobody has opened in the UI legitimately
        has none, and a `low` tier that does not explain itself reads as a broken feature
        rather than a missing input.
        Export `export type IntentApi = Pick<IntentService, 'derive' | 'get' | 'forReview'>`
        and type both `ContainerOverrides.intent` and the `container.intent` getter with it —
        never the class (server `INSIGHTS.md` 2026-08-06). Add the getter next to `conventions`
        (`container.ts:130-134`) with the same comment about why it is brokered.
        `forReview` is cache-aware: return the persisted row when `head_sha` matches, else
        derive; it returns both the record and the rendered prompt string, so Step 8 never
        imports this module's helpers.
Verify: `cd server && pnpm typecheck`;
        `pnpm arch:check 2>&1 | grep -c "no dependency violations found"` is 1 (a
        `modules/intent → modules/settings` import would print a warning line here and still
        exit 0 — read the line);
        `grep -rn "upsertIntent\|getIntent" server/src` returns nothing outside
        `modules/intent/` (already true after Step 3; re-checked here);
        `grep -n "prFiles" server/src/modules/intent/` appears only in the `derive` path
Depends: Steps 3, 5

### Step 7 — Routes + module registration · package: server
Files:  `server/src/modules/intent/routes.ts` (new) · `server/src/modules/index.ts` (edit)
Skills: onion-architecture, fastify-best-practices, zod
Do:     `GET /pulls/:id/intent` → `PrIntentRecord`, `NotFoundError` when the row does not
        exist. `POST /pulls/:id/intent` → derive/re-derive, with
        `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`, the same budget and the
        same reasoning as `POST /pulls/:id/review` (`reviews/routes.ts:29`) and
        `POST /repos/:id/conventions/extract` (`conventions/routes.ts:29-34`) — it spends
        money. Both start with `getContext(container, req)`; params come from
        `IdParams` (`modules/_shared/schemas.ts`); no hand-rolled `.parse(req.body)`. The POST
        logs one pino line naming the sources used, the tier, the model and the cost, the way
        `conventions/routes.ts:42-50` does — the UI must not be the only place this is
        answerable from. One import + one entry in `modules/index.ts`, nothing else touched.
Verify: `cd server && pnpm typecheck`;
        `pnpm arch:check 2>&1 | grep -c "no dependency violations found"` is 1;
        `grep -n "intent" server/src/modules/index.ts` shows exactly the import and the
        registry entry
Depends: Step 6

### Step 8 — Wire into the review run · package: server
Files:  `server/src/modules/reviews/run-executor.ts` (edit)
Skills: onion-architecture, typescript-expert
Do:     In `executeRuns`, immediately after the diff-ready log line (`:106`) and **before** the
        per-agent loop (`:108`), derive once through
        `container.intent.forReview(workspaceId, pull, diff.files.map(f => f.path))` — the
        changed paths come from the `UnifiedDiff` already in hand, never from `pr_files`, which
        can be empty for a PR whose diff loaded from git (D11). Wrap the call in
        `runLog.step('Deriving PR intent', …, { kind: 'tool' })` so it lands in every queued
        run's Live Log and in each persisted trace (that is what the fanned-out `RunLogger` at
        `:65-70` is for), and wrap the whole thing so a throw degrades to `undefined` and logs
        the reason — the exact contract `buildCallersDigest` keeps (`:396-402`) and the one the
        acceptance criteria pin. Log which sources were used, the tier, the model and the cost;
        when the persisted row was reused, say so explicitly ("cache hit — head unchanged") and
        make no LLM call. Use the rendered string `forReview` returns; do **not** import
        `modules/intent/helpers.ts`, which is the cross-module import the guard warns about.
        Pass it into `reviewPullRequest` as `...(intentBlock ? { intent: intentBlock } : {})`,
        beside the existing spreads (`:204-214`), so an absent intent adds no key.
Verify: `cd server && pnpm typecheck`;
        `pnpm arch:check 2>&1 | grep -c "no dependency violations found"` is 1 — specifically
        no `modules/reviews → modules/intent` line;
        `grep -n "prFiles\|getPrFiles" server/src/modules/reviews/run-executor.ts` shows no
        new call;
        `pnpm exec vitest run --exclude '**/*.it.test.ts'` still green
Depends: Steps 4, 6

### Step 9 — Integration test · package: server
Files:  `server/test/intent.it.test.ts` (new)
Skills: onion-architecture
Do:     Build the app with `MockLLMProvider` (`structuredBySchema` keyed on the intent schema
        name so the review's own fixture stays separate — `mocks.ts:53`), `MockGitClient`
        (`files: { 'specs/plan.md': … }`), and `MockGitHubClient`. Cover: the four ladder
        paths (plan file, closing keyword, body-only, signals-only); the model's `high`
        suggestion being clamped to `medium`; the rendered prompt block containing no substring
        of the seeded body or issue text (D10); **a PR with zero `pr_files` rows whose diff
        loads from `MockGitClient.diff()` still producing `file_paths` evidence** (D11); `GET`
        → 200 then 404 for an underived PR; a review run reusing the row on unchanged
        `head_sha` with `MockLLMProvider.calls` unchanged; the same run re-deriving after
        `head_sha` moves; a git/LLM throw leaving every `agent_runs` row `done`. Assert what
        the SERVER owns, not what the test composed (server `INSIGHTS.md` 2026-08-07).
Verify: `cd server && pnpm exec vitest run .it.test` green (needs Docker); if it fails, re-run
        `intent.it.test.ts` alone before debugging — the lane's wait helper returns rather than
        throwing on timeout (server `INSIGHTS.md` 2026-08-07)
Depends: Steps 7, 8

### Step 10 — Client: the intent hook and the Intent card · package: client
Files:  `client/src/lib/hooks/intent.ts` (new) · `client/src/lib/hooks/index.ts` (edit) ·
        `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/` (new folder:
        `IntentCard.tsx · styles.ts · constants.ts · helpers.ts · index.ts · IntentCard.test.tsx`) ·
        `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` (edit) ·
        `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (edit, `:142`) ·
        `client/messages/en/prReview.json` (edit)
Skills: design-reference (**first, before any code**), frontend-architecture,
        react-best-practices, next-best-practices, typescript-expert, react-testing-library
Do:     Load `design-reference` and re-walk its lookup before writing anything — the
        manifest entry for screen `pull-request-detail`, then `BRIDGE.md`, then
        `pr-detail.jsx:3-18,69-74,135-140` and the fixture `core-mock-data.jsx:28-40`. State
        the screen key and artboard ids in the step report, as the skill requires. The design
        findings are already settled in **D8** and **D12** — do not re-derive them, and do not
        deviate from them without saying so.
        Port `IntentBlock` verbatim — `Card` + `SectionLabel icon="Target"`, the italic quoted
        intent line, the 2-column IN SCOPE (`var(--ok)`, `Icon.Check`) / OUT OF SCOPE
        (`var(--text-muted)`, `Icon.X`) grid — then add the four things of D8: the
        **`ConfidenceNum`** reading (D12 — `ConfidenceNum` only, no second confidence `Badge`),
        a non-interactive source-chip row (**`Badge`, not `Chip`** — `Chip` renders a
        `<button>`, and N unlabelled buttons in one card is the `getByRole('button')` trap from
        client `INSIGHTS.md` 2026-08-06), a Re-derive action, and an `EmptyState` for a PR with
        no intent yet.
        `IntentCard` owns **no page-level `<section>` or outer heading** (D8): it is the `Card`
        and what is inside it, so L05 can drop it into `BriefCard`'s left column unchanged.
        In `OverviewTab` the card is rendered **above** the existing Description section, not
        below it (D8 — the design's Overview is the brief).
        `hooks/intent.ts` carries `usePrIntent(prId)` (`GET`, tolerating 404 as "not derived")
        and `useDeriveIntent(prId)`; the mutation writes the response with `setQueryData`
        **before** invalidating — the response is the only copy of the fresh row (client
        `INSIGHTS.md` 2026-08-06). `OverviewTab` gains a `prId` prop; the page passes it at
        `:142`. All copy under `prReview.intent.*` (D7); `brief.json` untouched — including its
        existing `block.intent`, which L05 reconciles when it absorbs this card.
Verify: `cd client && pnpm test && pnpm typecheck`; the card test covers populated / `low`
        tier / empty state / Re-derive, driven with `fireEvent` (client `INSIGHTS.md`
        2026-08-22 — `user-event` is not installed); token-based style assertions use
        `getAttribute("style")` + `toContain`, never `toHaveStyle` (client `INSIGHTS.md`
        2026-08-02).
        Design conformance, each a real check:
        `grep -n "ConfidenceNum" IntentCard.tsx` hits and `grep -c "<section" IntentCard.tsx`
        is 0; the card test asserts the `low` fixture renders `40% conf`;
        `grep -rn "Chip" IntentCard.tsx` returns nothing;
        `grep -n "IntentCard\|Description" OverviewTab.tsx` shows `IntentCard` on the earlier
        line; no literal English string in `IntentCard.tsx`
        (`grep -nE '"[A-Z][a-z]+ [a-z]' IntentCard.tsx` returns nothing but token/prop values)
Depends: Steps 1, 7

### Step 11 — Client: the Run Trace intent block · package: client
Files:  `client/…/RunTraceDrawer/_components/TraceBody/TraceBody.tsx` (edit, `:75-91`) ·
        `client/…/RunTraceDrawer/constants.ts` (edit, `PROMPT_COLORS` at `:14-22`) ·
        `client/messages/en/runs.json` (edit, `trace.prompt.*`) ·
        `client/…/RunTraceDrawer/RunTraceDrawer.test.tsx` (edit)
Skills: react-best-practices, react-testing-library, typescript-expert
Do:     Add a `PromptBlock` for `trace.prompt_assembly.intent`, guarded `!= null` like
        `repo_map` (`:82-84`), positioned to match the prompt's own order — after the system
        block and before skills. Add `intent` to `PROMPT_COLORS` and
        `trace.prompt.intent` ("Intent (derived, dynamic)") to `runs.json`. Note while you are
        there that `pr_description` is in the contract but rendered by no block; leave it —
        adding it is not this lesson's change.
Verify: `cd client && pnpm test && pnpm typecheck`; the drawer test asserts the block appears
        with `prompt_assembly.intent` set and is absent when it is null
Depends: Steps 1, 10

### Step 12 — Seed, e2e, and the docs that describe the flow · package: server + e2e
Files:  `server/src/db/seed.ts` (edit) · `e2e/specs/02-repo-pulls-detail.flow.json` (edit) ·
        `docs/architecture.md` (edit) · `server/README.md` (edit, the API map)
Skills: onion-architecture, drizzle-orm-patterns, typescript-expert
Do:     Seed one `pr_intent` row for demo PR #482, **guarded on its own absence** (`if this PR
        has no intent row`) so it backfills an existing dev DB rather than needing a fresh
        volume — the shape the `existingRuns.length === 0` block uses (server `INSIGHTS.md`
        2026-08-02). Its `head_sha` must equal the seeded `headSha` (`seed.ts:119`,
        `'a1b2c3d4e5f6'`) so it reads as a cache hit and not as stale. Without it the Intent
        card can only be seen by spending a real model call, which is the trap recorded at root
        `INSIGHTS.md` 2026-08-01 for `agent_runs`. Then — obligatory — grep `e2e/specs/*.json`
        for every literal the seed edit introduces or changes, and add one
        `wait --text` step on the seeded intent line to flow 02, after its
        `wait --load networkidle`. Update the review flow in `docs/architecture.md` to name the
        intent pre-work step, and add both endpoints to `server/README.md`'s API map.
Verify: `cd server && pnpm db:seed` twice in a row leaves exactly one `pr_intent` row for #482;
        `grep -rn "<each changed literal>" e2e/specs/*.json` reviewed line by line;
        `cd e2e && pnpm e2e:hermetic` green
Depends: Steps 3, 10

## Handoff

Plan file:      `specs/L03-intent-layer.md`
Entry point:    Step 1
Verification:   `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm exec vitest run .it.test && pnpm arch:check 2>&1 | grep -c "no dependency violations found"`
                `cd client && pnpm test && pnpm typecheck`
                `cd reviewer-core && npm test && npm run typecheck`
                `cd e2e && pnpm e2e:hermetic`
                per-file `diff -q` on every `vendor/shared` file this lesson touched — must
                print nothing (the tree as a whole does not match; see Acceptance criteria)
Deviation policy: stop at the step, report the divergence, finish the independent steps.
                  Do not re-plan.
