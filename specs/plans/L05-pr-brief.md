# Implementation plan — L05 PR Brief (Why + Risk)

Spec: [`../L05-pr-brief.md`](../L05-pr-brief.md) · Spec ID `L05-PR-BRIEF` · Branch: `lesson-05`

Eleven steps, eleven commits. The tree is clean at `c83f260` (`git status --porcelain` empty),
so nothing below has to work around uncommitted work.

## Requirements review

Every claim here was checked against the tree at `c83f260`, not remembered. `file:line` is
where it was checked.

### Contradictions — raised, and closed in the spec

- **AC-04 / AC-05 against § Non-functional requirements, row "`GET` cost" — RESOLVED.** As
  written at `c83f260` that row promised *"zero model calls, one query for the newest row plus
  one for the timeline"*. AC-04 defines `stale` as "the stored `state_key` differs from the
  `state_key` **recomputed from current inputs**", and AC-05 fixes `state_key` as the SHA-256
  of the fully assembled, fully trimmed model input. Recomputing that needs the intent row, the
  blast map, `pr_files`, the enabled Project Context documents and — when the body links one —
  a GitHub issue fetch. It could not be two queries and it was not free of network I/O, so both
  could not hold.
  **Returned to `spec-creator`, and the row is now rewritten.** The criteria bound, because they
  are criteria and the row was prose: `GET /pulls/:id/brief` runs the whole assembler and makes
  **zero model calls** — which is what AC-02 and AC-07 actually assert, and the only claim that
  matters for cost. The spec's § Risks now carries the GitHub-outage consequence too. Nothing in
  this plan moved: Step 5's `read(ws, prId)` was already written to assemble-and-hash.
  The two consequences the plan carries, now also carried by the spec:
  1. A GitHub outage makes the recomputed key differ from the stored one, so a brief reads
     `stale: true` until GitHub answers again. Over-reporting, not under-reporting — and the
     spec's own Risks row ("the cost of over-sensitivity is a banner rather than a bill")
     already accepted exactly this trade before it said so explicitly.
  2. The issue fetch is only reached when `extractLinkedIssue(body, repoFullName)` returns a
     number (`modules/intent/helpers.ts:169-179`). Most pull requests link none, and the demo
     PR links none — its seeded `sources` are `pr_title, commits, branch, file_paths`
     (`seed.ts:899`) — so the common `GET` makes no network call at all.

### Defects in this plan, found by cross-model review

Reviewed by `openai/gpt-5.1-codex-max` — a different model family from the one that wrote the
plan, which is the whole point: every gate this plan specifies was written by the same author
as the defects below. **Five rounds, and the loop is closed** — same reviewer and same prompt
each time, each run over the plan the previous round corrected, and each confirming the last
round's fix before finding the next defect. Rounds 1 to 3 were all the same shape — an instruction that reads
correctly and cannot be executed, which is the failure mode a plan is uniquely good at
producing and uniquely bad at catching in itself. Round 4 is a different and worse shape: not
an instruction that fails, but a **gate that is missing**, where the plan and every check in it
agree with each other and disagree with the spec.
The record notes where the reviewer was **wrong** as well as where it was right; a review log
that only lists hits is a worse guide to how much to trust the next one.

- **Round 1 · BLOCKER — `read` was specified without the trim ladder, which would have made
  every trimmed brief permanently stale. Fixed in Step 4 and Step 5.** The plan as written gave
  `generate` *"assemble → `trimToBudget` → `stateKeyOf`"* and gave `read`
  *"assemble, hash, compare"*. AC-05 fixes `state_key` as the hash of the input
  **after** trimming, so on any pull request large enough to fire a single rung the two paths
  hashed different strings, `stale` was `true` on every read, and pressing Regenerate could
  never clear it. It was invisible in every gate this plan already had: PR #482 has nine files
  against a `BRIEF_TRIM_MAX_FILES` of 12, so the ladder is a no-op on the demo, the e2e flow
  passes, and the integration lane passes unless a fixture is deliberately built over budget.
  It would have failed first on a real large PR, in front of a user.
  **Fix, and why this form:** the ladder is no longer a step a caller may forget. `briefStateOf`
  owns *assemble → trim → hash* as one function, and both `read` and `generate` call it — a
  guarantee an edit cannot undo, where two call sites that agree today are only a coincidence
  that has already failed once here. It is the same discipline § Coverage applies to AC-19:
  put the invariant in one place and let the callers inherit it. Step 5's `Verify` pins it with
  `grep -c "briefStateOf" … → 2`, Step 4's with a grep proving the service reaches neither
  `assembleBriefInput` nor `trimToBudget` directly, and Step 6 gains the integration case that
  would have caught it — an over-budget fixture `POST`ed and read back at `stale: false`.
- **Round 2 · MAJOR — the budget was never said to be counted over system + user, so every
  gate agreed with the wrong arithmetic. Fixed in Step 4 and Step 6.** AC-10 is explicit —
  *"порахованих `container.tokenizer.count` над КОНКАТЕНАЦІЄЮ system-повідомлення й
  user-повідомлення"* — and the plan said it in exactly one place, about the **hash**
  (`state_key` is the SHA-256 of `system + user`), and nowhere about the **budget**.
  `trimToBudget(parts, count, budget)` read as "trim the user parts to budget", `inputTokens`
  and `overBudget` were never said to be measured over anything in particular, and Step 6's
  assertion was phrased as "the string handed to the provider". An implementer would have
  counted the user string, and every check in this plan would have agreed with them while the
  real system+user total sat above 8 000. The reviewer stated it more broadly than the text
  warranted — the hash was already right — but the accounting gap is real.
  **Fix:** `system` becomes a parameter of `trimToBudget`, so the ladder cannot be blind to the
  half it does not trim; `inputTokens` is defined as the number `overBudget` is decided against
  and AC-14 persists; and both Step 4's fixture and Step 6's assertion name the concatenation
  rather than "the input". The subtlety written down with it is the one that makes this
  silently recur: `count(system) + count(user)` is **not** `count(system + user)`, because BPE
  merges across the join — summing is the more natural code and it is the wrong number.
  The fixture that makes the criterion falsifiable is Step 4's system-heavy one: a ladder that
  counted only the user half would leave it untrimmed and fail rather than pass.

- **Round 3 · BLOCKER — the card was told to call a callback no step handed it. Fixed in
  Step 8 and Step 9.** Step 9's `Do:` said a review-focus row navigates by "calling the page's
  `openFile`", but `page.tsx` was in neither Step 9's `Files:` nor its `Do:`, and
  `OverviewTabProps` is `{ prId, prBody }` with no callback slot
  (`OverviewTab/OverviewTab.tsx:8-11`). Nothing threaded `openFile` from the page through the
  tab into the card, so AC-33 and AC-34 were unbuildable as written: the card would have called
  a prop it is never given.
  **Fix:** Step 9 owns **both ends** of the chain — `page.tsx` defines `openFile` and passes it
  into `<OverviewTab …>`, `OverviewTab` forwards it, `PrBriefCard` calls it — on the precedent
  `onOpenFinding` already sets (`page.tsx:220` → `DiffTab.tsx:28,37,93` → `SmartDiffViewer`),
  rather than a second convention. Two decisions were taken with it:
  1. **`openFile`'s definition moved from Step 8 into Step 9**, which is more than the finding
     asked for and follows from this plan's own rule. Step 8 shipping an `openFile` with no
     caller would be dead code in the exact commit whose boundary is justified by "nothing dead
     ever ships". The split is now clean: Step 8 makes the URL **consumed** (live the moment it
     lands — a reader can type the URL), Step 9 makes it **produced**. `Covers:` follows —
     AC-33's landing half is Step 8's, its navigation half is Step 9's.
  2. **The prop is required, not optional.** `DiffTab` declares `onOpenFinding?:`, and copying
     the `?` is what would let this defect come back silently: an unpassed optional callback
     compiles and the button quietly does nothing. `onOpenFile` has no `?` at any hop, so
     `pnpm typecheck` is the gate — the same reasoning that put the ladder inside
     `briefStateOf` in round 1, applied to a prop instead of a function.
  **The sweep the finding earned.** Every symbol Step 9's `Do:` names was checked against a
  provider, since this was the second instruction in a row that read correctly and could not be
  run. One more instance, minor and compile-visible rather than silent: `RiskPillRow` is a
  **design-reference** component, not a `@devdigest/ui` one
  (`grep -rn "export .*RiskPillRow" client/src/vendor/ui/` → empty), and `vendor/ui/**` is
  do-not-touch, so "adopted as given" could be read as "imported". Step 9 now says it is built
  in `PrBriefCard/_components/RiskPillRow/` from the primitives that do exist — `Card`,
  `Badge`, `SectionLabel`, `EmptyState` and `MonoLink`, each verified present in
  `vendor/ui/primitives/`. Everything else Step 9 names has a provider: `usePrBrief` and
  `useGenerateBrief` are Step 7's and the card calls them directly, as `IntentCard` calls
  `usePrIntent`/`useDeriveIntent`; `prId` already reaches `OverviewTab`; the focus row's
  accessible name is produced here and consumed by Step 10's flow. `OverviewTab.test.tsx` is
  marked **new** — that folder has no test today.

- **Round 4 · MAJOR — the plan's coverage named fewer verification lanes than the spec's own
  `How it is checked` column. Fixed in Step 6 and in the coverage table.** The reviewer's
  finding was that AC-15 demands *"unit-тест grounding-фільтра; `brief.it.test.ts` з відповіддю
  моделі, що містить вигаданий шлях"* — two lanes — while the plan gave it Step 4 alone, so the
  integration case the spec requires existed nowhere and the end-to-end path could ignore the
  allow-list and stay green. **That half is right and is fixed:** Step 6 gains a model reply
  naming an invented path, dropped from the persisted record into `dropped_refs` with the rest
  of the brief surviving, and AC-15 becomes `4, 6`.
  **The reviewer over-reached on AC-16, and the record should say so.** It generalised from
  AC-15 to AC-16, but AC-16's cell reads *"той самий unit-тест, обидві половини"* — **unit
  only**. Adding an integration case there would have been the plan covering more than the spec
  asks, which is harmless in itself but is a criterion invented at plan stage, and this plan's
  own rule is that a spec gap goes back to `spec-creator` rather than into a step. AC-16 stays
  at Step 4, checked and left alone. The two criteria differ because AC-15 is about a
  *reference the model invented* — which only a real reply can produce — while AC-16 is about
  *which half of the allow-list a kind is checked against*, which is a property of the filter
  and is fully decided in a unit test.
  **The class this exposed, and the sweep it earned.** One missing lane is a bug; the ability
  to have one silently is a defect in how this plan was checked. Every gate in the plan is
  written by the plan, so a lane the plan never names is a lane nothing notices is absent. All
  forty-one ids were therefore swept mechanically — each `How it is checked` cell read, its
  lanes enumerated, each lane matched against a step. **Three disagreements, all in the
  plan-covers-less direction:**
  | AC | Lane the spec names | Where the plan had it | Fix |
  |---|---|---|---|
  | AC-15 | `brief.it.test.ts` with an invented path, beside the unit test | Step 4 only — the integration lane was nowhere | Step 6 gains the case; `4` → `4, 6` |
  | AC-39 | `brief.it.test.ts`, beside `pnpm db:seed` twice and the e2e step | Step 10 only — seed and flow were placed, the integration lane was not | Step 6 gains the seeded-row case; `10` → `6, 10` |
  | AC-32 | the visual check against the `pr-overview` artboard, beside the block-order component test | Step 11's `Do:` **named it**, but the coverage table said `9` alone | table corrected to `9, 11`; no work was missing, only its record |
  The other thirty-eight agree. Where the plan covers **more** lanes than the spec asks —
  AC-05 and AC-10 both gain an integration assertion the spec does not require — that is left
  alone: the failure direction is covering less.
  AC-39's fix turned on a fact worth recording, because it was nearly assumed the other way:
  integration files **do** run the real seed. `intent.it.test.ts:65-70` calls
  `await seed(pg.handle.db)` in `beforeAll`, as do nine other `.it.test.ts` files, so the
  seeded `pr_brief` rows are assertable in `brief.it.test.ts` and not only through the browser
  flow. Had that been false, AC-39's integration clause would have been unverifiable as written
  and would have gone back to `spec-creator` instead.

