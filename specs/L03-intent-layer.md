# L03 — Intent layer

Status: Round 1 implemented · Round 2 implemented · Smart Diff unspecced
Owner: —
Packages touched: server, client, reviewer-core, e2e

> **Round 1 shipped, then was reopened.** Everything above the horizontal rule near the
> end of this file is the original plan, kept verbatim — it still describes accurately what
> Round 1 built, and its Decisions D1–D12 remain in force except where a Round 2 decision
> says otherwise. **Round 2 is appended at the end**: it audits the shipped feature against
> the course brief for L03 (quoted there in full) and pays off the four requirements the two
> disagree about. Start there if you are picking this lesson up.

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

Ticked during Round 2's Step R2-7, against evidence re-run that session — not against
Round 1's own report. `intent.it` = `server/test/intent.it.test.ts`.

- [x] A PR whose body names an existing repo-relative `.md` path gets that file's content into
      the derivation and a `high` tier, with `plan_file` in `sources` and the path in `evidence`.
      — `intent.it:173`. **Half proven:** `evidence[]` rows come from the model's reply, and the
      fixture returns a `pr_title` row, so nothing exercises the path landing there.
- [x] A PR whose body says `Closes #471` and nothing else substantive gets `high`, with
      `linked_issue` in `sources`, resolved through `GitHubClient.getIssue`. — `intent.it:187`
- [x] A PR with **no** body, no linked issue and no plan file still produces an intent, from
      title + commits + branch + changed paths, and is persisted with tier `low`. It is not an
      error and not an empty card. — `intent.it:266`
- [x] A PR with **zero `pr_files` rows** but a non-empty diff still yields file-path evidence
      on the review path (D11). — `intent.it:592`
- [x] The model cannot raise the tier: given a fixture whose `suggested_tier` is `high` over a
      body-only PR, the persisted tier is `medium`. — `intent.it:255`
- [x] The rendered prompt slot contains no substring of the PR body, the linked issue body, or
      a plan file beyond a short quoted evidence span (D10). — `intent.it:510`
      (`not.toContain('mock issue')`) and `intent-helpers.test.ts` § "renders the distillation
      and nothing else"
- [x] `GET /pulls/:id/intent` returns `PrIntentRecord` for a derived PR and **404** for one
      that was never derived. — `intent.it:437`
- [x] `POST /pulls/:id/intent` re-derives and overwrites the row, and is rate-limited to the
      same budget as `POST /pulls/:id/review` (`reviews/routes.ts:29`). — overwrite at
      `intent.it:448`. **The rate limit is code, not test:** `intent/routes.ts:42` sets the same
      budget, and no suite exercises a 429 anywhere in this repository.
- [x] A review run reuses the persisted intent when `pr_intent.head_sha === pull.head_sha` and
      makes **zero** LLM calls for intent; the Live Log says it was a cache hit. — `intent.it:461`
- [x] A review run whose intent derivation throws still completes every agent run
      successfully, with the failure reason in the Live Log and no `## PR intent` section in
      the prompt. — `intent.it:491`
- [x] **Regression:** with `intent` absent/undefined, `assemblePrompt` produces a prompt
      byte-identical to today's, and `PromptAssembly.intent` is null. — the pinned literal at
      `reviewer-core/test/prompt.test.ts:159`, still green after Round 2 added the scope rule
- [x] With `intent` present, the section sits after `## PR description` and before
      `## Skills / rules`, the model-written text is inside `wrapUntrusted('intent', …)`, and
      the confidence sentence is outside it. — `prompt.test.ts:201`
- [x] Every `vendor/shared` file this lesson touches is byte-identical across the two
      copies. — `diff -q` on `review-api.ts`, `findings.ts`, `trace.ts`, all silent
- [x] The Settings row `PR Review · Intent` advertises the model the module actually uses.
      — by inspection: `DEFAULT_INTENT_MODEL`, `contracts/platform.ts:53` and
      `client/src/lib/feature-models.ts:22` all read `openrouter` / `deepseek/deepseek-v4-flash`.
      **Nothing pins them together** — see Open questions.
- [x] The Intent card renders intent, scope lists, a `ConfidenceNum` reading and source
      chips; it sits above the Description section and owns no page-level section wrapper; an
      un-derived PR renders the empty state with a Derive action and no card body.
      — `IntentCard.test.tsx`; placement at `OverviewTab.tsx:26`
- [x] The Run Trace drawer shows an `Intent (dynamic)` prompt block for a run that had one,
      and no block for a run that did not. — `RunTraceDrawer.test.tsx`
- [x] `pnpm arch:check` **output** is empty for `server/` — `✔ no dependency violations found
      (167 modules, 552 dependencies cruised)`, 16 known ignored, unchanged from Round 1

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
        Design conformance. Two of these are greps and two are assertions, and the
        split is not arbitrary — a grep over a source file also matches that file's
        own doc comments, so "no `<section>`" and "no hardcoded copy" grep DIRTY on
        a correct file. Written as checks that can actually fail:
          - `grep -c "ConfidenceNum" IntentCard.tsx` > 0 and `grep -c "Chip" IntentCard.tsx`
            is 0 — both are import/JSX identifiers, so a grep is exact here;
          - the card test asserts `container.querySelector("section")` is null (the real
            "absorbable by L05" check) and that the `low` fixture renders `40% conf`;
          - `grep -n "IntentCard\|SectionLabel" OverviewTab.tsx` shows `IntentCard` first;
          - hardcoded copy is caught by the card test rendering through
            `NextIntlClientProvider` with the real `prReview.json`: a literal would not
            come from the message file, and a missing key throws.
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

---

# Round 2 — conformance with the assignment brief