- **Round 5 · MAJOR — AC-13 obliges two channels and its own check names one. Fixed in
  Step 6.** The criterion reads *"Кожне відкидання за бюджетом повинно (shall) потрапити **і в
  лог маршруту, і в поле `trimmed`** збереженого запису — ніколи мовчки"*, while its
  `How it is checked` cell asks only for *"`trimmed` непорожній на фікстурі, що перевищує
  бюджет"*. The plan faithfully covered the lane it was told to, so this is **not** the round-4
  class: round 4's sweep compared the plan against the `How it is checked` column, and here that
  column is itself the thin part. A sweep can only ever be as strong as the thing it compares
  against.
  **Closed in the plan rather than returned to `spec-creator`,** because nothing is ambiguous —
  the obligation is plain and only its verification is thin, and a plan may verify more than the
  spec asks (§ Coverage already names that as the acceptable direction, and AC-05 and AC-10
  already do it). Step 6 asserts the drop appears in the route's log line as well as in the
  stored record.
  **The mechanism was checked before it was written down, not invented.**
  `intent.it.test.ts:430-435` already does exactly this — it replaces `app.log.info` with a
  collector and asserts on the object passed — so no pino transport, no stream capture and no
  new helper is needed. Had nothing in `server/test/**` captured log output, the honest answer
  would have been to say so and fall back to a `Verify` grep; it did not come to that.
- **Round 5 · MINOR — assessed and NOT followed: "no test ensures `GET` stays unthrottled"
  (AC-26).** The reviewer asked for coverage of the `GET` side of the rate-limit rule. Its
  premise is wrong: AC-26's `How it is checked` is *"огляд маршрутів + тест, що 11-й POST за
  хвилину отримує 429"*, so the **route review** is the named lane for the `GET` half and no
  test was ever asked for. An integration test issuing eleven `GET`s would assert the absence of
  a limit by failing to trip it, which is weak evidence, and it would be a lane the spec does not
  carry.
  **But checking it surfaced a real thin spot the reviewer had not named.** Step 5's `Do:` said
  the `GET` carries no rate-limit override, and *nothing checked it* — a lane named by the spec
  and satisfied only by prose, which is the round-4 class arriving through a different door. It
  is now `grep -c "rateLimit" server/src/modules/brief/routes.ts` → **1**, on the `POST`, in both
  Step 5's `Verify` and Step 11's structural pass. The remedy is a grep, not a test; the finding
  is rejected and the gap behind it is closed.

**The loop was stopped here, after five rounds, and the reason is the trend rather than a clean
round.** Three distinct classes of defect surfaced, in order, and each one was invisible to the
check that caught the one before it:

| Rounds | Class | Why the previous defence missed it |
|---|---|---|
| 1–3 | an instruction that reads correctly and cannot be executed | the plan's own gates are written by the plan, and prose compiles for nobody |
| 4 | a gate the plan and all of its own checks agree is present, and the spec says is missing | coverage was checked per criterion, never per **lane** |
| 5 | a criterion whose own verification is weaker than its obligation | the round-4 sweep compares the plan to `How it is checked`, so a thin cell passes |

Severity fell monotonically across the sequence — BLOCKER, BLOCKER, MAJOR, MAJOR, MINOR — and
the last round's only new class was found by *disagreeing* with the reviewer rather than by
following it. That is the signal to stop: the remaining defects are cheaper to find in code than
in prose, and the next line of defence — `implementer`, `architecture-reviewer`, `plan-verifier`
— reads code. A sixth round of prose review would be looking for the fourth class with the third
class's instrument.

### Gaps closed by decision

- **`FeatureModelId` already contains `risk_brief` — RESOLVED, and it produced `AC-41`.**
  `contracts/platform.ts:15-21` is
  `['onboarding', 'review_intent', 'risk_brief', 'conformance', 'conventions']`; the registry
  entry at `:61-67` is `Risk Brief · openai / gpt-4.1`, duplicated in
  `client/src/lib/feature-models.ts:29-34`; and the Settings row is rendered today pointing at
  nothing. So § Out of scope's stated cost — "two `vendor/shared` mirror edits, the client's
  duplicate registry and a Settings row" — was a cost nobody would have paid: all four already
  exist. **Returned to `spec-creator`.** That bullet and the § Non-functional requirements
  `Model` row are now rewritten with the true reason, and the behaviour they imply became a
  criterion of its own, **`AC-41`**, appended without renumbering anything.
  The outcome is unchanged and is what this plan already carried: the module **claims** the
  slot rather than creating it — `container.featureModelOverride(workspaceId, 'risk_brief')`
  first, module-local `BRIEF_MODEL` as the fallback, and never `resolveFeatureModel`, the exact
  shape `modules/intent/service.ts:236-237` and `modules/conventions/service.ts:124-126` both
  use. That is the remedy root `INSIGHTS.md` (2026-08-06) prescribes for a module written after
  the registry: its defaults promise to "mirror each module's constants", and `risk_brief`
  mirrors nothing. The registry default is not hypothetical —
  `server/test/settings-models.it.test.ts:53-57` already asserts
  `resolveFeatureModel(ws, 'risk_brief')` → `openai / gpt-4.1`, which is precisely the model
  AC-41 forbids this feature from buying by accident.
- **`withDeadline` is not shared.** The discipline the spec names for the linked-issue fetch
  lives in `modules/intent/service.ts:97` as a module-**private** function — not exported, and
  importing it would be the cross-module import that only warns. **Decision:** a module-local
  copy in `modules/brief/helpers.ts` with a comment naming its twin. Lifting it to `platform/`
  is a Recommendation, not a step: it would drag `modules/intent` into this diff for six lines.
- **`ReviewRepository.getPrFiles` returns rows in planner order.** `pull.repo.ts:28-33` is
  `db.select().from(t.prFiles).where(eq(...))` with no `orderBy`, while
  `BlastRepository.pathsForPr` sorts by `path` and its doc comment says why: *"an unordered
  list reaches the index as an unordered `IN (...)`, and two identical requests could then
  disagree"*. AC-06 (byte-identical assembly) and AC-08 (the upsert on an unchanged
  `state_key`) both die on planner order. **Decision:** the assembler sorts the file list
  itself — `additions + deletions` descending, `path` ascending as the tie-break — so purity is
  a property of the pure function and does not depend on a repository the brief does not own.
  `getPrFiles` is not modified.
- **The three numbers the spec left open.** Each picked against the precedent the spec names,
  and each lands in `modules/brief/constants.ts` with this reasoning beside it:
  | Constant | Value | Why this number |
  |---|---|---|
  | `BRIEF_MAX_RISKS` | **6** | One per `Risk.kind` value at most, so the design's `RISK_ICON` row can never repeat an icon; and it sits inside the 6–12 band `EXPLAIN_MAX_CALLERS_PER_SYMBOL` (6) and `EXPLAIN_MAX_SYMBOLS` (12) established for "how much of an already-computed set one prompt may carry" (`modules/blast/constants.ts`). |
  | `BRIEF_MAX_FOCUS` | **3** | The feature's own user story says *"which three files to read first"*, and the spec's first UX proposal numbers the rows 1·2·3. A numbered list of three answers "where do I start"; a list of eight is a set again. |
  | `BRIEF_TRIM_MAX_FILES` | **12** | Rung 4's `N`. The same number `EXPLAIN_MAX_SYMBOLS` and `SAMPLE_FILE_COUNT` (`modules/conventions/constants.ts`) both picked for "how many units of a computed list a prompt carries", and it exceeds the demo PR's nine files (`seed.ts:81`, `PR_482_FILES`) so this rung never binds on the demo. The dropped tail is replaced by a counted "… N more files" line — the `EXPLAIN_MAX_*` doc comment's own rule: *"the counts are stated, so the model is never left to imply it saw everything"*. |
  | `BRIEF_TIMEOUT_MS` | **60_000** | `INTENT_TIMEOUT_MS` exactly (`modules/intent/constants.ts:301`): the same shape of call — one synchronous structured POST a human is watching a spinner for, a few thousand tokens in and a small object out. Copies that constant's warning verbatim in its own words: it is honoured by the OpenAI and Anthropic adapters, and **not** by `OpenRouterProvider`, the default, which fixes its timeout at construction (90 s) and ignores `req.timeoutMs` — root `INSIGHTS.md`, 2026-08-06. Not fixed here; the fix belongs where `Container.buildLlm` constructs the provider. |
  | `BRIEF_ISSUE_TIMEOUT_MS` | **3_000** | `INTENT_ISSUE_TIMEOUT_MS` exactly, for its stated reason: an enrichment must never be able to hang the request a human is waiting on. |
- **`seq`'s type is not stated.** AC-27 needs an order that survives two inserts in one
  transaction, which is why it exists at all (`defaultNow()` is the transaction's timestamp,
  root `CLAUDE.md` § Gotchas). **Decision:** a table-wide `serial` — the sequence allocates
  outside the transaction, so two rows written together get strictly increasing values with no
  read-modify-write race. Per-PR numbering (1·2·3 on the card) is derived in code from the
  ordered list, never stored.
- **Re-seeding must not renumber the timeline.** The seed upserts on `(pr_id, state_key)`
  (AC-39, and the `pr_intent` precedent at `seed.ts:929-936`). Its `onConflictDoUpdate` `set`
  clause must **exclude `id` and `seq`**, or a second `pnpm db:seed` reorders the Why Timeline.
  Stated in Step 10 rather than discovered by it.

### Ambiguities, each with the reading taken

- **Focus when there is no smart diff.** `DiffTab.tsx:79-96` renders `SmartDiffViewer` only
  when `smartDiff.groups.length > 0`; otherwise the flat `DiffViewer`. The spec names
  `DiffTab → SmartDiffViewer → FileCard` and no criterion covers the fallback. **Taken:**
  AC-35's notice lives in `DiffTab`, above both branches, so an unknown path is always
  reported; the jump-and-highlight is wired through `SmartDiffViewer` only, as the spec names.
  On the flat fallback the Files tab opens and nothing jumps. Said out loud rather than
  silently.
- **Which `brief.json` keys move.** The namespace exists unused (`client/messages/en/brief.json`)
  and § Out of scope keeps `why.*` untouched, while § Edge cases reuses `noRisks`.
  `unavailableHint` reads *"Run a review or open the PR to compute it."* — after this feature
  that is **false**: only the button computes a brief. **Rule taken:** a key this feature
  renders must be true; a key it does not render is left exactly as it is. So `unavailable` /
  `unavailableHint` are corrected, `noRisks` is reused, and `block.*`, `noHistory`, `overlap`
  and `why.*` are untouched — they belong to `HistoryAccordion` and git-why, both out of scope.
  This is the `client/INSIGHTS.md` 2026-08-29 lesson applied: *a message file is the only place
  a removed feature can still make a factual claim to the user.*
- **Where `PrBriefRecord` lives.** § In scope says "`@devdigest/shared`" without naming a file,
  and AC-40 names two. **Taken, on the existing split:** the building blocks — `Risk.kind`'s
  narrowing and `ReviewFocusItem` — go in `contracts/brief.ts` beside `Risk`; the persisted and
  transported shapes — `PrBriefRecord`, `PrBriefTimelineEntry`, `PrBriefDelta`,
  `PrBriefResponse` — go in `contracts/review-api.ts` beside `PrIntentRecord` (`:69-117`) and
  `BlastRadiusResponse` (`:165-172`), which are the same kind of thing for the same reason.

### Verified rather than assumed

- **All three AC-40 file pairs are byte-identical today.** `cmp -s` is silent for
  `contracts/brief.ts`, `contracts/review-api.ts` and `index.ts`. Tree-wide, exactly three
  files differ — `adapters.ts`, `contracts/productionize.ts`, `contracts/eval-ci.ts` — which is
  the pre-existing drift AC-40 excludes and § Test plan already names.
- **`Risk`, `Risks` and `RiskSeverity` have zero consumers.** `grep -rn "RiskSeverity\|file_refs\|\bRisks\b"`
  over `server/src client/src mcp/src reviewer-core/src e2e` returns only prose in comments and
  the barrel's inventory line. The narrowing therefore breaks no literal, and the producer
  sweep root `INSIGHTS.md` (2026-08-29) mandates — `grep -rn ": Risk = \|: Risk\[\] = "` —
  returns nothing. Step 2 has no fixture tail.
- **The member-name grep is clean.** Root `CLAUDE.md` § Gotchas requires greping the *other*
  contract files for an enum's member names, not for its symbol. `security` and `perf` do
  appear inline in `knowledge.ts:115` (`SkillType`), `productionize.ts:24` and
  `findings.ts:29` (`FindingCategory`) — those are different enums about different things, not
  re-declarations of `Risk`'s shape. Nothing follows `Risk.kind` into another file.
- **`index.ts` is `export *`, so new contracts need no re-export.** Its line 6 inventory
  comment does list `contracts/brief`'s contents; keeping it true is a one-line edit that must
  be mirrored, which is why AC-40's `cmp -s` covers three pairs and not two.
- **`pr_brief` has zero readers and zero writers.** The only non-migration hits are the barrel
  (`db/schema.ts:32,68`) and its own definition (`schema/reviews.ts:120-125`). The table can be
  reshaped without a backfill, and the spec's Risks row about losing it is a statement about an
  empty table.
- **The last migration is `0014`.** Step 1's `pnpm db:generate` emits `0015_*.sql`.
- **The `.it.test` lane holds 14 files.** Step 6 makes it 15 — a **load** change, and the
  2026-08-29 correction to `server/INSIGHTS.md` 2026-08-28 is the one that matters: the
  `skills.it.test.ts` `TypeError` race sits at ~20% at both 13 and 14 files, so *"remove the
  new file and re-run"* passing once proves nothing. Re-run the reduced lane **at least five
  times** before attributing anything to `brief.it.test.ts`.
- **`pnpm typecheck` does not see `server/test/**`.** `server/tsconfig.json` is
  `include: ["src/**/*.ts"]` (`server/INSIGHTS.md` 2026-08-29). A broken server fixture
  surfaces only under vitest, so every server step's gate runs vitest as well as `tsc`.
- **`MockLLMProvider` records every call.** `adapters/mocks.ts:60` — `public calls: {method, req}[]`
  — so AC-01's "exactly one" and AC-02's "zero" are array-length assertions, and its fixed
  `tokensIn: 100` makes AC-14's "the two numbers may differ" trivially demonstrable against our
  own `cl100k_base` count.
- **The card's namespace loads automatically.** `client/src/i18n/request.ts` reads every
  `messages/en/*.json` by directory listing; `brief` is already merged and already unused.

### Ordering constraints the spec implies but does not state

- **Brokering `BlastService` precedes the brief's service**, and the tokenizer's scope
  correction precedes the first count. Both are `platform/container.ts` edits and both are
  Step 3, before any `modules/brief/` file exists.
- **The migration precedes the contract** — not because of a type dependency (there is none:
  `json` is `jsonb`) but because `pnpm db:generate` is the least revertible thing in the plan
  and the sibling plan set that order for the same reason.
- **The seed and the e2e flow are one step.** Root `CLAUDE.md` § Gotchas: after editing
  `seed.ts`, grep `e2e/specs/*.json` for the changed values. Split, the flow asserts literals
  that do not exist yet.

### Unverifiable as written

- **Nothing.** Every `How it is checked` cell in the spec names a command, a grep or a test
  file that this plan places in a step. AC-32's second clause — *"візуальна перевірка проти
  артборда `pr-overview`"* — is a human check, not an automated one; it is named in Step 9 and
  in the Closing step rather than pretended into a test.

## Constraints in force

| Constraint | Source | What it forbids here |
|---|---|---|
| SQL only in `repository.ts`, HTTP only in `routes.ts`, pure transforms in `helpers.ts`, literals in `constants.ts` | `server/CLAUDE.md` § Conventions | a Drizzle query in `modules/brief/service.ts`; the 8 000 inline in `helpers.ts`; the trim ladder reaching for `container.tokenizer` itself |
| Dependencies come from `container`, never by importing a sibling module | `server/CLAUDE.md`; `.claude/skills/onion-architecture` | `modules/brief/**` importing `modules/blast/**` or `modules/intent/**` — hence Step 3 |
| `no-cross-module-import` is `severity: 'warn'`, so `arch:check` **exits 0 on it** | root `INSIGHTS.md` 2026-08-22; `server/.dependency-cruiser-onion.cjs:96` | trusting the exit code — read the output; never append to `.dependency-cruiser-known-violations.json` |
| Every route opens with `getContext(container, req)`; every query is workspace-scoped | `server/CLAUDE.md` § Conventions | resolving a PR any way but `container.reviewRepo.getPull(workspaceId, prId)` |
| A new module is `modules/<name>/routes.ts` plus **one line** in `modules/index.ts` | `server/CLAUDE.md`; `modules/index.ts:31-45` | filesystem autoload; a second registration path |
| Invalid input is rejected with 422 by the route schema before the handler; a criterion naming another status moves the check into the service as `AppError(code, message, status)` | `server/CLAUDE.md`; `server/INSIGHTS.md` 2026-08-29; `platform/errors.ts:7-16` | AC-12 and AC-24 are both 422 and are both thrown from the service — the route schema has no vocabulary for "too large after trimming" |
| A contract edit in `server/src/vendor/shared` requires the mirror edit in `client/src/vendor/shared`, diffed before committing | root `CLAUDE.md` § Gotchas | splitting the mirror across two steps or two commits |
| After editing an enum in `vendor/shared`, grep the other contract files for its **member names**, not the symbol | root `CLAUDE.md` § Gotchas | assuming an import search found every inline re-declaration |
| A field added to a contract that `.parse()`s **persisted JSON** carries `.default()`, or its step owns a backfill | `server/INSIGHTS.md` 2026-08-29 | not binding today — `pr_brief` has zero rows — but `PrBriefRecord` **is** a persisted-snapshot contract, and every later field addition to it is governed by this |
| `.default()` is optional on input and **required** on `z.infer`, so a contract edit owns the sweep of every literal it invalidates | root `INSIGHTS.md` 2026-08-29 | a Step 2 gate that runs `pnpm typecheck` without owning the producers — verified empty here, and stated so the next reader knows the sweep was run |
| `server/src/db/migrations/**` is generated; new migration = `pnpm db:generate`, applied manually with `pnpm db:migrate` | root + `server/CLAUDE.md` § Do not touch | hand-writing SQL; assuming boot migrates |
| A DB test carries the `*.it.test.ts` suffix | root `CLAUDE.md`; `TESTING.md` | putting the route tests in the unit lane |
| Each `.it.test.ts` file starts its **own** Postgres container; 14 today, 15 after Step 6 | `server/INSIGHTS.md` 2026-08-28 + its 2026-08-29 correction; `test/helpers/pg.ts` | reading an unrelated red as a regression after one clean re-run — five runs minimum |
| `pnpm typecheck` does not compile `server/test/**` | `server/INSIGHTS.md` 2026-08-29 | treating a green server `tsc` as evidence the fixtures compile |
| Use `src/adapters/mocks.ts`; do not hand-roll a mock | `server/CLAUDE.md` § Map | a bespoke LLM stub in `brief.it.test.ts` |
| No `fetch` in a component; a new endpoint means a new hook in `client/src/lib/hooks/`, exported through `hooks/index.ts` | `client/CLAUDE.md` § Conventions | the card calling `/pulls/:id/brief` |
| No hardcoded copy in a component — strings live in `client/messages/en/` | `client/CLAUDE.md` § Map | inline English in the empty state or the stale banner |
| Only `<Name>.tsx` and `index.ts` are mandatory in a component folder | `client/docs/component-anatomy.md:20`; `client/INSIGHTS.md` 2026-08-05 | empty `constants.ts` / `helpers.ts` to satisfy the wider rule `client/CLAUDE.md:25-27` states |
| `@testing-library/user-event` is **not installed** | `client/INSIGHTS.md` 2026-08-22 | `userEvent` anywhere — drive interaction with `fireEvent` |
| `client/src/vendor/ui/**` is do-not-touch | root + `client/CLAUDE.md` § Do not touch | any change to `@devdigest/ui` for the card; this plan needs none |
| A flow that clicks one of N identical controls fixes it in the **component**, with a name carrying what it acts on | `e2e/INSIGHTS.md` 2026-08-23 | three review-focus rows sharing one aria-label — each one names its file and line |
| `wait --text` / `wait --url` **are** the assertions; the AI `chat` command is forbidden; flows touch read-only seeded data only | `e2e/CLAUDE.md` § Conventions | a flow step that could trigger a model call |
| `defaultNow()` is the transaction's timestamp | root `CLAUDE.md` § Gotchas | ordering the Why Timeline by `generated_at` — AC-27 is this rule stated as a criterion |
| After editing `seed.ts`, grep `e2e/specs/*.json` for the changed literals | root `CLAUDE.md` § Gotchas | a seed change in one commit and the flow that asserts it in another |
| The design lives at `reference/devdigest-design/` and is never committed or pointed at from a tracked file | user memory; `reference/devdigest-design/CLAUDE.md` | quoting the artboard's path into a repo file |

## Implementation plan

### Gate discipline

Inherited from `specs/plans/L05-project-context-folder.md` § Gate discipline, where both rules
were paid for once:

1. **A step whose `Verify` runs a whole-package gate (`pnpm typecheck`, `pnpm arch:check`,
   `pnpm test`) must own, in its `Files:`, everything that gate covers.** Otherwise the gate is
   narrowed, and the step says in one line which file stays red and which later step closes it.
   In this plan **no step ships a known red** — the producer sweep at Step 2 came back empty,
   which is what makes every gate below honest.
2. **A shared-contract edit owns the producer sweep in the same step.** Run
   `grep -rn ": Risk = \|: Risk\[\] = \|: RiskSeverity = " server/src server/test client/src`
   plus the member-name grep before writing the field, not after the gate goes red.

Two more, specific to this feature:

3. **Read `pnpm arch:check`'s output, never its exit code.** The one rule that would catch
   `modules/brief → modules/blast` is `warn`, and depcruise exits 0 on warnings.
4. **Never run a whole-tree `diff -r` over `vendor/shared`.** Three files differ before this
   work starts. AC-40 is a per-file `cmp -s` over exactly the three pairs this work touches.