Status: implemented · opened 2026-08-22 · closed 2026-08-22
Packages touched: server, client, reviewer-core, e2e, `.claude/agents`

## Context

Round 1 shipped on branch `lesson-03` in six commits (`27278f8` … `b4bfcd7`) and its own
acceptance criteria hold: `server` unit 219 green, `reviewer-core` 39 green, `client` 229
green, every `vendor/shared` file this lesson touched byte-identical across the two copies.
The `*.it.test.ts` lane needs Docker and was last run at implementation time, not during this
audit.

This round audits the shipped feature against the **course brief for L03** — the text the
lesson is graded on — rather than against Round 1's own plan, and pays off what the two
disagree about. Round 1's plan was written from the repository's constraints and is right
about them; where it and the brief differ, the brief decides what the feature must DO, and
Round 1's constraints decide HOW it is allowed to do it. Every step below respects both.

The brief, rendered in English (the original is the Ukrainian course text; this repository is
English-only by convention):

> **Intent classifier.** A separate call to a cheap flash-class model through OpenRouter
> returns `Intent { summary, in_scope[], out_of_scope[] }`. Its input is the PR title and
> description, the linked issue or ticket, any available plan or specification, and the list
> of files **with hunk headers**. Change bodies are not sent.
>
> **Persistence.** The intent is stored per PR. When the PR is updated, the user can trigger a
> re-derivation.
>
> **Injection into the review.** The structured intent is added to the reviewer's prompt.
> **Comments outside the scope are filtered out, but a serious problem outside the PR's bounds
> keeps one signal.**
>
> **Interface.** The PR page shows an intent card above the review results, so the user can
> check whether the system understood the task.
>
> **Model settings.** A cheap model for classification is selectable separately from the main
> review model.
>
> **Observability.** Log the prompt's components, the chosen model, the token estimate and the
> intent's sources, without recording secrets or excess diff content.
>
> If the PR description is empty, the classifier uses the title, the file names and the hunk
> headers. If the description carries a ticket, a link to a plan or a specification, those
> materials must be fetched and added to the intent's sources. **An unreachable link must not
> be silently replaced with invention: the intent must mark the missing context.**
>
> Final checks: the intent card describes the PR's purpose correctly; the classifier runs on a
> separate cheap model; its request carries no full change bodies; a plan or specification
> named in the PR description is genuinely taken into account; read-only agents cannot modify
> files; the log shows the prompt's composition without secrets or excess code.

### Audit — every brief item against what Round 1 shipped

| Brief item | Verdict | Evidence |
|---|---|---|
| Separate cheap flash-class model via OpenRouter | ✅ | `modules/intent/constants.ts:34` (`openrouter` / `deepseek/deepseek-v4-flash`), one `completeStructured` at `service.ts:196-210` |
| Returns `{summary, in_scope[], out_of_scope[]}` | ✅ | `helpers.ts:IntentReplySchema`. The field is named `intent`, not `summary`, because `Intent` (`contracts/brief.ts:9-13`) is the starter's own shape and D1 refuses to rename it |
| Input: PR title + description | ✅ | `helpers.ts:buildIntentPrompt` |
| Input: linked issue **or ticket** | ⚠️ partial | `constants.ts:61` requires a GitHub closing keyword (D4). `Ticket: #471`, `Refs #471`, an issue URL without a keyword — resolved by nothing, fetched by nothing |
| Input: available plan or specification | ⚠️ partial | `helpers.ts:77-90` reads repo-relative paths only. A link to a plan (`https://github.com/<this repo>/blob/main/specs/x.md`) is erased with every other URL |
| Input: file list **with hunk headers** | ❌ missing | `service.ts:283` passes `changedPaths: string[]`; `grep -rn hunk server/src/modules/intent` is empty. The data is in hand — `UnifiedDiff.files[].hunks` (`vendor/shared/adapters.ts:175-187`) |
| No change bodies in the request | ✅ | the classifier prompt has no diff block at all |
| Stored per PR, re-derivable | ✅ | `pr_intent` + `POST /pulls/:id/intent` + the card's Re-derive |
| Structured intent injected into the reviewer's prompt | ✅ | `reviewer-core/src/prompt.ts:145-150`, section `## PR intent (derived)` |
| **Out-of-scope comments filtered; one signal kept for a serious problem** | ❌ missing | Round 1 § Out of scope declared it a product decision. Worse, the trusted note tells the reviewer the opposite in so many words: *"it never narrows what you review"* (`helpers.ts:341`) |
| Intent card above the review results | ✅ | `OverviewTab.tsx` renders `IntentCard` first |
| Cheap model selectable separately | ✅ | `review_intent` row in `FEATURE_MODELS`, all three copies aligned with `DEFAULT_INTENT_MODEL` |
| Log: prompt components, model, **token estimate**, sources | ⚠️ partial | `service.ts:212-216` and `routes.ts:52-63` carry sources, tier, model, cost, duration — **no token counts anywhere in any log**, and nothing that says which blocks the classifier prompt was built from |
| Empty description → title + file names + hunk headers | ⚠️ partial | the degraded ladder works (`service.ts:260-268`), still without hunk headers |
| **Unreachable link marks the missing context** | ❌ missing | `notes` is computed (`service.ts:241,254,262,266`) and then discarded on the `POST` path — `derive()` returns the record only (`:127-136`). Nothing is persisted, nothing reaches the card, and the classifier itself is never told a named document was unreadable. `intent.it.test.ts:206` is called *"names a plan file it cannot read"* and asserts only that the source is absent — there is nowhere for it to be named |
| Read-only agents cannot modify files | ⚠️ instruction, not boundary | `Write`/`Edit` are absent from `architecture-reviewer`, `plan-verifier`, `researcher`, but `Bash` is unrestricted. `.claude/agents/architecture-reviewer.md:32-46` states this honestly and names the per-agent hook as a known upgrade |
| Log shows prompt composition, no secrets, no excess code | ⚠️ partial | the reviewer's own slot is in `prompt_assembly.intent` (`trace.ts:52-57`) ✅; the classifier's composition is not logged beyond its source list |

Four gaps are the substance of this round: **hunk headers**, **the scope gate**, **the
missing-context marker**, and **the link widening**. Two more are cheap and belong in the same
pass: **token/prompt-composition logging** and the **read-only agent boundary**.

## In scope

- **Hunk headers into the classifier** — synthesised from the `UnifiedDiff` already in hand on
  the review path, and from `pr_files.patch`'s `@@` lines only on the `POST` path. Headers,
  never bodies.
- **`missing_context`** — a persisted, prompted and rendered list of what the PR pointed at
  and we could not read: a new `PrIntentRecord` field, a new `pr_intent` column and migration,
  a trusted block in the classifier's own prompt, a line in the reviewer's intent slot, a row
  on the Intent card, and the `POST` route's pino line.
- **Link widening, inside the existing no-outbound-fetch constraint** — ticket-word issue
  references and this repo's GitHub blob URLs, the latter mapped to a repo-relative path and
  read from the clone.
- **The scope gate** — an optional `scope` label on `Finding`, a trusted rule in the intent
  section of the reviewer's prompt, and `reviewer-core/src/scope-gate.ts`: a pure post-step
  beside `grounding.ts` that drops out-of-scope findings and keeps exactly one out-of-scope
  CRITICAL as the single signal. Summarised in `RunStats.scope_gate` and the Live Log.
- **Observability** — token counts and a content-free block inventory in the derivation's log
  line and the `POST` route's pino line; cost and tokens on the Intent card (Round 1's D6
  promised the card would carry them and it does not).
- **Repo hygiene the brief's final checks name** — the ordered section list in
  `docs/agent-prompts/README.md:41-52` still omits `## PR intent (derived)`; the three
  read-only agents get a `PreToolUse` boundary instead of a sentence.

## Out of scope

- **A `findings.scope` column and a scope badge in the findings panel.** See D18: the gate
  runs before persistence, exactly like grounding, so a dropped finding never reaches the DB
  and a column would describe only the survivors. The brief asks for filtering and for one
  surviving signal, not for a badge.
- **Editing `INJECTION_GUARD`.** See D17. The guard's rule — untrusted text never descopes a
  review — stays true, because the author's `out_of_scope` list never suppresses anything; our
  code acts on the reviewing model's own label.
- **Re-deriving intent when only the PR body changes.** The cache key stays `head_sha`; a body
  edit is paid for with the Re-derive button, as in Round 1.
- **Fetching any URL that is not this repo's own GitHub blob path.** Unchanged from Round 1:
  no arbitrary outbound fetch, in any lesson. A blob URL is not fetched either — it is
  *translated* into a clone read.
- **Jira / Linear / any non-GitHub ticket source.** Still no adapter.
- **Smart Diff**, still the other half of L03 and still unspecced.
- **Reconciling the pre-existing `vendor/shared` drift** in `adapters.ts`,
  `contracts/eval-ci.ts`, `contracts/productionize.ts`. Unchanged from Round 1.
- **A second model call to judge scope.** The reviewing model already sees the intent; asking
  it to label its own findings costs nothing extra, and a separate judge is L07's shape.

## Decisions

**D13 — hunk headers are synthesised, not quoted.** `diff-parser.ts:46-60` keeps a hunk's four
numbers and throws the header text away, so the block is rebuilt as
`@@ -oldStart,oldLines +newStart,newLines @@` — the whole header GitHub renders, minus its
optional trailing section-heading, which we never had. On the `POST` path there is no
`UnifiedDiff`, so the headers come from `pr_files.patch` by keeping **only** lines matching
`/^@@ /` (`db/schema/pulls.ts:44`, nullable — a row without a patch contributes its path and
its `+a/-d` counts and nothing else). Two caps: files reuse `MAX_CHANGED_PATHS`, hunks get
`MAX_HUNK_HEADERS_PER_FILE`, and a file over the cap prints `… N more hunk(s)` rather than
silently truncating. The unit test asserts the rendered block contains no line beginning with
`+` or `-`; that assertion is the mechanical form of "change bodies are not sent".