### Step 1 — `pr_brief` becomes a history   ·   package: server
Files:    `server/src/db/schema/reviews.ts` (edit — `prBrief`) ·
          `server/src/db/migrations/0015_*.sql` + journal + snapshot (generated, never hand-edited)
Skills:   drizzle-orm-patterns, postgresql-table-design
Do:       Replace the `pr_id`-keyed row with a history: `id` uuid pk `defaultRandom()`;
          `prId` uuid → `pullRequests` `onDelete: 'cascade'` (the cascade the spec's Edge cases
          calls a schema property); `stateKey` text not null; `headSha` text not null;
          `seq` **`serial`** — table-wide, because the sequence allocates outside the
          transaction and two rows written together therefore get strictly increasing values,
          which is the whole of AC-27; `json` jsonb not null; `generatedAt` timestamptz
          `defaultNow()` not null. `uniqueIndex` on `(prId, stateKey)` — AC-08's upsert target.
          `index` on `(prId, seq)` — the timeline read and the 20-cap delete. `db/schema.ts`
          needs **no** edit: it already imports and re-exports `prBrief` (`:32`, `:68`).
          One `pnpm db:generate`, then `pnpm db:migrate` by hand. **Read the emitted SQL**: a
          primary-key change may come out as drop-and-recreate, which is correct and safe here
          precisely because the table has zero writers (verified) — but it must be a decision a
          reader can see, not a surprise.
Verify:   `cd server && pnpm db:generate` adds exactly one `.sql` under `src/db/migrations/` ·
          read that file and confirm the unique constraint on `(pr_id, state_key)` and the
          cascade are both in it · `cd server && pnpm db:migrate` ·
          `cd server && pnpm typecheck` — legal here: this step touches no contract and no
          producer
Covers:   AC-08, AC-27
Depends:  none
Commit:   `feat(db): pr_brief becomes a history, keyed by state and ordered by seq`

### Step 2 — the contracts, both mirrors   ·   package: server + client
Files:    `server/src/vendor/shared/contracts/brief.ts` (edit) ·
          `client/src/vendor/shared/contracts/brief.ts` (mirror) ·
          `server/src/vendor/shared/contracts/review-api.ts` (edit) ·
          `client/src/vendor/shared/contracts/review-api.ts` (mirror) ·
          `server/src/vendor/shared/index.ts` (one comment line) ·
          `client/src/vendor/shared/index.ts` (mirror)
Skills:   zod, onion-architecture
Do:       **The sweep first**, per Gate discipline 2: `grep -rn ": Risk = \|: Risk\[\] = \|: RiskSeverity = " server/src server/test client/src`
          and `grep -rn "db_migration\|breaking_api\|'security'\|'perf'" server/src/vendor/shared client/src/vendor/shared`.
          Both come back empty of anything belonging to `Risk` — verified above — so this step
          has no fixture tail and both typechecks are honest gates.
          In `contracts/brief.ts`: `Risk.kind` narrows from `z.string()` to
          `z.enum(['security','db_migration','breaking_api','perf','deps','other'])`, carrying
          the reason in its doc comment — `RISK_ICON[r.kind]` is an unguarded lookup that an
          open string turns into a crash, and `other` keeps a real risk that fits no icon
          expressible rather than mislabelled. Add `ReviewFocusItem`:
          `{ kind: z.enum(['file','endpoint']), ref: z.string(), line: z.number().int().nullable().optional(), why: z.string() }`,
          with `line` documented as meaningful only for `kind: 'file'`.
          In `contracts/review-api.ts`, beside `PrIntentRecord`: `PrBriefRecord` with `pr_id`,
          `what`, `why`, `risk_level` (= `RiskSeverity`), `risks: z.array(Risk)`,
          `review_focus: z.array(ReviewFocusItem)`, `state_key`, `head_sha`,
          `missing_inputs: string[]`, `dropped_refs: string[]`, `trimmed: string[]`,
          `input_tokens: z.number().int()`, then the accounting block `PrIntentRecord` and
          `BlastExplainResponse` already share — `provider`, `model`, `tokens_in`, `tokens_out`,
          `cost_usd: z.number().nullish()`, `duration_ms`, `generated_at`. Then
          `PrBriefDelta`, `PrBriefTimelineEntry` and
          `PrBriefResponse = PrBriefRecord.extend({ stale: z.boolean(), history: z.array(PrBriefTimelineEntry) })`.
          `input_tokens` and `tokens_in` sit side by side with a doc comment saying they will
          differ and why substituting one for the other would make the budget unfalsifiable
          (AC-14). Note in `PrBriefRecord`'s doc comment that it is parsed back out of
          `pr_brief.json`, so any **later** field needs `.default()` (`server/INSIGHTS.md`
          2026-08-29) — nothing today does, because the table has no rows.
          The legacy `PrBrief` composite at `brief.ts:187-196` is left exactly as it is.
          `index.ts` gains nothing but a true inventory line — `export *` already carries the
          new symbols — and that line is mirrored.
          **Two packages in one step deliberately:** split, the tree is broken in between and
          AC-40 fails in the gap, which is the whole point of the gotcha it comes from.
Verify:   `cmp -s server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` ·
          the same for `contracts/review-api.ts` and for `index.ts` — three silent `cmp`s ·
          `cd server && pnpm typecheck` · `cd client && pnpm typecheck && pnpm test`
Covers:   AC-14, AC-19, AC-40
Depends:  Step 1
Commit:   `feat(shared): the brief's persisted shape, and a Risk kind that cannot crash an icon lookup`

### Step 3 — the container's two corrections   ·   package: server
Files:    `server/src/platform/container.ts` (edit) ·
          `server/src/modules/blast/service.ts` (edit — export `BlastApi`) ·
          `server/src/modules/blast/routes.ts` (edit — take the service from the container, and
          rewrite the header paragraph that explains why it was not brokered) ·
          `server/src/adapters/tokenizer/index.ts` (edit — the scope sentence)
Skills:   onion-architecture, typescript-expert
Do:       `export type BlastApi = Pick<BlastService, 'forPull' | 'explain'>` — the verb-set
          shape, not the class, for the reason `IntentApi` (`intent/service.ts:47`) and
          `ProjectContextApi` (`context/service.ts:62-65`) both give: a class with private
          fields can only ever be satisfied by itself, which is not an override. Add
          `blast?: BlastApi` to `ContainerOverrides` and a lazy `get blast(): BlastApi` beside
          `intent` and `projectContext`, with the doc comment that names *this* feature as the
          second consumer the old comment was waiting for. `modules/blast/routes.ts` drops
          `new BlastService(app.container)` for `app.container.blast` and its header paragraph
          — *"the service is instantiated here rather than brokered … nothing else consumes the
          blast map"* — is rewritten to say what is now true, including why the alternative
          (a direct `modules/brief → modules/blast` import) would have been caught by nobody:
          `no-cross-module-import` is `warn` and depcruise exits on errors alone.
          **The second correction, in the same commit because it is the same claim:**
          `adapters/tokenizer/index.ts`'s *"Scope: in-process, ONLY under modules/repo-intel"*
          and `container.ts`'s *"Token counter (js-tiktoken) for the repo-map budget search"*
          and *"repo-intel T3 adapters — only the indexer pipeline reads these"* are all about
          to be false. Correct all three in place: the counter is the process-wide token
          counter, and `modules/brief` is its second consumer. Note beside the getter that the
          `cl100k_base` fallback to `ceil(chars/4)` is **sticky per instance**
          (`TiktokenTokenizer.broken`), so a process whose BPE load failed counts differently —
          which, for the brief, means it can trim differently and hash differently.
Verify:   `grep -rn "new BlastService" server/src` → only `platform/container.ts` ·
          `cd server && pnpm exec vitest run test/blast.it.test.ts` — the refactor must leave
          the shipped feature green · `cd server && pnpm typecheck` ·
          `cd server && pnpm arch:check` — **read the output**, not the exit code
Covers:   none — enabling work for AC-15, AC-16, AC-23 (the blast half of the allow-list) and
          for AC-10 (the counter)
Depends:  none
Commit:   `refactor(platform): broker the blast map, and stop the tokenizer claiming one consumer`

### Step 4 — everything the brief decides, with no I/O   ·   package: server
Files:    `server/src/modules/brief/constants.ts` (new) ·
          `server/src/modules/brief/helpers.ts` (new) ·
          `server/test/brief-helpers.test.ts` (new, unit — the `blast-helpers.test.ts` /
          `intent-helpers.test.ts` naming)
Skills:   onion-architecture, zod, typescript-expert
Do:       `constants.ts` carries every number and both prompts, on the pattern of
          `modules/blast/constants.ts`: `BRIEF_MODEL` (a `FeatureModelChoice`, the same cheap
          structured-output model `DEFAULT_INTENT_MODEL` and `BLAST_EXPLAIN_MODEL` pick, with
          the note that `FeatureModelId.risk_brief` already exists and is read as an override
          rather than widened); `BRIEF_INPUT_TOKEN_BUDGET = 8_000`; `BRIEF_MAX_RISKS = 6`;
          `BRIEF_MAX_FOCUS = 3`; `BRIEF_TRIM_MAX_FILES = 12`; `BRIEF_MAX_HISTORY = 20`;
          `BRIEF_TIMEOUT_MS = 60_000`; `BRIEF_ISSUE_TIMEOUT_MS = 3_000` — each with the
          justification from Requirements review beside it, and `BRIEF_TIMEOUT_MS` carrying
          the OpenRouter warning. `BRIEF_SYSTEM_PROMPT` states the caps out loud (the
          `EXPLAIN_MAX_*` rule: a cap in the prompt keeps the model from implying it
          enumerated everything), carries the injection guard and the English-output rule in
          the shape `INTENT_SYSTEM_PROMPT` and `BLAST_EXPLAIN_SYSTEM_PROMPT` established, and
          carries the grounding sentence — *name only the files, endpoints and jobs listed
          below; never invent one*.
          `helpers.ts` is pure and imports nothing from a sibling module:
          - `assembleBriefInput(input): { user: string; trimmed: string[] }` — the assembler.
            **Sorts `pr_files` itself** (`additions + deletions` desc, `path` asc) because
            `getPrFiles` returns planner order. Wraps each author- or model-controlled block
            **exactly once** with `wrapUntrusted(label, content)` from
            `@devdigest/reviewer-core` (`prompt.ts:30-34`) — the PR title/branch/body, the
            issue title and body, each Project Context document, the intent record's prose, and
            the path/symbol/endpoint lists. This module has no `assemblePrompt`, so wrapping
            here is required rather than duplicative, and it must happen once because
            `wrapUntrusted` escapes a nested `</untrusted>` (root `INSIGHTS.md` 2026-08-29).
            No clock, no randomness, no `Object.keys` iteration over a map built from an
            unordered read — AC-06 is a property of this function.
          - `trimToBudget(system, parts, count, budget)` — the ladder, taking `count` as a
            **parameter** so it stays pure and testable with a deterministic counter; the
            service passes `container.tokenizer.count`. Rungs in the fixed order: Project
            Context whole documents from the tail of the user's order → the issue body (title
            and number kept) → blast-map rows (callers first, then symbols from the tail) →
            `pr_files` beyond the largest `BRIEF_TRIM_MAX_FILES`, replaced by a counted
            "… N more files" line → the minimal input. Re-counts after every rung; returns
            what it dropped as `trimmed`.
            **What is counted, because AC-10 is explicit about it and the natural code is
            wrong.** The budget is spent by the **system message and the user message
            together** — *"порахованих `container.tokenizer.count` над КОНКАТЕНАЦІЄЮ
            system-повідомлення й user-повідомлення"* — so the system prompt takes its share
            first and the ladder trims the user parts down to whatever is left. That is why
            `system` is a parameter here rather than something the service adds afterwards: a
            ladder that cannot see the system prompt cannot enforce the criterion.
            And it is **one** `count(system + user)` call on the joined string, never
            `count(system) + count(user)`. BPE merges across the join, so the two numbers differ
            by a token or two either way, and AC-10 says concatenation. Summing is the more
            natural code and it is the wrong number; the joining is the same one the `messages`
            array produces, so what is counted is what is sent.
          - `briefStateOf(inputs, count)` — **the hashed unit, and the only way to obtain a
            `state_key`.** It owns *assemble → trim → hash* as one function and returns
            `{ system, user, trimmed, inputTokens, overBudget }`, where `state_key` is the
            SHA-256 hex of `system + user` **after** the ladder and of nothing else, and
            `inputTokens` is the single `count(system + user)` over that same joined string —
            the number `overBudget` is decided against, and the number AC-14 persists as
            `input_tokens` beside the provider's own `tokens_in`. One string, hashed and
            counted; nothing measures the user half alone.
            It is one function rather than three call-site steps on purpose: `generate` and
            `read` must produce byte-identical strings or every trimmed brief is stale forever,
            and two call sites that happen to agree today are a weaker guarantee than one they
            both call.
            `assembleBriefInput` and `trimToBudget` stay exported for their own unit tests, but
            **no service calls either of them directly** — the grep in `Verify` is what keeps
            that true.
          - `groundRefs(reply, allow)` — the allow-list filter. The file half is
            `pr_files[].path` ∪ `changed_symbols[].file` ∪ `downstream[].callers[].file`; the
            endpoint half is `downstream[].endpoints_affected` ∪ `downstream[].crons_affected`.
            A `file_refs` entry is checked on the part before its first `:`, so `path:12` and
            `path:12-30` both resolve to `path`. A dropped reference is recorded in
            `dropped_refs`, never reprompted; a `review_focus` item whose `ref` is dropped
            disappears entirely; a risk whose refs are all dropped keeps its explanation with
            an empty list.
          - `normaliseKind(v)` → `other` for anything outside the six, so one bad enum value
            never rejects a paid reply.
          - `settleRiskLevel(risks, suggested)` — the highest surviving `severity`, `low` when
            none, and the model's suggestion accepted only if it is not higher. The
            `settleTier` shape (`intent/helpers.ts:350`).
          - `briefDelta(newer, older)` — `risk_level` transition, risk titles added and
            removed, focus refs added and removed. Code, never a call.
          - a module-local `withDeadline` twin of `intent/service.ts:97`, with a comment naming
            it.
          The unit file covers each of those, rung by rung and case by case: `briefStateOf`
          run twice on identical fixtures and compared character by character — **twice over,
          once on a within-budget fixture and once on a fixture that fires at least one rung**,
          because the ladder is inside the hashed unit and a purity test that only ever walks
          the no-op path proves the purity of `assembleBriefInput` rather than of the thing
          AC-05 and AC-06 are actually about (AC-06); a hash that moves when any input moves,
          and a hash that does **not** move when the same over-budget input is processed twice
          (AC-05); **a rung fixture whose system prompt alone is a meaningful share of the
          8 000 — large enough that the user half fits the budget on its own and the pair does
          not** — so a ladder that counted only the user message would leave the fixture
          untrimmed and fail this test rather than pass it. That is what makes AC-10
          falsifiable; without it the criterion can be silently mis-implemented and stay green.
          Assert the final `inputTokens` equals `count(system + user)` and not
          `count(system) + count(user)`, on a fixture where the two differ (AC-10); a fixture
          whose `pr_files[].patch` text never appears in the assembled string (AC-09); one
          valid and one invented reference (AC-17); both drop rules (AC-18); model-below /
          model-equal / model-above (AC-20); exactly one
          `<untrusted` per block and the guard sentences present (AC-21).
Verify:   `cd server && pnpm exec vitest run test/brief-helpers.test.ts` ·
          `cd server && pnpm typecheck` ·
          `grep -rn "patch" server/src/modules/brief/` → empty ·
          `grep -rn "assembleBriefInput\|trimToBudget" server/src/modules/brief/service.ts` →
          empty, because both are reached only through `briefStateOf` ·
          `grep -rn "from '\.\./" server/src/modules/brief/` → nothing reaching a sibling module ·
          `cd server && pnpm arch:check` — read the output
Covers:   AC-05, AC-06, AC-09, AC-10 (the accounting half — the ladder counts `system + user`),
          AC-11, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-28, AC-38
Depends:  Step 2
Commit:   `feat(brief): the assembler, the budget ladder and the grounding filter`

### Step 5 — the module: one row, two routes, one call   ·   package: server
Files:    `server/src/modules/brief/repository.ts` (new) ·
          `server/src/modules/brief/service.ts` (new) ·
          `server/src/modules/brief/routes.ts` (new) ·
          `server/src/modules/index.ts` (one import + one entry)
Skills:   onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns,
          postgresql-table-design, typescript-expert
Do:       `repository.ts` is the only SQL and owns **only** `pr_brief`: `latest(prId)` ordered
          by `seq` desc; `timeline(prId, limit)` ordered by `seq` desc; `upsert(values)` on the
          `(prId, stateKey)` target with `onConflictDoUpdate` whose `set` **excludes `id` and
          `seq`**; `trimToCap(prId, BRIEF_MAX_HISTORY)` deleting the oldest by `seq` (AC-29).
          Workspace scoping is enforced by the caller resolving the PR through
          `container.reviewRepo.getPull(workspaceId, prId)` first, the way
          `BlastRepository`'s and `IntentRepository`'s doc comments both state.
          `service.ts` has no SQL and no Fastify below its first line:
          - `read(ws, prId)` → gather the same inputs `generate` gathers, then **the identical
            `briefStateOf(inputs, container.tokenizer.count)`** — assemble, trim, hash, in that
            one call and never as three steps here. No model call, ever. Compare the returned
            key against the stored row's `state_key`, return `PrBriefResponse` with `stale` and
            the timeline; `null` when nothing was ever stored, which the route turns into the
            one and only 404 (AC-02, AC-03, AC-04).
            **The ladder is not optional on this path.** AC-05 fixes `state_key` as the hash of
            the input *after* trimming, so a `read` that skipped the ladder would hash a longer
            string than the one that was stored and mark every brief that needed trimming as
            stale forever — no matter how many times the reader pressed Regenerate. It is
            invisible in everything we would look at: PR #482 has nine files against a
            `BRIEF_TRIM_MAX_FILES` of 12, so no rung binds, the trim is a no-op and the hashes
            agree; the flow passes and so does the lane. It fails only on a large real pull
            request, which is to say only in front of a user. Sharing one function is what makes
            it unable to come back.
            **When even the minimal input is over budget**, `read` does **not** answer 422 —
            that status belongs to `POST`, where AC-12 defines it as a statement about refusing
            to spend. `read` has a stored row in hand, and 422 would make an existing brief
            unreadable because the pull request grew. It serves the stored brief with
            `stale: true`, which is AC-04 read literally: a key that cannot be computed is not a
            key that equals the stored one. The reason goes into the response the same way a
            degraded input does, so the banner says why regenerating will not help.
          - `generate(ws, prId)` → `container.intent.get()` (never `derive` — AC-22),
            `container.blast.forPull()` (a `degraded` map loses the blast half of the
            allow-list and its `reason` goes to `missing_inputs` — AC-23),
            `container.reviewRepo.getPull` + `getPrFiles` (zero files → `AppError('brief_no_changed_files', …, 422)`
            before anything else, AC-24), `extractLinkedIssue`'s pattern re-implemented locally
            or the issue skipped when none is linked, fetched through `container.github()`
            inside `withDeadline(BRIEF_ISSUE_TIMEOUT_MS, …)` and recorded in `missing_inputs`
            when unreadable, and `container.projectContext.listForPrompt(ws, repoId)`.
            Then **the same `briefStateOf(inputs, container.tokenizer.count)`** `read` calls —
            assemble, trim, hash, one function, one result — and if it comes back `overBudget`,
            `AppError('brief_input_too_large', …, 422)` **before any provider is resolved**
            (AC-12). Its `system` and `user` are the messages sent, its `trimmed` and
            `inputTokens` are persisted, and its key is the row's `state_key` → **one**
            `llm.completeStructured({ model, schema,
            schemaName, messages, temperature: 0, timeoutMs: BRIEF_TIMEOUT_MS })` on the
            `BlastService.explain` shape (`blast/service.ts:154-166`), the model being
            `(await container.featureModelOverride(ws, 'risk_brief')) ?? BRIEF_MODEL` and
            **never** `resolveFeatureModel`, whose registry default for this slot is
            `openai / gpt-4.1` — a model no part of this feature chose (AC-41) → ground,
            normalise, clamp, cap at `BRIEF_MAX_RISKS` / `BRIEF_MAX_FOCUS` → persist → trim to
            20. A thrown call writes nothing, so the previous row stays readable (AC-25).
          `routes.ts`: `GET /pulls/:id/brief` with `IdParams` and **no** rate-limit override,
          logging `llmCalls: 0` as a literal; `POST /pulls/:id/brief` with
          `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`, logging `llmCalls: 1`,
          `inputTokens`, `tokensIn`, `tokensOut`, `costUsd`, `trimmed`, `missingInputs`,
          `droppedRefs` and `durationMs` — the pair of literals `modules/blast/routes.ts`
          established, so the "no model call" claim is readable in one file (AC-01, AC-02,
          AC-13). One import and one entry in `modules/index.ts`.
Verify:   `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` ·
          `cd server && pnpm typecheck` ·
          `cd server && pnpm arch:check` — read the output ·
          `grep -n "llmCalls: 0" server/src/modules/brief/routes.ts` and
          `grep -n "llmCalls: 1" server/src/modules/brief/routes.ts` → one each ·
          `grep -c "rateLimit" server/src/modules/brief/routes.ts` → **1**, and
          `grep -n "rateLimit" server/src/modules/brief/routes.ts` shows it inside the `POST`
          registration — the mechanical form of AC-26's *"огляд маршрутів"*, which is the lane
          that carries the `GET`-stays-unthrottled half and was asserted in prose and checked by
          nothing ·
          `grep -rn "patch" server/src/modules/brief/` → still empty ·
          `grep -rn "container.intent.derive" server/src/modules/brief/` → empty ·
          `grep -c "briefStateOf" server/src/modules/brief/service.ts` → **2**, one per path;
          any other number means `read` and `generate` have stopped hashing the same string
Covers:   AC-01, AC-02, AC-03, AC-04, AC-08, AC-10, AC-12, AC-13, AC-14, AC-19, AC-20, AC-22,
          AC-23, AC-24, AC-25, AC-26, AC-27, AC-29, AC-41
Depends:  Step 3, Step 4
Commit:   `feat(brief): the two routes, the row they read, and the one call that writes it`