**D14 — missing context is a persisted field, not a log line.** Round 1 computed exactly the
right sentences and then dropped them: `notes` never leaves `deriveFor`'s return value on the
`POST` path (`service.ts:127-136`), and no reader of a `pr_intent` row can tell that a plan
file was named and unreadable. The brief asks for the opposite in as many words. So
`missing_context: string[]` lands on `PrIntentRecord`, on the row, in the classifier's own
user message as a **trusted** block ("these were named and could not be read — do not
reconstruct them"), in `renderIntentForPrompt`'s output so the reviewer sees it too, and as a
warning row on the card. `Intent` (`brief.ts:9`) is still not touched — D1 stands.

**D15 — the link widening keeps the no-outbound-fetch rule intact.** Two additions, both
resolved through ports we already own:
  1. *Ticket references.* An issue reference introduced by a ticket word — `Ticket:`, `Issue:`,
     `Refs`, `Ref:`, `Related to`, `Part of` — is resolved through `GitHubClient.getIssue`
     exactly like a closing keyword. A bare `#5` in running prose is still ignored, which is
     D4's actual concern; the closing keyword was never the point, "the author pointed at this
     deliberately" was.
  2. *Blob URLs.* `https://github.com/<owner>/<repo>/blob/<ref>/<path>` whose `owner/repo` is
     **this** repo is rewritten to `<path>` and read from the **clone**. Nothing is fetched.
     Every other URL is erased before path scanning, exactly as `helpers.ts:77-90` does today —
     the rewrite happens *before* that erase and only for the matching host and repo, so the
     property that test pins ("never turns a remote URL into a local file read") is preserved
     for everything else.
Anything named and unresolved goes to `missing_context` (D14) rather than being forgotten.

**D16 — a fetched ticket earns `high`, a mention earns nothing.** `tierFromSources` is
unchanged: `linked_issue` is recorded only when the issue was actually read, and the ladder
already rates that `high`. The reference form (`closes #471`, `Ticket: #471`,
a blob URL) is recorded in `evidence[].ref`, so the card can show what was followed.

**D17 — the gate acts on the REVIEWER's label, never on the author's list.** The scope filter
the brief asks for is one instruction away from the failure `INJECTION_GUARD` exists to
prevent: if a PR body could declare something out of scope and thereby silence a finding, a
body would be able to descope its own review. So:
  - the author's `out_of_scope` list is *information* in the prompt, as it already is;
  - the trusted rule rendered in the intent section says the label means "this concerns code or
    behaviour this pull request does not change and is not required to change", explicitly
    **not** "the author said not to look";
  - the model labels a finding, and **our code** decides what happens to it;
  - `INJECTION_GUARD` is not edited, and stays true as written.

**D18 — the gate drops before persistence, and reports like grounding does.** `Finding` gains
`scope: z.enum(['in','out']).nullish()`; unlabelled findings are `in` by default, so a model
that ignores the field changes nothing. The gate runs immediately after `groundFindings`
(`review/run.ts:206-212`), drops every `out` finding whose severity is not `CRITICAL`, and of
the `out` CRITICALs keeps the single highest-`confidence` one — that is the brief's "one
signal" — dropping the rest with reasons. Survivors are what `scoreFromFindings` scores, for
the reason the code already gives at `run.ts:214-217`: the score, the findings list and the
persisted event must agree. The outcome is a `RunStats.scope_gate` string
(`z.string().nullish()` — nullish for the same reason `cost_usd` is: traces written before this
existed have no key) plus one Live Log line per drop, because a silent filter is the one thing
this repository's review path has never done.

**D19 — the gate is inert without an intent, and the note that contradicts it is corrected.**
No intent → no scope rule in the prompt → no labels → a prompt and a finding set byte-identical
to Round 1. And `renderIntentForPrompt`'s closing clause, *"it never narrows what you review"*
(`helpers.ts:341`), is replaced: it was written to forbid exactly the behaviour the brief
requires, and leaving it in place would instruct the model against the gate it now feeds.

**D20 — read-only agents get a boundary.** `architecture-reviewer.md:32-46` already names the
mechanism and calls it a known upgrade: a `PreToolUse` hook that sees the command string.
`architecture-reviewer`, `plan-verifier` and `researcher` get one that denies mutating Bash
(redirection, `rm`, `mv`, `sed -i`, `tee`, `git commit|add|checkout|push`, package installs)
and allows the read/verify set they actually need. `.claude/agents/README.md` § Permissions is
corrected in the same pass, and the honest paragraph in `architecture-reviewer.md` is rewritten
to describe what is now true rather than deleted.

**D21 — a repo-root boilerplate document is not a plan.** `DOC_PATH_RE` matches any `.md`, so
a body saying "updated README.md" currently registers `plan_file` and buys `high` confidence
with no plan in sight. A path qualifies as a plan file only when it has at least one directory
segment, or its basename is outside the boilerplate set (`README`, `CHANGELOG`, `CONTRIBUTING`,
`LICENSE`, `CODE_OF_CONDUCT`, `SECURITY`). The file is still readable as evidence when the
author points at `docs/README.md`; what is refused is the root README buying a tier.

## Acceptance criteria

`intent.it` = `server/test/intent.it.test.ts`, `helpers` = `server/test/intent-helpers.test.ts`.
Every lane below was re-run in Step R2-7, including the `.it` lane and `e2e:hermetic`.

- [x] The classifier's user message lists changed files **with hunk headers** and contains no
      line beginning with `+` or `-`. True on the review path (from the diff) and on the
      `POST` path (from `pr_files.patch`), including for a PR whose `pr_files` rows have a null
      patch. — `intent.it:344` (a two-hunk patch and a null-patch row in one PR) and
      `helpers` § `renderChangedFiles` / `hunkHeadersFromPatch`. **Scope of the assertion
      changed:** it is made over the `## Changed files` block, not the whole prompt, because a
      markdown PR body opens lines with `-` all by itself and so does `missing_context`.
      Whole-prompt was a weaker claim wearing a stronger one's clothes.
- [x] A PR whose body names `specs/missing.md`, or links an issue that cannot be read, persists
      that fact in `missing_context`, renders it on the card, and passes it to the classifier as
      a trusted "do not reconstruct" block. `intent.it:281` asserts the naming, not
      only the absence. — plus `intent.it:307` (unreadable issue), `:322` (round trip through
      the row and `GET`), `:334` (empty when nothing was missing), `IntentCard.test.tsx`
- [x] `Ticket: #471` and `https://github.com/<this repo>/issues/471` resolve the issue through
      `getIssue` and record `linked_issue`; a bare `#5` in prose still resolves nothing.
      — `intent.it:209`, `helpers` § `extractLinkedIssue`
- [x] `https://github.com/<this repo>/blob/main/specs/plan.md` in a body is read **from the
      clone** and recorded as `plan_file`; the same URL for another repo is not read, is not
      fetched, and lands in `missing_context`. — `intent.it:221` and `:233`
- [x] Every traversal form Round 1 rejects (`/etc/passwd.md`, `../x.md`, `a/../../b.md`,
      `~/x.md`, `https://evil.example/plan.md`) is still rejected, and a remote URL still never
      becomes a local file read. — those `helpers` cases are **unedited** and green; a traversal
      arriving *through* a blob URL was added beside them
- [x] A body that only says "updated README.md" does not earn `high`. — `intent.it:246`,
      `helpers` § "refuses a root boilerplate document as a plan, but not one in a folder"
- [x] With an intent present, findings the reviewer labels `out` are dropped unless CRITICAL;
      of the out-of-scope CRITICALs exactly one survives; every drop appears in the Live Log
      and the count in `RunStats.scope_gate`. — `reviewer-core/test/scope-gate.test.ts` for the
      rule, `intent.it:530` for the wiring end to end (4 findings in, 2 persisted, both drops
      in the trace's log, `scope_gate` = `2/4 in scope; 1 out-of-scope CRITICAL kept as the
      signal`)
- [x] **Regression:** with no intent, the assembled prompt is byte-identical to Round 1's and
      the gate changes no finding set. — `prompt.test.ts:159` (the literal, unedited) and
      `prompt.test.ts` § "emits no scope rule when there is no intent to be in or out of"
- [x] A finding with no `scope` label is kept, whatever its severity. — `scope-gate.test.ts`
      § "keeps an unlabelled finding whatever its severity" (`undefined` and `null` both)
- [x] The review's score is computed from the findings that survived the gate, not from the
      pre-gate set. — `review/run.ts`: `scoreFromFindings(scoped.kept)`
- [x] The derivation's log line and the `POST` route's pino line carry token counts, the model,
      the sources, the missing context and a block inventory (kind + size), and carry no secret
      and no diff content. — `intent.it:396`, and `helpers` § `describePromptBlocks` asserts the
      negative directly (no character of a plan, a body, a commit subject or a path survives).
      Read by eye once: `blocks: plan_file×1 (62), issue #471 (20), body (56), commits×2,
      files×2 (+2 hunks), missing_context×1`
- [x] The Intent card shows the model, the token counts and the cost, or `unpriced` where the
      model has no price. — `IntentCard.test.tsx`, three cases: priced, null, and a genuinely
      free `$0.00`
- [x] `docs/agent-prompts/README.md`'s ordered section list names `## PR intent (derived)` in
      the position `prompt.ts` actually emits it. — added after `## PR description`, before
      `## Skills / rules`; `agent-prompts-mirror.test.ts` still green
- [x] A read-only agent's `Bash` cannot write: the guard denies a redirection, `rm`, `sed -i`
      and `git commit`, and allows `cat`, `grep`, `sed -n`, `git log`, `pnpm test`,
      `pnpm arch:check`. — `server/test/readonly-agent-guard.test.ts`, 49 cases over the three
      agents, the four agents it must not touch, and the main session
- [x] Every `vendor/shared` file this round touches is byte-identical across the two copies.
      — `diff -q` on `review-api.ts`, `findings.ts`, `trace.ts`, all silent
- [x] `pnpm arch:check` **output** is empty for `server/` (read the output, never the exit
      code). — `✔ no dependency violations found (167 modules, 552 dependencies cruised)`

### Lanes, Step R2-7

| Lane | Result |
|---|---|
| `server` typecheck | clean |
| `server` unit | 301 passed (219 at the start of Round 2) |
| `server` `.it` (Docker) | 90 passed / 10 files |
| `server` `arch:check` | no violations, 16 known ignored — unchanged all round |
| `client` typecheck + test | 236 passed (229 at the start) |
| `reviewer-core` test + typecheck | 49 passed (39 at the start) |
| `e2e:hermetic` | 8/8 flows |
| `vendor/shared` mirrors | `review-api.ts`, `findings.ts`, `trace.ts` identical |

## Test plan

| Suite | Covers |
|---|---|
| `server/test/intent-helpers.test.ts` (unit) | the hunk-header renderer (no `+`/`-` lines, caps, the `… N more` tail); `@@`-only extraction from a patch; the ticket-word regex incl. the bare-`#5` refusal; blob-URL → path for this repo and the discard for another; D21's boilerplate rule; the widened `renderIntentForPrompt` (missing context appears, raw source text still does not) |
| `server/test/intent.it.test.ts` (**Docker**) | headers reach the model on both paths, including a null-patch `pr_files` row; `missing_context` is persisted, returned by `GET` and named for an unreadable plan file; a ticket-word issue is fetched; the log line carries tokens; every Round 1 case still passes |
| `reviewer-core/test/prompt.test.ts` (unit, npm) | the scope rule renders only with an intent; the byte-identical no-intent literal; section order unchanged |
| `reviewer-core/test/scope-gate.test.ts` (new, unit) | 1 in-scope + 2 out CRITICAL + 3 out WARNING → 2 findings and one CRITICAL signal; unlabelled findings survive; the gate is a no-op with no labels; the summary string |
| `client/…/IntentCard/IntentCard.test.tsx` | the missing-context row renders and is absent when the list is empty; the cost/token line; `unpriced` when `cost_usd` is null |
| `client/…/RunTraceDrawer/RunTraceDrawer.test.tsx` | the scope-gate stat renders beside grounding when present, and is absent on a historical trace without the key |
| `server/test/readonly-agent-guard.test.ts` (new, unit) | the guard's allow/deny table |
| `e2e/specs/02-repo-pulls-detail.flow.json` | unchanged unless a seed literal moves; if it does, the grep obligation in root `CLAUDE.md` § Gotchas applies again |

## Risks

- **The scope gate is the only change here that can REMOVE something a user previously saw.**
  Mitigated by three properties, each testable: inert without an intent, never removes every
  CRITICAL, and every drop is written to the Live Log and counted in the trace. If it proves
  too aggressive in practice, the honest fix is to stop dropping and only mark — that reversal
  is one `filter` away, which is why the label is a contract field and the decision is not.
- **`Finding.scope` widens the structured-output schema for every agent and every provider.**
  A model that ignores it returns nothing there and the gate stays inert for that finding —
  the designed default, not a failure. Watch the first live runs for schema-adherence retries.
- **`ADD COLUMN … NOT NULL` needs its default, and `pr_intent` is no longer provably empty** —
  Round 1's seed writes a row (`seed.ts:520-593`). The new column follows `in_scope`'s shape
  (`schema/reviews.ts:65` — `notNull` with a `'[]'::jsonb` default), and Step R2-2 checks
  `select count(*) from pr_intent` on the target DB before generating anyway.
- **Blob-URL rewriting runs before the URL erase**, which is the one ordering that can
  reintroduce "a remote URL became a local read". The existing test for that property must stay
  green *unchanged*; if it needs editing to pass, the implementation is wrong, not the test.
- **The `.it.test` lane needs Docker and was not re-run during the audit.** Re-run it before
  trusting any "unchanged" claim about Round 1 behaviour.
- **`waitForPrRuns` returns instead of throwing on timeout** (server `INSIGHTS.md` 2026-08-07):
  a failing intent `.it.test` may be lane timing. Re-run the file alone first.

## Open questions

- **Answered — per-agent frontmatter hooks. There are none.** Checked against the installed
  CLI (2.1.240) in Step R2-6: the subagent definition schema carries `description`, `tools`,
  `disallowedTools`, `prompt`, `model`, `mcpServers`, `criticalSystemReminder_EXPERIMENTAL`,
  `skills`, `initialPrompt`, `maxTurns`, `background`, `memory`, `effort`, `permissionMode`,
  `observer` and `observerMessage` — no `hooks:` field. The claim standing in
  `architecture-reviewer.md` and `.claude/agents/README.md` was half right: `disallowedTools`
  is real, a scoped `hooks:` block is not. The named fallback works and is what shipped: the
  common hook payload builder puts `agent_type` on every event including `PreToolUse`, so
  `scripts/readonly-agent-guard.sh` is registered once and filters by agent itself.
- **Still open — `MAX_HUNK_HEADERS_PER_FILE`** is 8 with nothing behind it, the same status
  `MIN_SUBSTANTIVE_BODY_CHARS` carries. The first real derivations settle both.
- **New — nothing pins `review_intent`'s registry default to `DEFAULT_INTENT_MODEL`.** Three
  copies agree today (`intent/constants.ts:34`, `contracts/platform.ts:53`,
  `client/src/lib/feature-models.ts:22`) and a comment asks the next person to keep them in
  step. This repository's own `INSIGHTS.md` says that is not enough — "a prompt that lives in
  two hand-synced files needs a test, not a comment" (server, 2026-08-06). The same is true of
  a model id, and `conventions` has the identical gap.
- **New — nothing exercises a 429.** Both `POST /pulls/:id/intent` and `POST /pulls/:id/review`
  declare a rate limit and no suite has ever proven one fires.

## Implementation plan

Order is cheapest-and-safest first; the gate is last of the substantial steps because it is the
only one whose effect a user sees in the findings list. Each step ends on a green lane and is
committable on its own.

### Step R2-1 — Hunk headers into the classifier · package: server
Files:  `server/src/modules/intent/constants.ts` (edit) ·
        `server/src/modules/intent/helpers.ts` (edit) ·
        `server/src/modules/intent/service.ts` (edit) ·
        `server/src/modules/reviews/run-executor.ts` (edit, `:357-380`) ·
        `server/test/intent-helpers.test.ts` (edit) · `server/test/intent.it.test.ts` (edit)
Skills: typescript-expert, onion-architecture
Do:     Add `MAX_HUNK_HEADERS_PER_FILE` (8) with the doc comment that explains the number.
        In `helpers.ts` introduce
        `interface IntentChangedFile { path: string; additions: number; deletions: number; hunkHeaders: string[] }`
        and render the `## Changed files` block as `path (+a/-d)` followed by its headers,
        one per line, with a `… N more hunk(s)` tail past the cap (D13). Widen
        `IntentPromptInput.changedPaths` into `changedFiles: IntentChangedFile[]`.
        `IntentService.forReview(ws, pull, changedFiles)` takes the new shape; `derive()`
        builds it from `pr_files` — `patch` filtered to `/^@@ /` lines only, and a null patch
        yields an empty header list, never a skipped file. `run-executor.ts:367-371` maps
        `diff.files` into it, synthesising each header from the hunk's four numbers.
Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' intent-helpers` green,
        with a case asserting the rendered block contains `@@` and **no** line starting with
        `+` or `-`; `pnpm typecheck`;
        `pnpm arch:check 2>&1 | grep -c "no dependency violations found"` is 1
Depends: none

### Step R2-2 — `missing_context`: persisted, prompted, rendered · package: server + client
Files:  `server/src/vendor/shared/contracts/review-api.ts` (edit) + the client mirror ·
        `server/src/db/schema/reviews.ts` (edit) · `server/src/db/migrations/00NN_*` (generated) ·
        `server/src/modules/intent/{helpers,service,routes}.ts` (edit) ·
        `server/src/db/seed.ts` (edit — the demo row gets an empty list) ·
        `client/…/IntentCard/{IntentCard.tsx,styles.ts}` (edit) ·
        `client/messages/en/prReview.json` (edit) ·
        `client/…/IntentCard/IntentCard.test.tsx` (edit) · `server/test/intent.it.test.ts` (edit)
Skills: zod, drizzle-orm-patterns, postgresql-table-design, design-reference, react-best-practices
Do:     Add `missing_context: z.array(z.string())` to `PrIntentRecord` (both copies) and
        `missingContext` to `prIntent`, shaped like `inScope` (`schema/reviews.ts:65`):
        a `jsonb().$type<string[]>()` column, `notNull`, defaulting to `'[]'::jsonb`. Check
        `select count(*) from pr_intent` before `pnpm db:generate`, then `pnpm db:migrate`
        manually. `gather()`'s `notes` become the persisted list; `buildIntentPrompt` gains a
        **trusted** (unwrapped, ours) block naming what could not be read and forbidding
        reconstruction; `renderIntentForPrompt` adds a `Missing context:` line so the reviewer
        sees it too; the `POST` route's pino line carries it. The card renders the list as a
        muted warning row under the scope grid — no new primitive, no `vendor/ui` edit.
Verify: `diff -q` on `review-api.ts` between the two copies prints nothing;
        `cd server && pnpm db:migrate` clean; `pnpm exec vitest run --exclude '**/*.it.test.ts'`;
        `cd client && pnpm test && pnpm typecheck`;
        `grep -c "DROP COLUMN" <the new sql>` is 0
Depends: R2-1 (same helper signatures)

### Step R2-3 — Ticket references and this repo's blob URLs · package: server
Files:  `server/src/modules/intent/constants.ts` (edit) · `helpers.ts` (edit) ·
        `service.ts` (edit) · `server/test/intent-helpers.test.ts` (edit) ·
        `server/test/intent.it.test.ts` (edit)
Skills: typescript-expert, onion-architecture, security
Do:     Add `TICKET_REF_RE` (the ticket-word forms of D15), `GITHUB_BLOB_URL_RE` and
        `BOILERPLATE_DOC_NAMES` (D21). `extractLinkedIssue` resolves closing-keyword **and**
        ticket-word references, this repo only, cross-repo still discarded.
        `extractPlanPaths` rewrites a matching blob URL to its repo-relative path **before**
        the URL erase, and refuses a root boilerplate document. Every reference that resolves
        to nothing — unreadable file, unreachable issue, another repo's blob URL — is appended
        to `missing_context` by the service, never dropped.
Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' intent-helpers` green
        with **every Round 1 traversal case unedited**; `pnpm typecheck`; arch:check output empty
Depends: R2-2

### Step R2-4 — Tokens and prompt composition in the logs · package: server + client
Files:  `server/src/modules/intent/service.ts` (edit, `:205-217`) · `routes.ts` (edit, `:52-63`) ·
        `client/…/IntentCard/IntentCard.tsx` (edit) · `client/messages/en/prReview.json` (edit) ·
        `client/…/IntentCard/IntentCard.test.tsx` (edit)
Skills: fastify-best-practices, react-best-practices
Do:     The derivation's log line and the route's pino object gain `tokensIn`/`tokensOut` and a
        **content-free block inventory** — kind and size only, e.g.
        `blocks: plan_file×1 (3.2k), issue #471 (1.1k), body (840), commits×7, files×12 (+31 hunks)`.
        No body text, no issue text, no diff, no secret: the inventory is counts and labels.
        The card gains the cost/token line Round 1's D6 promised, printing `unpriced` when
        `cost_usd` is null (never `$0.0000` — null and free are different facts).
Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`;
        `cd client && pnpm test && pnpm typecheck`;
        read one `POST /pulls/:id/intent` log line by eye and confirm it carries no source text
Depends: R2-2

### Step R2-5 — The scope gate · package: reviewer-core + server + client
Files:  `server|client/src/vendor/shared/contracts/findings.ts` (edit, `Finding`) ·
        `server|client/src/vendor/shared/contracts/trace.ts` (edit, `RunStats`) ·
        `reviewer-core/src/scope-gate.ts` (new) · `reviewer-core/src/prompt.ts` (edit, `:145-150`) ·
        `reviewer-core/src/review/run.ts` (edit, `:206-220`) · `reviewer-core/src/index.ts` (edit) ·
        `reviewer-core/docs/prompt-contract.md` (edit) ·
        `reviewer-core/test/prompt.test.ts` (edit) · `reviewer-core/test/scope-gate.test.ts` (new) ·
        `server/src/modules/intent/helpers.ts` (edit — D19's note correction) ·
        `server/src/modules/reviews/run-executor.ts` (edit — log drops, persist the stat) ·
        `client/…/RunTraceDrawer/_components/TraceBody/TraceBody.tsx` + `runs.json` (edit) ·
        `client/…/RunTraceDrawer/RunTraceDrawer.test.tsx` (edit)
Skills: onion-architecture, typescript-expert, zod, react-testing-library
Do:     `Finding.scope: z.enum(['in','out']).nullish()`, documented as *the reviewer's own
        judgement about the change, never the author's claim* (D17). `RunStats.scope_gate:
        z.string().nullish()`. In `assemblePrompt`, the trusted scope rule renders **inside the
        intent section and only when an intent is present**, so the no-intent prompt stays
        byte-identical. `scope-gate.ts` mirrors `grounding.ts`'s shape exactly —
        `{ kept, dropped: { finding, reason }[] }` plus a summary string — and implements D18's
        rule. `run.ts` applies it after grounding, scores from the survivors, and returns the
        summary and the drops in `ReviewOutcome`. `run-executor.ts` emits one Live Log line per
        drop and writes the summary into the persisted stats beside `grounding` (`:273,294`).
        Correct `renderIntentForPrompt`'s closing clause (D19).
Verify: `cd reviewer-core && npm test && npm run typecheck` — including the pinned
        byte-identical no-intent literal; `cd server && pnpm typecheck &&
        pnpm exec vitest run --exclude '**/*.it.test.ts'`;
        `pnpm arch:check 2>&1 | grep -c "no dependency violations found"` is 1;
        `cd client && pnpm test && pnpm typecheck`;
        per-file `diff -q` on `findings.ts` and `trace.ts` across the two copies
Depends: R2-2 (the intent slot's rendered text changes in the same file)

### Step R2-6 — The two final-check items the brief names · package: docs + `.claude/agents`
Files:  `docs/agent-prompts/README.md` (edit, `:41-52`) ·
        `.claude/agents/{architecture-reviewer,plan-verifier,researcher}.md` (edit) ·
        `.claude/agents/README.md` (edit, § Permissions) ·
        `scripts/readonly-agent-guard.sh` (new) · `server/test/readonly-agent-guard.test.ts` (new)
Skills: —
Do:     Add `## PR intent (derived)` to the README's ordered section list in the position
        `prompt.ts` emits it (after `## PR description`, before `## Skills / rules`). Then
        answer the Open question about per-agent `hooks:` support before writing anything:
        with support, scope the `PreToolUse` guard to the three agents in their own
        frontmatter; without it, register one repo-level hook that reads the agent name from
        the payload. The guard denies mutation (`>`/`>>`, `rm`, `mv`, `cp` onto tracked paths,
        `sed -i`, `tee`, `truncate`, `git add|commit|checkout|restore|push`, `npm|pnpm install`)
        and allows the read/verify set the agents actually run. Rewrite
        `architecture-reviewer.md:32-46` to describe what is now enforced, and keep the honest
        register — the paragraph is a good one, it is just out of date once this lands.
Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' readonly-agent-guard`;
        invoke `architecture-reviewer` on a trivial scope and confirm a denied write is
        reported by the hook, not by the agent's own restraint
Depends: none (independent of R2-1…R2-5)

### Step R2-7 — Close the round · package: all
Files:  `specs/L03-intent-layer.md` (this file — statuses) · `specs/README.md` (index row) ·
        `INSIGHTS.md` / package `INSIGHTS.md` via `/engineering-insights`
Do:     Tick the acceptance criteria against evidence, set Round 2's status, and record what
        this round taught — at minimum: a plan's § Out of scope is a decision about *effort*,
        never about the *brief*, and the two must be diffed explicitly before a lesson is
        called done.
Verify: the full Handoff command set below, all lanes green
Depends: R2-1 … R2-6

## Deviations from the plan as written

Five, each an in-step refinement rather than a change of scope. Recorded because a plan whose
deviations go unwritten is a plan the next round cannot trust.

**R2-1 — `forReview` takes `UnifiedDiff['files']`, not the mapped shape.** The step said
`run-executor.ts` maps `diff.files` into `IntentChangedFile[]` and synthesises each header. That
puts the header FORMAT in `modules/reviews/`, outside the unit suite that pins it, and moving it
to a shared helper would need a cross-module import (`no-cross-module-import`). Both mappings —
synthesised from a parsed diff, quoted from a stored patch — now live in the intent module's
helpers, and `run-executor.ts` never learns what a header looks like.

**R2-2 — the short-description note quotes no threshold.** A number spelled into a persisted
sentence is a second copy of `MIN_SUBSTANTIVE_BODY_CHARS`, which `seed.ts` would also hold and
nothing would keep in step.

**R2-2 — the demo row seeds the note it earns, not an empty list.** The step said empty. The
demo PR's body is 95 characters, under the threshold, so a real derivation produces one note;
seeding `[]` would make the first Re-derive add a warning row out of nowhere — the failure the
seed's own comment block already reasons about for the tier.

**R2-3 — one Round 1 test changed.** `'Related to #5.' → undefined` was asserted under the
title "requires a closing keyword". D15 lists `Related to` among the ticket words, so that
assertion IS the rule Round 2 reopens. `see #5`, `the #5 attempt` and `GH-471` still resolve
nothing, and the test now names the rule it pins. Every `extractPlanPaths` traversal case is
unedited.

**R2-5 — the `Scope gate:` log line is conditional.** Emitted only when the model actually
labelled something `out`. The summary is persisted either way; a run whose prompt carried no
intent would otherwise announce "8/8 in scope" about a question nobody asked.

## Status

**Round 2 is complete.** Every acceptance criterion above is ticked against named evidence,
with the two half-proven Round 1 items and the two new Open questions stated rather than
rounded up. Six commits, `151bc2c` … `783db27`, each on a green lane:

| Commit | Step |
|---|---|
| `151bc2c` | R2-1 — hunk headers into the classifier |
| `47ff38b` | R2-2 — `missing_context` persisted, prompted, rendered |
| `c303400` | R2-3 — ticket references, this repo's blob URLs, D21 |
| `9b87e83` | R2-4 — tokens and prompt composition in the logs |
| `8442ce9` | R2-5 — the scope gate |
| `783db27` | R2-6 — the read-only agent boundary, and the section list |

**L03 is not finished.** Smart Diff is the other half of the lesson's row in
[`README.md`](README.md) and has no spec yet.

## Handoff

Plan file:      `specs/L03-intent-layer.md` (this Round 2 section)
Entry point:    Step R2-1
Verification:   `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm exec vitest run .it.test && pnpm arch:check 2>&1 | grep -c "no dependency violations found"`
                `cd client && pnpm test && pnpm typecheck`
                `cd reviewer-core && npm test && npm run typecheck`
                `cd e2e && pnpm e2e:hermetic`
                per-file `diff -q` on every `vendor/shared` file this round touched
                (`review-api.ts`, `findings.ts`, `trace.ts`) — must print nothing
Deviation policy: stop at the step, report the divergence, finish the independent steps.
                  Do not re-plan.