### Step 6 — the integration lane   ·   package: server
Files:    `server/test/brief.it.test.ts` (new)
Skills:   onion-architecture
Do:       The 15th Postgres container. Built on `src/adapters/mocks.ts` — `MockLLMProvider`
          counts calls in `.calls` (`mocks.ts:60`), and a provider that throws on every method
          is the shape `blast.it.test.ts` already uses for the "spends nothing" claims. Cover:
          exactly one call on `POST` and the record's five fields (AC-01); zero calls on `GET`
          against a throwing provider, and the same across three consecutive `GET`s (AC-02,
          AC-07); 404 on a clean PR and 200 forever after one `POST` (AC-03); `POST` → `GET`
          gives `stale: false`, then editing the PR body gives `stale: true` with no new call
          (AC-04); **a fixture large enough to fire at least one rung, `POST`ed and then read
          back with `stale: false`** — the regression test for the cross-model review's finding,
          and the one case in this lane that would have caught it (AC-04, AC-05); two `POST`s on
          unchanged inputs leave `select count(*) from pr_brief where pr_id = …`
          at 1 (AC-08); the **concatenation of the system and user messages actually handed to
          `MockLLMProvider`** — `req.messages` joined, not the user message alone — counting
          ≤ 8 000 under one `container.tokenizer.count` call, and the persisted `input_tokens`
          equalling that same number (AC-10, AC-14); a fixture over budget in the minimal rung → 422
          `brief_input_too_large`, zero calls (AC-12); `trimmed` non-empty on an over-budget
          fixture (AC-13); **the same drop present in the route's log line, not only in the
          stored record** — AC-13 obliges *both* channels (*"і в лог маршруту, і в поле `trimmed`"*)
          while its `How it is checked` cell names only the stored one, so this assertion is the
          plan covering more than the spec asks, the direction § Coverage already calls
          acceptable. The mechanism is not invented: `intent.it.test.ts:430-435` replaces
          `app.log.info` with a collector — `app.log.info = ((obj) => { lines.push(obj) })` —
          and asserts on the object, which is exactly what is needed here and is why no
          pino transport, no stream capture and no new helper is required (AC-13);
          `input_tokens` and `tokens_in` both present and different, the mock
          fixing the latter at 100 (AC-14); a PR with no `pr_intent` → 200 with a
          `missing_inputs` entry and `container.intent.derive` never reached (AC-22); a
          `degraded` map — which an unindexed repo produces naturally through
          `getBlastRadiusFromIndex` returning `null`, no override needed — narrowing the
          allow-list and recording its reason (AC-23); a PR with no `pr_files` → 422
          `brief_no_changed_files`, zero calls (AC-24); a second `POST` that throws leaving the
          first record readable through `GET` (AC-25); an 11th `POST` inside a minute → 429
          (AC-26); two rows inserted in **one transaction** returned in `seq` order (AC-27); 21
          rows → 20, oldest gone (AC-29); an enabled Project Context document present in the
          input and absent when disabled, and first out under budget pressure (AC-38); **a
          model reply naming an invented path, dropped from the persisted record and recorded
          in `dropped_refs` while the rest of the brief survives** — the second lane AC-15's
          `How it is checked` names beside the unit test, and the one that proves the service
          actually applies `groundRefs` rather than merely owning it (AC-15); **the two seeded
          `pr_brief` rows for PR #482**, read through `GET` at `stale: true` because a
          `seed:`-prefixed `state_key` can never equal a SHA-256 hex, with a second `seed()`
          call leaving the count at two and `seq` unchanged — this file runs the real seed in
          `beforeAll` the way `intent.it.test.ts:65-70` does, so the seeded literals are
          assertable here and not only in the flow (AC-39); and
          **two runs over the model choice** (AC-41) — one with no `feature_models` row, where
          the persisted record's `provider` / `model` must be `BRIEF_MODEL`, and one with
          `{ risk_brief: { provider, model } }` written through the normal path, where they must
          be the chosen pair. Neither may ever be the registry's `openai / gpt-4.1`, which
          `settings-models.it.test.ts:53-57` already pins as what `resolveFeatureModel` would
          have returned. The shape to copy is `conventions.it.test.ts:295-328` — two
          `MockLLMProvider`s, one per provider id, asserting which one was called and with which
          `req.model` — **including its last three lines**, which delete the `feature_models` row
          afterwards: without that, every later case in this file inherits the override and the
          default branch stops being tested.
Verify:   `cd server && pnpm exec vitest run test/brief.it.test.ts` first — the new file alone,
          so a red in it is unambiguous, and it is where the two AC-41 runs are read ·
          then `cd server && pnpm exec vitest run .it.test` — the **whole** lane, not the new file
          alone. If an unrelated file goes red, remove this one and re-run the reduced lane
          **at least five times** before calling it a regression: the `skills.it.test.ts` race
          sits at ~20% at both 13 and 14 files, so one clean run proves nothing
          (`server/INSIGHTS.md` 2026-08-28 and its 2026-08-29 correction)
Covers:   AC-01, AC-02, AC-03, AC-04, AC-05, AC-07, AC-08, AC-10, AC-12, AC-13, AC-14, AC-15,
          AC-22, AC-23, AC-24, AC-25, AC-26, AC-27, AC-29, AC-38, AC-39, AC-41
Depends:  Step 5
Commit:   `test(brief): one call on POST, zero on GET, and the ladder that never spends`

### Step 7 — the client's data path   ·   package: client
Files:    `client/src/lib/hooks/brief.ts` (new) · `client/src/lib/hooks/index.ts` (edit) ·
          `client/messages/en/brief.json` (edit)
Skills:   react-best-practices, typescript-expert
Do:       One hook file over the two endpoints, shaped exactly like `hooks/intent.ts`: a
          `usePrBrief(prId)` `useQuery` keyed `["brief", prId]` that resolves a **404 to
          `null`** — "no brief yet" is a card's empty state, not a toast — and rethrows every
          other status; and a `useGenerateBrief(prId)` `useMutation` that writes the response
          into the cache **before** invalidating, because it is the only copy of a row that
          just cost a model call. One line in the barrel.
          `brief.json`: add the keys the card needs — title, empty state, stale banner,
          Regenerate, `what` / `why` labels, "Risk areas", "Review focus", `noFocus` (the
          derived twin of the existing `noRisks`), the `missing_inputs` / `dropped_refs` /
          `trimmed` notes, the Why Timeline header and its delta strings, and the per-row
          accessible name that carries the file and line the row acts on. Correct `unavailable`
          and `unavailableHint`: the latter says *"Run a review or open the PR to compute it."*
          and after this feature that is false — only the button computes a brief. `noRisks`
          is reused as-is. `block.*`, `noHistory`, `overlap` and `why.*` are **not touched**:
          they belong to `HistoryAccordion` and git-why, both out of scope, and a message file
          is the one place a removed feature can still make a factual claim
          (`client/INSIGHTS.md` 2026-08-29).
Verify:   `grep -rn "useGenerateBrief\|usePrBrief" client/src/lib/hooks/index.ts` → exported ·
          `grep -n "Run a review or open the PR" client/messages/en/brief.json` → empty ·
          `cd client && pnpm typecheck && pnpm test`
Covers:   none — enabling work for AC-30 to AC-37
Depends:  Step 2 (types), Step 5 (the routes it calls)
Commit:   `feat(web): the brief hook, and copy that stops promising a review will write one`

### Step 8 — `?file` and `?line`, owned by the page   ·   package: client
Files:    `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (edit) ·
          `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (edit) ·
          `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx` (edit) ·
          `.../DiffTab/DiffTab.test.tsx` and `.../SmartDiffViewer/SmartDiffViewer.test.tsx`
          (new or edited) · `client/messages/en/prReview.json` (the unknown-path notice)
Skills:   frontend-architecture, react-best-practices, next-best-practices,
          react-testing-library
Do:       This step makes the URL **consumed**; Step 9 makes it **produced**. The split is the
          commit plan's "nothing dead ever ships" rule applied literally: everything below is
          live the moment it lands, because a reader can type the URL, while an `openFile`
          written here would be a function with no caller until the card exists. It therefore
          belongs to Step 9, with its consumer.
          The page owns the URL, as it already owns `?tab`, `?trace` and `?findingId`. Read
          `file` and `line` from `search`; pass them to `DiffTab` as props; extend `setTab` to
          drop `file` and `line` alongside `findingId` — the same rule, for the same reason its
          comment already gives (AC-36).
          `DiffTab` renders a visible notice when `file` names a path that is not in
          `files[]` — above both branches, so it holds whether the smart diff resolved or the
          flat `DiffViewer` is the fallback (AC-35). Otherwise it passes the pair down.
          `SmartDiffViewer` converts the incoming props into a `focusToken` bump in a
          `useEffect` keyed on `[focusFile, focusLine]`, feeding the **existing** `Focus` state
          and `FileCard`'s existing jump-and-highlight (`FileCard.tsx:57-127`). It is unmounted
          while another tab is active, so the focus cannot live here — it arrives as a prop
          and survives a reload for that reason (AC-34). No second mechanism, and no change to
          `FileCard`.
          Tests drive interaction with **`fireEvent`** — `user-event` is not installed.
Verify:   `cd client && pnpm test && pnpm typecheck` ·
          `grep -n "findingId: null" client/src/app/repos/\[repoId\]/pulls/\[number\]/page.tsx`
          shows `file` and `line` cleared in the same `setTab` object
Covers:   AC-33 (the landing half — the URL is consumed, the file expands, the line
          highlights), AC-34, AC-35, AC-36
Depends:  none — it is pure client work over shipped components
Commit:   `feat(web): the Files tab takes its focus from the URL, and the tab switch drops it`

### Step 9 — the PrBriefCard   ·   package: client
Files:    `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/**` (new —
          `PrBriefCard.tsx`, `styles.ts`, `index.ts`, `PrBriefCard.test.tsx`, a
          `_components/RiskPillRow/` folder, and further `_components/<Name>/` folders as the
          card splits) ·
          `.../_components/OverviewTab/OverviewTab.tsx` (edit) ·
          `.../_components/OverviewTab/OverviewTab.test.tsx` (**new** — the folder has only
          `OverviewTab.tsx`, `styles.ts` and `index.ts` today) ·
          `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (edit — **the provider end of
          the callback this step's card calls**; without it the card calls a prop nobody hands
          it)
Skills:   **design-reference first, before any code**, then frontend-architecture,
          react-best-practices, react-testing-library
Do:       Read the design first: screen key `pull-request-detail`, artboard `pr-overview`,
          `BriefCard` / `RiskPillRow` / `RISK_ICON` / `RISK_SEV` and the `RISKS` fixture, then
          `BRIDGE.md`. `RiskPillRow` is a **design-reference** component, not a
          `@devdigest/ui` one — `grep -rn "export .*RiskPillRow" client/src/vendor/ui/` is
          empty, and `vendor/ui/**` is do-not-touch — so its visual is adopted as given and
          **built here**, in `PrBriefCard/_components/RiskPillRow/`, out of the primitives that
          do exist (`Card`, `Badge`, `SectionLabel`, `EmptyState`, `MonoLink`, all verified
          present in `vendor/ui/primitives/`). Adopted as given means the design decides how it
          looks, not that there is something to import. Every decision about `what`, `why`,
          `risk_level` and `review_focus` is **derived**, because the design has no artboard
          for them — the spec's Design analysis says which derivation each is, and this step
          implements those and invents no more.
          **The callback chain, end to end, because a card that navigates needs a provider and
          this step owns both ends.** `page.tsx` owns the URL and gains
          `openFile(path, line)` — one `setParams({ tab: 'diff', file, line })` call, never
          two, because two calls in the same tick both read the same `search` and the second
          wins (the comment at `setParams` says so) — and passes it into `<OverviewTab …>`;
          `OverviewTab` gains the prop and forwards it to `PrBriefCard`; `PrBriefCard` calls
          it; nothing below the page knows a router exists. That is exactly the shape
          `onOpenFinding` already takes from `page.tsx:220` through `DiffTab.tsx:28,37,93` into
          `SmartDiffViewer`, and it is named here as the precedent rather than a second
          convention being invented.
          **One deliberate divergence from that precedent: the prop is required, not
          optional.** `DiffTab` declares `onOpenFinding?:`, and copying the `?` is precisely
          what would let this defect return silently — an unpassed optional callback compiles
          and the button quietly does nothing. `PrBriefCard` declares
          `onOpenFile: (path: string, line: number | null) => void` with no `?`, and
          `OverviewTabProps` — `{ prId, prBody }` today — gains it the same way, so a missing
          thread is a `pnpm typecheck` failure in this step rather than a dead control in
          production.
          Full width, the **first** block of `OverviewTab`, above `IntentCard`, in the order
          AC-32 fixes: header (risk-level badge · model, tokens, cost, `trimmed` · Regenerate)
          → `what` and `why` → divider → Risk areas → divider → Review focus → Why Timeline.
          404 → `EmptyState` with a CTA and **no mutation before the click** (AC-30), the shape
          `IntentCard.tsx:77-90` uses so the two cards on one tab do not disagree about what
          "not yet" looks like. `stale: true` → a banner inside the card with Regenerate as its
          action, never the brief hidden behind an empty state (AC-31) — the shape `BlastTab`
          uses for a degraded map. `missing_inputs`, `dropped_refs` and `trimmed` rendered
          where the spec's Design analysis places them. A `kind: 'file'` focus row is a button
          calling `onOpenFile` — the prop threaded above, one navigation — and each row
          carries an accessible name naming **its own** file and line, because a flow that
          clicks one of three
          identical controls otherwise picks whichever comes first (`e2e/INSIGHTS.md`
          2026-08-23). A `kind: 'endpoint'` row is monospace text with no navigation (AC-37).
          Long `file_refs` middle-truncate with the full value in `title`. No hardcoded copy;
          every string from `messages/en/brief.json`. Tests use `fireEvent` and import their
          strings from the message file, like every neighbouring suite. **AC-33's component
          test passes a `vi.fn()` as `onOpenFile`** and asserts exactly one call carrying that
          row's path and line — which is only writable because the prop is in the component's
          signature, so the test and the wiring cannot disagree about whether it exists.
Verify:   `cd client && pnpm test && pnpm typecheck` — the typecheck is the gate that proves
          the chain is threaded, because `onOpenFile` is required at every hop ·
          `grep -rn "PrBriefCard" client/src/.../OverviewTab/OverviewTab.tsx` shows it above
          `IntentCard` · `grep -n "openFile" client/src/app/repos/\[repoId\]/pulls/\[number\]/page.tsx`
          → the definition **and** the `<OverviewTab onOpenFile={openFile} …>` pass-down ·
          a block-order test asserting the seven sections in AC-32's sequence
Covers:   AC-30, AC-31, AC-32, AC-33 (the navigation half — the URL is produced), AC-37
Depends:  Step 7, Step 8
Commit:   `feat(web): the PR brief card — what, why, risk areas and where to start`

### Step 10 — the seed, and the flow that reads it   ·   package: server + e2e
Files:    `server/src/db/seed.ts` (edit) · `e2e/specs/10-pr-brief.flow.json` (new)
Skills:   drizzle-orm-patterns, typescript-expert
Do:       **One step because the flow asserts the seed's literals** and root `CLAUDE.md`
          § Gotchas requires the `e2e/specs/*.json` grep after any `seed.ts` change — split,
          the flow asserts strings that do not exist yet.
          Two `pr_brief` rows for demo PR #482, written the way the `pr_intent` block at
          `seed.ts:846-936` is: **outside** the `if (!pr)` guard so an already-seeded dev
          database picks them up without dropping the volume, as an **upsert** on
          `(pr_id, state_key)` so fixture data converges, and typed as the contract
          (`typeof t.prBrief.$inferInsert` with the `json` payload typed `PrBriefRecord`) so a
          later contract change breaks the seed at typecheck rather than at runtime. The
          `onConflictDoUpdate` `set` **excludes `id` and `seq`**, or a second `pnpm db:seed`
          reorders the timeline. Both `state_key`s are sentinels that can never equal a
          SHA-256 hex — `seed:v1` / `seed:v2` — so the card always shows them as stale and the
          product never claims freshness it cannot prove (AC-39). Both rows insert in one
          transaction, which is exactly the condition AC-27 is read against. Their contents
          are grounded in `PR_482_FILES` (`seed.ts:81`) and in the seeded intent's own
          sentences, so every reference the card renders is one the allow-list would have
          allowed.
          `10-pr-brief.flow.json`, on the shape of `09-pr-smart-diff.flow.json`: land on the PR
          list, open #482, confirm the brief card renders its seeded `what` / `why` literals
          and its **stale banner** (AC-39, AC-07 — the page loads and nothing is generated),
          click a review-focus row by its file-and-line accessible name, `wait --url tab=diff`
          and `--url file=` and `--text <that path>` (AC-33), then reload and wait for the same
          URL and the same file (AC-34). Every locator deterministic; no `chat`; nothing that
          could reach a model.
Verify:   `cd server && pnpm db:seed && pnpm db:seed` — twice, and the second changes nothing ·
          `grep -rn "<each new seeded literal>" e2e/specs/` → found in `10-pr-brief.flow.json` ·
          `cd e2e && pnpm e2e:hermetic` — the whole suite, on the isolated stack; flows 02/04/05
          need a freshly-seeded database and the hermetic runner is what gives them one
Covers:   AC-07, AC-33, AC-34, AC-39
Depends:  Step 6, Step 9
Commit:   `feat(seed): two briefs for the demo PR, honestly stale, and the flow that reads them`

### Step 11 — the structural criteria, checked   ·   package: server + client
Files:    none (verification pass) · `specs/L05-pr-brief.md` (`Status:` only)
Skills:   none
Do:       Run every `How it is checked` cell that is a shell command, AC-01 to AC-40, top to
          bottom. The structural ones are the point of this step, because nothing else in the
          plan fails when they drift: AC-09's grep that `modules/brief/**` never reads
          `pr_files.patch`; AC-01/AC-02's grep for the `llmCalls: 1` / `llmCalls: 0` literals;
          AC-26's route review, run as `grep -c "rateLimit" server/src/modules/brief/routes.ts`
          → 1 on the `POST` — the half of that criterion no test carries, because the spec asks
          for a review and not for eleven `GET`s, and a test that proved the absence of a limit
          by failing to trip it would be weak evidence anyway;
          AC-40's **per-file** `cmp -s` over the three pairs this work touched, plus
          `scripts/pr-self-review-checks.sh` (`check:contract-mirror`, `:150-168`), which
          already applies that rule to the current diff. **Never a whole-tree `diff -r`:**
          `adapters.ts`, `contracts/productionize.ts` and `contracts/eval-ci.ts` differ before
          this work starts. Then both full lanes. Any red is a fix in the step that owns it,
          never a note here.
          The one thing no test covers is AC-32's second clause — the visual check against the
          `pr-overview` artboard — and the spec's own deliberate exclusion: whether a real
          model writes a *useful* `why`. Both are the lesson's demo run against PR #482, not a
          gate.
Verify:   the AC table, top to bottom ·
          `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck && pnpm arch:check`
          (read `arch:check`'s **output**) · `cd server && pnpm exec vitest run .it.test` ·
          `cd client && pnpm test && pnpm typecheck` · `cd e2e && pnpm e2e:hermetic`
Covers:   AC-01, AC-02, AC-09, AC-40 (re-checked); the structural half of every other id
Depends:  Step 10
Commit:   `chore(specs): the PR brief's criteria, checked`

## Out of scope

Copied verbatim from `specs/L05-pr-brief.md` § Out of scope.

- **The design's 2-up `BriefCard` grid.** The card is assembled full-width in this pass. The
  grid moves the existing `BlastTab` and `IntentCard` into new containers, and a layout
  refactor of three components is a bigger change than the feature that motivated it.
- **`HistoryAccordion` / "Prior PRs touching these files".** It shares a visual with the Why
  Timeline and nothing else: its data source is prior merged PRs overlapping these paths,
  which nothing computes today. Building it here would be a second feature wearing this one's
  clothes.
- **The legacy `PrBrief` composite contract.** Left exactly as it is, unused. It models a
  different thing — a bundle of four already-served responses — and rewriting a contract with
  no consumers on the way past is how a small change becomes a mirror-edit sweep.
- **Widening `FeatureModelId`, and adding a Settings row for the brief's model.** Neither is
  needed: **`risk_brief` is already the third member of that enum**
  (`server/src/vendor/shared/contracts/platform.ts:15-21`), its registry entry exists
  (`Risk Brief`, defaulting to `openai / gpt-4.1`), the client's duplicate registry carries it
  (`client/src/lib/feature-models.ts`), and the Settings row is rendered today pointing at
  nothing. So the slot is claimed rather than created: the module reads
  `container.featureModelOverride(workspaceId, 'risk_brief')` and falls back to a module-local
  `BRIEF_MODEL`, the shape `modules/intent/service.ts:236-237` and
  `modules/conventions/service.ts:124-126` both use — and deliberately **not**
  `resolveFeatureModel`, which would silently buy the registry's `gpt-4.1` instead of this
  module's own cheap model. That is the trap root `INSIGHTS.md` (2026-08-06) records: the
  registry's defaults promise to "mirror each module's constants", a promise it cannot keep for
  a module written after it, and `risk_brief` mirrors nothing for exactly the reason
  `conventions` does. AC-41.
- **Making the brief an input to the reviewing prompt.** The intent layer already occupies
  that slot. Feeding a second model's prose into every agent's context is a decision with its
  own blast radius and belongs to whoever needs it.
- **Streaming the generation.** One call, one step, no partial output worth streaming — the
  reasoning `POST /pulls/:id/intent` and `POST /pulls/:id/blast/explain` both give.
- **Regenerating a brief automatically when the head moves.** Staleness is *reported*; acting
  on it is the reader's call, because acting on it spends money.
- **Fixing `resolveLinkedIssue`'s loose regex in `adapters/github/octokit.ts:127-136`.** It is
  private, it serves a different caller, and the brief uses `modules/intent`'s stricter
  `extractLinkedIssue` instead. Noted, not touched.
- **`git blame` / `git-why` per line.** `messages/en/brief.json` already carries a `why.*`
  namespace for it. Different feature, different data source; the keys stay untouched.
- **Anything that reads `pr_files.patch`.** Not a limitation to work around — it is the
  feature's defining constraint.

## Coverage

Built from the spec's forty-one ids, in order, not from the steps.

| AC | Step | AC | Step |
|---|---|---|---|
| AC-01 | 5, 6, 11 | AC-21 | 4 |
| AC-02 | 5, 6, 11 | AC-22 | 5, 6 |
| AC-03 | 5, 6 | AC-23 | 5, 6 |
| AC-04 | 5, 6 | AC-24 | 5, 6 |
| AC-05 | 4, 6 | AC-25 | 5, 6 |
| AC-06 | 4 | AC-26 | 5, 6 |
| AC-07 | 6, 10 | AC-27 | 1, 5, 6 |
| AC-08 | 1, 5, 6 | AC-28 | 4 |
| AC-09 | 4, 11 | AC-29 | 5, 6 |
| AC-10 | 4, 5, 6 | AC-30 | 9 |
| AC-11 | 4 | AC-31 | 9 |
| AC-12 | 5, 6 | AC-32 | 9, 11 |
| AC-13 | 5, 6 | AC-33 | 8, 9, 10 |
| AC-14 | 2, 5, 6 | AC-34 | 8, 10 |
| AC-15 | 4, 6 | AC-35 | 8 |
| AC-16 | 4 | AC-36 | 8 |
| AC-17 | 4 | AC-37 | 9 |
| AC-18 | 4 | AC-38 | 4, 6 |
| AC-19 | 2, 4, 5 | AC-39 | 6, 10 |
| AC-20 | 4, 5 | AC-40 | 2, 11 |
| AC-41 | 5, 6 | — | — |

All forty-one ids appear against at least one step. No step's `Covers:` names an id the spec
does not carry — checked in the reverse direction as well. Step 3 and Step 7 cover nothing and
say so: Step 3 brokers the dependency Step 5 consumes and corrects two doc comments that are
about to become false; Step 7 is the hook and the copy Step 9 renders.

**This table is checked in two directions, not one.** Every id appears (no criterion is
dropped), and no step names an id the spec does not carry (no scope creep). Round 4 of the
cross-model review added a third direction, and it is the one that had been failing silently:
each id's **`How it is checked` cell names one or more lanes** — unit, `*.it.test.ts`, client
component, e2e flow, a `grep`, a named command — and the plan must place a step against *every*
lane, not merely against the criterion. A plan that covers fewer lanes than the spec asks still
looks complete here, and every gate in the plan agrees with it. The sweep of all forty-one ids
is recorded in Requirements review; it found two ids short a lane (AC-15, AC-39) and one
under-reported in this table (AC-32), all three now fixed. Covering *more* lanes than the spec
asks is fine and is left alone — AC-05 and AC-10 both do.

**AC-41 grew no step, deliberately.** It is one resolution call in a service Step 5 already
writes — `container.featureModelOverride(ws, 'risk_brief') ?? BRIEF_MODEL` — and two runs in a
lane Step 6 already builds, on a shape (`conventions.it.test.ts:295-328`) that already exists.
A twelfth step for it would be a commit whose only content is a `??`, which is exactly the
boundary-of-convenience the commit plan exists to refuse.

Three ids are covered in parts, deliberately, and every part is named:

- **AC-19** — the six-value enum is Step 2's; the `other` normalisation of a seventh value is
  Step 4's; applying it to a real reply is Step 5's.
- **AC-33** — Step 8 is the **landing** half (the URL is consumed: the file expands and the
  line highlights), Step 9 is the **navigation** half (the URL is produced: `openFile`, the
  one `setParams` call, and the row that calls it), and Step 10 is the cross-tab journey no
  component test can prove. The `openFile` definition sits in Step 9 with its caller so that
  neither commit ships an uncalled function.
- **AC-41** — the constant is declared in Step 4, the resolution that reads the override is
  Step 5's, and both branches are proved in Step 6. Only the last two claim it: Step 4 declares
  a fallback without choosing anything.
- **AC-10** — Step 4 owns the *accounting*: the ladder counts one `count(system + user)` and
  the unit fixture is system-heavy enough that counting the user half alone would fail it.
  Step 5 owns the *enforcement* — the call is issued only after `overBudget` is false — and
  Step 6 proves it end to end against the messages the provider actually received.

## Commit plan

**One commit per step, eleven at the ceiling.** Each step above ends in a command that passes
or fails, and that command is the commit's gate: a step whose `Verify` is red does not get
committed. Nothing here is a checkpoint of convenience — every commit is a block a reader of
`git log` can name.

| # | Step | Commit |
|---|---|---|
| 1 | the table | `feat(db): pr_brief becomes a history, keyed by state and ordered by seq` |
| 2 | the contracts, both mirrors | `feat(shared): the brief's persisted shape, and a Risk kind that cannot crash an icon lookup` |
| 3 | the container | `refactor(platform): broker the blast map, and stop the tokenizer claiming one consumer` |
| 4 | the pure decisions | `feat(brief): the assembler, the budget ladder and the grounding filter` |
| 5 | the module | `feat(brief): the two routes, the row they read, and the one call that writes it` |
| 6 | the integration lane | `test(brief): one call on POST, zero on GET, and the ladder that never spends` |
| 7 | the client data path | `feat(web): the brief hook, and copy that stops promising a review will write one` |
| 8 | the focus params | `feat(web): the Files tab takes its focus from the URL, and the tab switch drops it` |
| 9 | the card | `feat(web): the PR brief card — what, why, risk areas and where to start` |
| 10 | seed + e2e | `feat(seed): two briefs for the demo PR, honestly stale, and the flow that reads them` |
| 11 | the structural check | `chore(specs): the PR brief's criteria, checked` |

The rules that make those boundaries defensible, in the order a reviewer would question them:

- **The mirror is never split.** Commit 2 edits six files across two packages in one go. Split,
  the tree is broken in between and AC-40 fails in the gap — which is the whole point of the
  gotcha it comes from. The producer sweep that a contract edit normally drags in came back
  empty here (`Risk` has zero consumers), so commit 2 carries no fixture tail; had it found
  literals, they would have belonged in this same commit.
- **The schema change and its generated migration are one commit**, so a bad `pnpm db:generate`
  is revertible without dragging the module with it. `pnpm db:migrate` is manual and is part
  of no commit.
- **The refactor is not folded into the feature.** Commit 3 changes a shipped module
  (`modules/blast`) and a shared adapter comment; commit 5 creates a new one. Merged, neither
  is revertible alone, and the one change in this plan that could break something already
  working would be hidden inside the one that could not.
- **The two `modules/brief` commits split on I/O, not on size.** Commit 4 is every decision the
  brief makes with no clock, no database and no network — and its gate is the unit lane.
  Commit 5 is every line that touches one — and its gate is the whole unit lane plus
  `arch:check`. That is the same line the test plan draws, so the commits and the lanes agree.
- **The client's data path and the component it feeds are separate**, and the plumbing lands
  before the card. Commit 7 is a hook and a message file; commit 8 changes three shipped
  components and can regress the Files tab; commit 9 is new and can regress nothing. Ordering
  them plumbing-first means nothing dead ever ships: the URL contract is testable by typing a
  URL the moment commit 8 lands, and commit 9 is the one that makes the feature visible — a
  good last feature commit for someone reading the log.
- **Seed and e2e are one commit** because the flow asserts the seed's literals. Split, one of
  the two commits is red by construction.
- **Eleven is a ceiling, not a quota.** A step that turns out to be a no-op gets no commit.
  Never one giant commit, and never a commit whose only justification is that a step boundary
  fell there.
- **`spec.md` and `plan.md` are already in the history before any of this.** The spec is
  `c83f260`; this plan is committed before Step 1 runs, on the sibling's precedent
  (`6b395e8 docs(plans): how project context gets built, in nine steps`) — suggested subject:
  `docs(plans): how the PR brief gets built, in eleven steps`.
- **`/pr-self-review` runs before the pull request, not before each commit** (root `CLAUDE.md`
  § Session protocol). Expect `check:contract-mirror` to be satisfied — the three pairs end
  byte-identical — and `check:schema-migration` to be satisfied by commit 1's generated file.
- **Commit only when asked.** This plan says where the boundaries are; it authorises no push
  and no pull request.

## Handoff

Plan file:      `specs/plans/L05-pr-brief.md`
Entry point:    Step 1. Nothing on disk is started; `git status` is clean at `c83f260`.
Execution mode: **single-agent pass through `/implement`.** Not asked, because the dependency
                graph answers it: 1 → 2 → {3} → 4 → 5 → 6 → 7 → 9 → 10 → 11 is a chain, and the
                one genuine fork is Step 8 against Steps 4–6. Step 8 is three files, but its
                context is `page.tsx`, `DiffTab`, `SmartDiffViewer` and `FileCard` — roughly
                700 lines a second agent would load cold to save one step of wall time, on a
                branch that then has to be read back into the card step anyway. The saving does
                not pay for the second context. Reversible: if the caller wants a parallel run,
                Step 8 is the only step that can leave the chain, and it depends on nothing.
Tests:          **run without `--tests`.** `implementer` writes them inside the steps that own
                them: the pure-decision unit file in Step 4, the integration file as its own
                Step 6, the component tests in Steps 8 and 9. Every one is an assertion about
                the return shape of the function beside it — `assembleBriefInput`'s byte
                identity, `trimToBudget`'s rungs, `groundRefs`'s two drop rules — and a
                separate `test-writer` pass would have to re-derive the module it is testing.
                Step 6 is the one place a `--tests` pass could have earned its context, and it
                is also the riskiest file in the plan (a 15th Postgres container); it is its
                own step for exactly that reason, so it can be run and re-run in isolation.
Verification:   per step above. Closing lanes:
                `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck && pnpm arch:check`
                — read `arch:check`'s **output**, not its exit code ·
                `cd server && pnpm exec vitest run .it.test` ·
                `cd client && pnpm test && pnpm typecheck` ·
                `cd e2e && pnpm e2e:hermetic`. `reviewer-core` and `mcp` are not touched and
                their lanes are not part of this plan.
Closing step:   after Step 11 is green, set the spec's `Status:` to `done`. Then the demo run
                the lesson asks for — generate a real brief against PR #482 with a provider key
                and read the card, which is the only check on whether the `why` is any good.
                Then `/engineering-insights`: the sticky `cl100k_base` fallback and
                `getPrFiles`'s planner order belong in `server/INSIGHTS.md`. The two findings
                the spec now records itself — that a recomputed cache key cannot be a cheap
                `GET`, and that `risk_brief` was already in `FeatureModelId` with a `gpt-4.1`
                default — are candidates for the root one only insofar as they generalise: the
                second is a second sighting of the 2026-08-06 entry, which is the promotion
                rule's threshold. `/pr-self-review` last, before the pull request.
Deviation policy: stop at the step, report the divergence, finish the independent steps.
                  Do not re-plan, and do not amend the spec — a gap goes to `spec-creator`.

## Recommendations

Each is a **proposal**, not a step, and none is implemented unless it is picked up.

- **Take the spec's four UX proposals in Step 9; they are cheap and two of them are already
  load-bearing.** Numbering the review-focus rows 1·2·3 is what makes `BRIEF_MAX_FOCUS = 3`
  read as an answer rather than a cap; putting model, tokens and cost in the header is where
  `trimmed` has to go anyway (AC-32 puts it in the meta line). Collapsing the Why Timeline and
  badging its count, and stating a `risk_level` transition on the collapsed header, cost one
  `useState` and one string each.
- **Lift `withDeadline` to `platform/` when a third caller appears, not now.** Two copies of
  six lines is cheaper than dragging `modules/intent` into this diff. The third caller is the
  moment it stops being true.
- **Done, not proposed: both requirements problems went back to `spec-creator` and both are
  fixed.** The `GET`-cost row now says what a `GET` actually costs, the `FeatureModelId` bullet
  and the `Model` row carry the true reason, and `AC-41` was appended without renumbering
  anything. Recorded here so a reader of this plan does not go looking for a question that is
  no longer open.
- **Consider caching the assembled input on the row.** The whole cost of `GET` is that it
  re-derives a string it has already derived once. Storing the assembled `user` message beside
  the hash would make `GET` cheap and would also make a stale brief *explain itself* — a diff
  between two assembled inputs is the most honest possible answer to "what changed". Not done
  here: it enlarges a `jsonb` column with a payload nobody has asked to read, and the decision
  wants evidence from a real workload.
- **Do not widen the allow-list on the first `dropped_refs` complaint.** The spec's Risks row
  makes the dropped references the evidence for that decision; widening before the evidence
  exists turns a precision guarantee into a preference.
- **Run `/workflow-retro` after Step 11.** This is the pipeline's second full feature and its
  first with an eleven-commit graded log; the retro is the only place what that cost gets
  written down.
