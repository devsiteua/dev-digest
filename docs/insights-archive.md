# Insights archive

Entries moved out of an active `INSIGHTS.md` to keep it under ~250 lines. Nothing here is
stale and nothing was rewritten on the way in — each entry is verbatim, under the section it
came from.

Two kinds of entry qualify:

- **`→ promoted`** — the lesson became a one-line rule in a `CLAUDE.md`. The rule is live;
  this file is where its reasoning is kept.
- **`resolved`, and belonging to work that has shipped** — the fix is in the code and
  guarded by a test. Kept because the *reason* is not in the diff.

An `open` entry never moves: the active file is read at the start of every session, and open
is what "still applies" means.

A resolved entry does not move either while an `open` one **points at it** — "the entry
below", "supersedes the entry below". Splitting such a pair would leave the active file
holding half a thought, so the pair stays whole and the active file keeps both.

| Archived | From | Entries |
|---|---|---|
| 2026-08-02 | root `INSIGHTS.md` | 2 |
| 2026-08-06 | root `INSIGHTS.md` | 8 |
| 2026-08-06 | `client/INSIGHTS.md` | 2 (both already promoted) |
| 2026-08-29 | root `INSIGHTS.md` | 22 |
| 2026-08-29 | `server/INSIGHTS.md` | 17 |
| 2026-08-29 | `client/INSIGHTS.md` | 19 |

Sections match any `INSIGHTS.md` — see
[`../.claude/skills/engineering-insights/SKILL.md`](../.claude/skills/engineering-insights/SKILL.md)
— but within a section entries are **appended in the order they were archived**, not
newest-first. Do not re-sort: one pair here says "amends the entry below", and sorting by
date would separate them.

The 2026-08-29 batch was the first to spill three files at once, so from it on a batch is
introduced by a `#### From <path> — archived <date>` sub-heading. Everything above the first
such heading in a section is the 2026-08-02/06 material, which came only from root and
`client/`. The sub-headings carry provenance that an entry's own text does not: nothing inside
an entry was touched to add them.

**Citations by date still point at the package file.** Roughly fifty comments, specs, agent
prompts and scripts cite an insight as "`server/INSIGHTS.md` 2026-08-06" and are not rewritten
when it moves — dates are not unique anyway, root alone has five entries dated 2026-08-02. The
signpost is the `> Archived …` blockquote left at the foot of the section the entry came from:
it lists the dates that left, so a grep for the date in the active file lands on the pointer
rather than on nothing.

---

## What Works

### 2026-08-01 · Component tests mock the hook module, not `fetch`

Trigger:  deciding how to isolate a component that loads data
Cause:    every component reads data through `src/lib/hooks/*`, so mocking the hook module is
          both smaller and closer to the seam. Mocking `fetch` re-tests `api.ts` for no gain.
Takeaway: `vi.mock("…/lib/hooks/<domain>", …)` and render inside `NextIntlClientProvider` with
          the real `messages/en/*.json`, so a missing translation key fails the test instead of
          silently rendering the key.
Evidence: src/lib/hooks/
Status:   → promoted to `docs/component-anatomy.md`

#### From `INSIGHTS.md` — archived 2026-08-29

### 2026-08-28 · Unit-test a facade that builds its own repository by patching the FIELD, not the constructor

Trigger:  the two new `repoIntel` methods L04 is built on had to be proven never to reach
          `container.codeIndex` (the ripgrep path), which is a claim about a code path and
          cannot be made against a database.
Cause:    `RepoIntelService`'s constructor takes only a `Container` and builds
          `new RepoIntelRepository(container.db)` itself, so there is no seam in the
          signature. `repo-intel-facade-degraded.test.ts` had already solved it:
          `(svc as unknown as { repo: … }).repo = { … }` after construction, with a `container`
          literal carrying only `config`, `db: {} as never` and the ports the path touches.
          The second half is what makes it worth copying — the stubbed `codeIndex` THROWS on
          every method rather than returning `[]`. A returning stub lets the fallback run and
          pass, so "the ripgrep path is unreachable" would still be a claim; a throwing one
          makes it an assertion.
Takeaway: for any facade method that must NOT take a fallback, stub the fallback's port to
          throw. And when a service builds its own repository, patch the field — the pattern
          is established, it needs no DI change, and it keeps the unit lane Docker-free.
Evidence: server/test/repo-intel-blast.test.ts (EXPLODING_CODE_INDEX, buildService);
          server/test/repo-intel-facade-degraded.test.ts (the original)
Status:   resolved

### 2026-08-07 · A skills A/B lands on WHICH findings, not how many — count the demonstration wrong and it looks like nothing happened

Trigger:  running the control experiment on PR #484 (API Contract Reviewer, deepseek-v4-flash),
          expecting the armed arm to out-count the unarmed one
Cause:    both arms returned exactly 6 findings, 5 blockers, same verdict, same PR score. Read
          as a scoreboard the experiment is a null result. Read as a diff it is not: unarmed,
          the agent found the five changes of COMMISSION — a narrowed enum, an optional field
          gone required, a dropped response field — all of which are literally in the diff
          text. Armed, it additionally found the two-copy `vendor/shared` trap ("server and
          client will disagree"), which is a defect of OMISSION: the diff shows one edited copy
          and says nothing about the other, so it is invisible unless a checklist says to look.
          It also gained the stored-data axis and restated every remedy as a major bump or a
          deprecation window. The freed slot came from merging two findings the unarmed run
          had kept apart.
Takeaway: when demonstrating that a skill works, compare finding CONTENT, never finding count —
          and pick a defect of omission for the diff, because commission defects are exactly the
          ones a bare agent finds anyway (`docs/skills-control-experiment.md` § "If the
          unskilled run finds it anyway" says this about the diff; it is equally true of how you
          READ the result). The cheap objective evidence lives in the trace, not the findings
          list: `prompt_assembly.skills` is `null` versus 10 958 chars, the log line is absent
          versus `skills: 4 skill(s), 2644 token(s) attached (…)`, and the user message goes
          2 511 → 13 489 chars. Cost moved $0.0008 → $0.0010, so the arms are comparable.
Evidence: docs/skills-control-experiment.md § "Recorded result — 2026-08-07, PR #484"
Status:   resolved — the recipe generalises to experiment 1 and to any future skill demo

#### From `client/INSIGHTS.md` — archived 2026-08-29

### 2026-08-23 · Overlay the fresh client data on a derived-on-read endpoint instead of trying to invalidate it

Trigger:  the Smart Diff's findings badges. `GET /pulls/:id/smart-diff` computes
          `finding_lines` from the latest review, so after a Run Review it is stale by
          construction — and the obvious fix, invalidating `["smart-diff", prId]` when the
          run finishes, does not exist to be written: a review is fire-and-forget
          (`runReview()` returns `reviews: []`), and what reacts to the run SETTLING is
          `onRunDone` in `page.tsx`, which calls `refetchReviews()` — a refetch, not an
          invalidate that other keys could ride along with.
Cause:    two clocks. The endpoint answers from what the database held when it was asked;
          the screen learns about the new review through a different query entirely.
Takeaway: let the query own the part that is expensive to derive (here: the ORDER, which
          costs a classification pass) and overlay the part that changes underneath it from
          the query the screen already refreshes (`usePrReviews`). The overlay is also
          where a field the contract has no room for can live — severity per line, in this
          case. Keep the two distinguishable: `null` means "not loaded, trust the server's
          value", `[]` means "loaded, and there are none" — collapsing them into a falsy
          check makes a clean review look like a loading one. Invalidate the query only for
          the events that change what IT computes (`useDeleteRun`, `useDeleteReview`), not
          for every event that touches findings — `useFindingAction` changes no line.
Evidence: src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/helpers.ts
          (buildFindingOverlay, findingLinesFor); src/lib/hooks/reviews.ts (smartDiffKey)
Status:   resolved

### 2026-08-06 · Seed an edit draft from the EVENT that opens the editor, never from an effect

Trigger:  adding in-card rewording to `ConventionCard` and the merge modal's body editor —
          both edit text derived from a TanStack query that refetches on every accept
Cause:    the 2026-08-06 "dep array wipes the draft" entry below fixes the effect; not
          having an effect at all removes the failure mode instead. The draft is seeded by
          the click that opens the editor (`setDraft({rule: candidate.rule, …})`) and by a
          LAZY `useState(() => conventionsToDraft(accepted, …))` at modal mount, so a new
          array identity from a refetch is simply never read again. The second half is
          freezing the derived ids with it — `useState(() => accepted.map(c => c.id))` —
          or the request would merge a different set of rows than the body was written from.
Takeaway: for "open an editor over server data", prefer event-seeded / lazily-initialised
          local state to `useEffect(setDraft, [data])`. Test it by rerendering the component
          with a DIFFERENT prop value after typing and asserting the field is unchanged; and
          have the failed-write path keep the draft open (`mutateAsync` + catch) rather than
          discarding what the user typed.
Evidence: src/app/repos/[repoId]/conventions/_components/CreateSkillModal/CreateSkillModal.tsx;
          src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.tsx
Status:   resolved

### 2026-08-06 · One shared mutation hook can drive per-row pending state — read `mutation.variables`

Trigger:  the conventions screen renders N cards over ONE `useUpdateConvention()`, and
          `update.isPending` alone would have put "Accepting…" on every card at once
Cause:    TanStack Query v5 exposes the in-flight `variables` on the mutation result, so the
          list can ask *which* row is being written and towards what:
          `const pendingId = update.isPending ? update.variables?.id : undefined`, then
          `pending={pendingId === c.id ? update.variables?.patch.status : undefined}`. No
          `useState<Record<id, boolean>>` map, nothing to reset in an effect — and therefore
          none of the 2026-08-06 "query data in a dep array wipes the draft" failure mode.
          The limit is real and worth knowing: `variables` holds the LATEST call, so a bulk
          action that fires several `mutate()`s marks only the last one as pending.
Takeaway: for a list whose rows share one mutation, derive the row's busy state from
          `mutation.variables` rather than lifting a per-row flag. Reach for a local map only
          when concurrent writes must each show their own spinner.
Evidence: src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx
Status:   resolved

### 2026-08-06 · A screen-level component test has to stub `components/app-shell`

Trigger:  first tests for `SkillsListView` / `SkillsRail` — components that render a whole
          route, not a leaf. Every earlier component test stopped below the shell.
Cause:    `<AppShell>` reads far more than its `{children, crumb}` props suggest:
          `useShellContext` pulls `useActiveRepo`, `useTheme` and `usePulls(repoId)`
          (`components/app-shell/hooks/useShellContext.ts:22-29`), so rendering it drags in
          the repo provider, the theme provider, a QueryClient and the `shell` message
          namespace — none of which the screen under test is about.
Takeaway: `vi.mock("…/components/app-shell", () => ({ AppShell: ({children}) => <div>{children}</div> }))`
          and keep the test on the screen's own content. Same rule of thumb as the hook
          mocks below: stub at the seam, do not assemble the app. Pair it with mocking the
          route's hook module — and add the drawer/modal hooks a screen imports but does not
          render, or the module mock leaves those bindings undefined.
Evidence: src/app/skills/_components/SkillsListView/SkillsListView.test.tsx
Status:   resolved

## What Doesn't Work

### 2026-08-04 · Inheriting a neighbouring column's aggregation rule — `cost` is additive, `score` and `findings` are not

Trigger:  the L01 mentor review: the PR-list COST column showed one run's cost where a sum
          across the review's agents was expected
Cause:    the column was built by mirroring `PrMeta.score` (latest-review-only), and the
          comment in `pulls/routes.ts` stated one justification for all three fields at once —
          *"summing would triple-count one defect found by three agents"*. That is true of
          defects and of the score derived from them, and false of money. `runReview()` creates
          one `agent_runs` row **per target agent**
          (`server/src/modules/reviews/service.ts`), so a three-agent review put a third of the
          bill in the column — and an arbitrary third, whichever agent finished last. The
          2026-08-02 "Two severity tallies" entry (still in the active file) already warned
          that a third surface must pick its rule on purpose; COST is exactly the surface that
          copied the nearest neighbour instead.
Takeaway: before reusing the aggregation of the column next door, ask whether the quantity is
          additive. Counts of one event double-count across agents; money, tokens and durations
          do not — each run is a separate expenditure. A comment that covers several fields in
          one breath is where this hides: state the rule per field, or the field it does not fit
          inherits it silently. Note the follow-on for sums: `null` is *unknown*, so one
          unpriced run must poison the whole total to `—` rather than let a partial sum pass as
          exact.
Evidence: server/src/modules/pulls/routes.ts (`totalCostByPr`); specs/L01-run-cost.md
          (Decisions); server/test/reviews.it.test.ts ("PR list sums the cost of every done run")
Status:   resolved

#### From `INSIGHTS.md` — archived 2026-08-29

### 2026-08-28 · A constant whose name documents a rule the code does not implement — and no test can catch it while the method has no consumer

Trigger:  wiring the first consumer of `repoIntel.getBlastRadius`. Its persistent path ended
          with `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` over the FLAT array, while
          `constants.ts` documents that constant as "Caller fan-out cap per changed symbol".
Cause:    the method had no consumer at all (`grep -rn "getBlastRadius" server/src` outside
          `modules/repo-intel/` was empty), so nothing exercised the multi-symbol case and no
          test pinned the behaviour. A global cap of 20 is invisible on a one-symbol diff and
          only wrong on a PR touching several hot symbols — which then shows twenty rows
          against the first and none against the rest, without saying so. The caller sort had
          the same shape of defect: `b.rank - a.rank` alone, and two references from ONE file
          carry the same `file_rank.rank` to the last bit.
Takeaway: when you become the first consumer of a facade method, re-read what its constants
          CLAIM before trusting what its code does — an unconsumed method's behaviour has
          never been checked against its own documentation, and a green suite says nothing
          about it. Both corrections were free precisely because there was no consumer to
          break; a year later they would have been a behaviour change.
Evidence: server/src/modules/repo-intel/constants.ts (MAX_CALLERS_PER_SYMBOL);
          server/src/modules/repo-intel/service.ts (capPerSymbol, the caller sort)
Status:   resolved

### 2026-08-28 · Shortening a wait does not make a review free — `POST /pulls/:id/review` is fire-and-forget

Trigger:  L04's own test plan says to exercise `run_agent_on_pr`'s timeout branch with
          `DEVDIGEST_MCP_RUN_TIMEOUT_MS=1` "without spending a model call", and the live lane
          was about to be written that way.
Cause:    the trigger returns as soon as it has created the `agent_runs` rows;
          `ReviewService.runReview` fires `executor.executeRuns` in the background. The
          ceiling governs only how long the CALLER waits, so a 1 ms timeout produces a fast
          `still_running` answer and a full, billed review that finishes minutes later. The
          spec's sentence is wrong in a way that reads as a cost control.
Takeaway: to exercise the timeout branch for free, intercept the POST itself and answer with
          a run id that does not exist — that is both unpaid and deterministic. Assert the
          interception (`triggers === 1`), not merely that nothing threw. More generally: any
          automated thing that touches `run_agent_on_pr` must stub the trigger, never trust a
          short deadline. The same fire-and-forget shape is why `reviews: []` in the response
          is correct (`server/CLAUDE.md` § Gotchas).
Evidence: server/src/modules/reviews/service.ts (runReview); mcp/test/mcp.live.test.ts
          (the intercepted trigger); specs/L04-mcp-server.md § Test plan (the wrong sentence)
Status:   resolved — the live lane intercepts; the spec sentence is the thing that misleads

### 2026-08-25 · A gap held open on purpose gets cited as if it were closed — four files routed to an agent that did not exist

Trigger:  a review noted `.claude/agents/security-reviewer.md` was missing. It had been left
          out deliberately: `.claude/agents/README.md` § "What is deliberately not here" said
          so, and `specs/four-new-subagents.md` § Out of scope deferred it to "a separate
          decision, not за компанію".
Cause:    the decision to leave a hole was recorded in two places, and then four other files
          wrote as though it had been filled. `implementer.md` § "Not checked here" routed to
          "the security review agent"; `planner.md` and `test-writer.md` both dropped the
          `security` skill from their delta lists because it was "a separate agent's job";
          `architecture-reviewer.md` § "Not checked" excluded security pointing at a README
          bullet rather than at a destination. Every one of those sentences is written from
          the point of view of the agent that must NOT do the work, so each is true about the
          exclusion and silently wrong about where the work goes. Nothing greps for that:
          `grep -rn security .claude/agents` shows four confident routing lines and one
          bullet saying the target does not exist.
Takeaway: when a README declares a deliberate gap, grep for the DESTINATION NAME across every
          file that could route to it, and make each of those files say "nobody" in the same
          words. A document that routes to a non-existent agent is worse than one that says
          the work is unowned — the first reads as a plan, the second reads as a decision. And
          when the gap is finally closed, the same grep is the checklist: this round changed
          four files that had nothing to do with the new file itself.
Evidence: .claude/agents/security-reviewer.md; .claude/agents/README.md § "What is deliberately
          not here"; specs/L03-intent-layer.md § Round 3 (the audit row)
Status:   resolved

### 2026-08-24 · The pre-PR gate's own test harness is the fastest way to tell a false blocker from a real one

Trigger:  `/pr-self-review` on the finished L03 branch returned two CRITICALs — a
          "hand-edited migration" (`meta/_journal.json`) and a "contract changed without
          its mirror" (`brief.ts`) — and both were argued to be false positives. Arguing
          about a blocker is the state the gate exists to prevent.
Cause:    `scripts/test-pr-self-review.sh` settles it in one run, and it was already
          red: its FIRST case, "clean worktree produces no findings", was failing on
          exactly those two sources. A check that fires on a branch doing nothing wrong
          is a defect in the check, and the harness says so without anyone reasoning
          about the diff. Both were structural, not incidental:
            · drizzle-kit APPENDS to `meta/_journal.json` for every migration it
              generates, so a legitimate new migration cannot exist without an M there —
              the check fired on every PR that added one;
            · `check:contract-mirror` compared the SETS of touched lines on the two
              `vendor/shared` copies, which is a proxy for "do they agree afterwards".
              The proxy is wrong for a change that RECONCILES drift: the side that was
              behind touches more lines. Root `CLAUDE.md` records that drift as the
              standing state, so this was going to recur for the rest of the course.
Takeaway: before overriding a scripted CRITICAL, run the harness. A red baseline turns
          "I believe this is a false positive" into "the check is broken, here is the
          case that proves it" — and the fix is then bounded by a test rather than by an
          override that has to be re-argued next lesson. Corollary when relaxing a check:
          write BOTH sides of the new boundary. The journal exception got case 2b (a
          journal edit with no new migration STILL fires) as well as 2c (one beside a new
          migration does not), because a relaxation with only its negative tested is
          indistinguishable from deleting the check.
          Second corollary, learned the same run: do NOT compare the two `vendor/shared`
          trees wholesale. `adapters.ts`, `contracts/eval-ci.ts` and
          `contracts/productionize.ts` are drifted right now, and reconciling files a PR
          never touched is nobody's errand — compare only the files the diff touches.
Evidence: scripts/pr-self-review-checks.sh (checks 2 and 3);
          scripts/test-pr-self-review.sh (cases 2b, 2c, and the drift-reconciliation
          negative); 45 passed, 0 failed
Status:   resolved

### 2026-08-23 · An acceptance criterion written as a grep over source also polices the COMMENTS

Trigger:  L03 Smart Diff's criterion "every pattern lives in `constants.ts`;
          `grep -nE "package-lock|dist/|\.snap" .../{helpers,service,routes}.ts` finds
          nothing". The module was correct — no pattern outside `constants.ts` — and the
          grep still hit, on the line of `helpers.ts` that EXPLAINS why the lock check runs
          before the wiring rules.
Cause:    the criterion means "no classifying literal in code" but is written as a text
          search over the whole file, and prose is text. Rewording the comment to say "a
          lock file" and "its manifest" satisfied it, at the cost of a doc comment that can
          no longer name the case it is about — a real, if small, loss.
Takeaway: when a criterion is a grep, decide deliberately whether it should read code only
          (`grep -v '^\s*[*/]'` first, or restrict to the assignment lines) and say so in
          the spec. Otherwise expect it to bind on comments, and write the comment
          accordingly rather than "fixing" the grep after the fact. Same family as
          `server/INSIGHTS.md` (2026-08-22): a negative stated over a whole file proves less
          and breaks more than one scoped to the thing that could carry the violation.
Evidence: specs/L03-smart-diff.md § Acceptance criteria (the grep criterion);
          server/src/modules/smart-diff/helpers.ts (`classifyPath` doc comment)
Status:   resolved — the grep is clean and the criterion is ticked, with this cost recorded

### 2026-08-22 · A plan's § Out of scope is a decision about EFFORT, never about the brief

Trigger:  L03 Round 1 shipped, every one of its own acceptance criteria green. Auditing it
          against the course brief afterwards found four requirements it did not meet — and the
          most important of them, the scope filter, was sitting in the plan's own § Out of scope
          marked "a product decision".
Cause:    § Out of scope is written while planning, from the repository's constraints, and
          nothing in the process ever diffs it against the document the work is graded on. So a
          requirement can be declared out of scope by the same person who is supposed to deliver
          it, and every later check — the plan's criteria, the tests, the self-review — measures
          the narrowed plan rather than the brief. Round 1 went further and told the reviewing
          model the opposite of the requirement in so many words ("it never narrows what you
          review", `intent/helpers.ts`), which is what a plan sounds like once it has argued
          itself out of a feature.
Takeaway: before a lesson is called done, put the brief and the plan's § In scope / § Out of
          scope side by side, item by item, and write the verdict down. A line in § Out of scope
          is legitimate only when it says what will not be BUILT YET; it can never say what the
          brief does not require. Round 2's audit table in `specs/L03-intent-layer.md` is the
          shape to copy — one row per brief item, ✅/⚠️/❌, each with a `file:line`.
Evidence: specs/L03-intent-layer.md § "Audit — every brief item against what Round 1 shipped"
Status:   resolved

### 2026-08-22 · `printf '%s' | tr | while read` silently skips a single-segment command — a guard that allowed everything

Trigger:  `scripts/readonly-agent-guard.sh` was written, registered, and returned exit 0 for
          `rm -rf server/dist`. Every deny case in its table failed at once; `bash -n` was clean.
Cause:    `printf '%s'` emits no trailing newline, so `read` hits EOF on the only line, returns
          non-zero with the data still unread, and the `while` body never runs. The script did
          nothing and said nothing — exactly the failure mode a guard must not have.
          `scripts/pr-self-review-gate.sh` has the same `printf '%s' | tr` shape and is fine only
          because it pipes into `grep -q`, which does not care about the final newline.
Takeaway: any `printf … | while read` loop needs `printf '%s\n'`. And a security control's first
          test must be a DENY case that is known to fire: an allow-only table passes perfectly
          against a script that does nothing at all.
Evidence: scripts/readonly-agent-guard.sh:112 · server/test/readonly-agent-guard.test.ts
Status:   resolved

### 2026-08-02 · Building a screen from design screenshots — the prototype's source says things a PNG cannot

Trigger:  re-doing the L01 severity feature against the unpacked design prototype, after
          round 1 had shipped from two screenshots of it
Cause:    three of the five gaps were invisible in a still image. Both counter surfaces open a
          hover popover listing the findings behind the numbers
          (`src/12-prdetail_runs.jsx:38-54`); the chip row *rests* with all three severities
          active (`src/10-findings.jsx:105`), and a screenshot of that is indistinguishable
          from a screenshot taken after one click; and the counters are bare text on a dotted
          rule, which at screenshot scale reads as a filled pill. A fourth trap runs the other
          way — `FindingsPanel` is defined in the prototype but mounted on **no** screen
          (`src/main.jsx` renders only Overview / Agent runs / Files changed), so a component
          existing there is not evidence it belongs anywhere.
Takeaway: get the prototype's source before building, and ask for it when only images are
          offered — the redo cost more than the original build. Grep `src/main.jsx` for what is
          actually mounted, then read the screen file end to end: hover states, empty states
          and resting states live in the source and nowhere else.
Evidence: DevDigest-Design-unpacked/src/{10-findings,12-prdetail_runs,14-screen_dashboard,main}.jsx
Status:   resolved for L01 — applies to every remaining lesson

#### From `server/INSIGHTS.md` — archived 2026-08-29

### 2026-08-23 · A path-keyed seed backfill that only INSERTS converges on the row count and not on the columns

Trigger:  bringing seeded PR #482 from four `pr_files` rows to nine. The plan said: select
          the existing paths, insert the missing ones — which is the right shape for a
          table with no unique index, and it makes `pnpm db:seed` idempotent.
Cause:    the four rows that already existed were seeded before L03 and carry
          `patch = NULL`. Insert-only leaves them exactly as they are, so a machine that
          had ever run the old seed ends up with nine rows of which the four most
          interesting — every file the demo's findings point at — have no diff text to
          scroll to. The row count is right, `select count(*)` says converged, and the
          feature is broken on precisely the files it exists to demonstrate.
Takeaway: for seed data, "converged" means the COLUMNS match the fixture, not the count.
          Write the backfill as select → update-or-insert per key, and verify it on a
          database in the OLD state (here: the dev DB, 4 rows / 0 patches → 9 rows / 8
          patches), never only on a fresh container where every row is an insert.
Evidence: server/src/db/seed.ts (the PR #482 backfill, outside the `if (!pr)` branch);
          server/test/smart-diff.it.test.ts ("is idempotent with the seed")
Status:   resolved

### 2026-08-22 · "No line in the prompt begins with `+` or `-`" is a weaker claim wearing a stronger one's clothes

Trigger:  the assertion that proves the intent classifier is sent hunk HEADERS and never change
          bodies. Written over the whole user message, green, and it broke the moment the next
          step added a `missing_context` list rendered with `- ` bullets.
Cause:    it was never true of the whole prompt. A PR description written in markdown opens
          lines with `-` all by itself; the test only passed because every fixture body happened
          to be prose. The property it was reaching for belongs to one BLOCK — the one that
          carries the change — and stating it globally made it depend on what every other block
          happens to contain.
Takeaway: scope a "this content never appears" assertion to the section that could carry it,
          by slicing between the heading and its `</untrusted>`. A global negative over a
          composed prompt breaks on unrelated additions, and until it does it is quietly proving
          less than it says.
Evidence: server/test/intent-helpers.test.ts § "carries hunk headers into the prompt" ·
          server/test/intent.it.test.ts § "shows the classifier each file's hunk headers"
Status:   resolved

### 2026-08-12 · Giving a DTO mapper a second optional argument turns every `rows.map(mapper)` into an index injection — and TypeScript agrees to it

Trigger:  adding a derived `skill_count` to `toAgentDto(row, skillCount?: number)`, with
          `AgentsService.list` still reading `return rows.map(toAgentDto)`
Cause:    `Array.prototype.map` calls back with `(element, index, array)`, so the new parameter
          is fed the row's POSITION: the first agent reports 0 skills, the second 1, the third
          2 — plausible numbers, monotonic, and wrong. Nothing catches it: the parameter is
          `number | undefined` and the index is a `number`, so `tsc` is satisfied, and a test
          that seeds one agent passes because index 0 and "no skills" agree.
Takeaway: when a mapper gains an optional parameter, grep for point-free `.map(<mapper>)` in the
          same breath and rewrite each one as an explicit arrow. `grep -rn "map(to.*Dto)" src`
          found the single site here. Guard it with a list-level assertion that the SECOND row's
          number is right, not just the first — `skills.it.test.ts` asserts each agent gets its
          own count rather than its position.
Evidence: src/modules/agents/helpers.ts (toAgentDto); src/modules/agents/service.ts (list);
          test/skills.it.test.ts ("reports skill_count on the agent itself")
Status:   resolved

### 2026-08-07 · An assertion about the merged skill body proves nothing while the test hand-writes that body

Trigger:  re-reading `conventions.it.test.ts` — `expect(skill.body).not.toContain(RULE_CONFIG)`
          in the merge test, sitting a dozen lines under a payload whose `body` the same test
          had typed out by hand as `` `# Repo conventions\n\n- ${RULE_EARLY}\n- ${RULE_CONSTANTS}` ``
Cause:    the server has no merged-body builder — the modal composes that text and the user
          edits it before `POST .../skill` sees it, which the spec's Test plan states outright.
          So the only way the body could contain the rejected rule is if the test put it there.
          The assertion was a tautology about the test's own string literal, and it read as
          coverage of the acceptance criterion "a rejected rule must not reach a prompt".
Takeaway: when the server stores a caller's text verbatim, an assertion on that text tests the
          CALLER. Compose it in the test the way the client composes it — filter the rows the
          server just reported as `accepted`, render them — and then the same `not.toContain`
          is about the filter. Pair it with the two assertions that are genuinely the server's:
          `skill.body === body` (it does not recompose) and that the body quotes the snippet
          read back from the clone, not the model's rendition. General form: before writing an
          assertion, ask which component would have to be broken for it to fail.
Evidence: test/conventions.it.test.ts (composeSkillBody, "merges only the accepted candidates")
Status:   resolved

### 2026-08-06 · An insert-only create behind a FIXED default name is a feature that works exactly once

Trigger:  the merge modal defaults every skill to `repo-conventions`; the SECOND merge of a repo
          returned 422 `A skill named "repo-conventions" already exists.` — and it returned it
          after the user had accepted more rules and composed the whole body
Cause:    `createFromConventions` only ever INSERTed, and `assertNameFree` is workspace-scoped.
          Merging is not a one-shot act — accept three rules, merge, accept two more, merge
          again — so the second call is the normal path, not an edge case. Review missed it
          because every test merged once, which is also the shape of the happy-path demo.
Takeaway: when a create endpoint hands the caller a FIXED default name, it is an upsert whether
          or not it is written as one. `saveFromConventions(..., replaceId)` + `repo.update`
          makes a re-merge a version bump, with the old body landing in `skill_versions`. Decide
          what may be replaced from OWNERSHIP, never from the name alone: `replaceableSkillId`
          requires an `extracted` skill that this repo's own candidates already point at via
          `skill_id`, so two repos sharing a workspace still collide and rename rather than
          silently overwrite each other. The general habit: write the test for the SECOND call.
Evidence: src/modules/skills/service.ts (saveFromConventions);
          src/modules/conventions/service.ts (replaceableSkillId);
          test/conventions.it.test.ts ("re-merging the same repo versions the skill")
Status:   resolved

### 2026-08-06 · Seeding a new agent `enabled: true` silently repriced every "run all" review

Trigger:  L02 adds two agents (Test Quality, API Contract) to `seed.ts`; the obvious default
          for a seeded agent is enabled, and nothing in the diff looks like a cost change
Cause:    `ReviewService.resolveAgents` turns `all: true` into `agentsRepo.listEnabled(...)`,
          and "Run all enabled agents" is the primary item in the run dropdown. Two more
          enabled agents = five LLM calls per click instead of three, on a flow the change
          was not supposed to touch at all.
Takeaway: `agents.enabled` is not a UI convenience — it is the membership test for the
          fan-out, so it is a per-run cost multiplier. Seed a demo agent DISABLED and drive
          it by name; `RunReviewDropdown` runs a specific agent regardless of the flag, so
          nothing about the demo is lost. Pinned by an assertion in `skills.it.test.ts` that
          the enabled set still excludes both.
Evidence: src/modules/reviews/service.ts:50, src/db/seed.ts (seedAgents)
Status:   resolved

### 2026-08-01 · `POST /pulls/:id/review` returning `reviews: []` is correct

Trigger:  the response body looks empty even though the review runs fine
Cause:    the route creates the `agent_runs` rows, returns the runIds immediately, and fires
          `executor.executeRuns(...)` without awaiting. Results are persisted later; the
          client subscribes to `/runs/:id/events` and refetches on completion.
Takeaway: do not add an await to "fix" the empty array — it would block the request for the
          entire LLM call and break the SSE subscription window.
Evidence: src/modules/reviews/
Status:   → promoted to `CLAUDE.md` (Gotchas)

#### From `client/INSIGHTS.md` — archived 2026-08-29

### 2026-08-12 · A route's `?tab=` allow-list is a SECOND copy of the tab bar — add a tab and it renders, then bounces back to the first one

Trigger:  Stats and Versions appeared in the skill editor's tab bar, every component test
          passed, and clicking either one in the browser snapped straight back to Config
Cause:    `skills/[id]/page.tsx` carried `const VALID_TABS = ["config", "preview"]` and resolved
          `?tab=` against it, while the bar was rendered from `SkillEditor/constants.ts`'s
          `TABS`. Adding a tab to `TABS` therefore produced a control that sets a query value
          its own page rejects. No test could see it: `SkillEditor` renders whatever `tab` prop
          it is handed, so all four panes were covered while the thing that CHOOSES the pane was
          not — the page had no test at all. `agents/[id]/page.tsx` had the identical shape, in
          sync only because nobody had added a tab yet.
Takeaway: derive the allow-list — `export const TAB_KEYS = TABS.map(t => t.key)` — and let the
          first entry be the fallback, so the route cannot disagree with the bar. More generally:
          when a screen's control lives in a component and its URL contract lives in the page,
          the pair needs a PAGE-level test with a case per value (`page.test.tsx` here, one
          assertion per tab plus an unknown one). Mocking a page is cheap: `useParams` /
          `useSearchParams` / `useRouter`, the hooks module, `components/app-shell`, and
          `ToastProvider` — which the root layout supplies in the app and a page test does not.
Evidence: src/app/skills/[id]/page.tsx; src/app/skills/[id]/page.test.tsx;
          src/app/skills/[id]/_components/SkillEditor/constants.ts (TAB_KEYS)
Status:   resolved — both editor routes now derive their keys

### 2026-08-06 · `onSuccess: () => invalidate()` discards the response — and that cost two different bugs

Trigger:  a saved rule edit showed the OLD text for one round-trip, and the conventions screen
          never displayed the discard report the extract endpoint had been built to return
Cause:    both mutations ignored their own result. `useUpdateConvention` gets the updated
          `ConventionCandidate` back from the PATCH and only invalidated, so the card closed its
          editor and re-rendered stale text until the refetch landed — on screen that is
          indistinguishable from a save that failed. `useExtractConventions` gets `sampled_files`
          and `discarded[]`, which exist NOWHERE else (the list endpoint returns only the
          survivors), and dropped them — so three cards read as "this repo has three conventions"
          rather than "the model proposed twenty and seventeen cited lines that are not there".
Takeaway: before writing `onSuccess: () => invalidateQueries(...)`, ask what the response
          carried. If it is the updated row: `setQueryData` first, invalidate after — the cache
          write makes the change instant, the refetch keeps the client honest. If it carries data
          no query will ever return, the mutation result is the ONLY copy — `mutation.data`
          survives after settling, so render it from there. The tell for the second case is an
          endpoint whose response type is wider than the list type it refreshes.
Evidence: src/lib/hooks/conventions.ts;
          src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx
Status:   resolved

### 2026-08-06 · The design's empty artboard REPLACES the screen — porting the header over it duplicates the CTA

Trigger:  the conventions screen shipped with two identical "Run extraction" buttons on an
          empty repo, caught by a test that could not resolve `getByRole("button")`
Cause:    the prototype's empty variant is an early return, not a branch inside the body:
          `if (empty) return AppFrame(EmptyState)` — no `<h1>`, no toolbar, no scan button
          (`conventions-and-conformance.jsx:70`). Building the populated screen first and then
          adding `EmptyState` under the header — the obvious order — gives the header's
          primary action and the EmptyState's `cta` the same job and the same words. Every
          empty artboard in the design is built this way (`e-ci`, `e-tour`, `e-context`,
          `e-conv` in `reference-app.jsx:168-184` all pass `empty` to the same component).
Takeaway: read the design's `empty` branch before laying out the header, and decide which of
          the two surfaces owns the action. Keeping the heading for orientation is a fine
          deviation; keeping the header's BUTTON is not. A component test that queries a
          button by name is what catches this — `getByRole` throws on a duplicate, so write
          the empty-state test with `getByRole`, not `getAllByRole`.
Evidence: src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx
Status:   resolved

### 2026-08-06 · A query result in an effect's dep array wipes the local draft it was meant to seed

Trigger:  the agent editor's Skills tab: every checkbox click appeared to do nothing, and
          three tests failed with the draft reverting to the saved order
Cause:    `React.useEffect(() => setDraft(null), [agent.id, links])` — `links` is the array
          from `useAgentSkills`. TanStack Query hands back a NEW array identity on every
          refetch, and this tab's own save calls `setQueryData` + `invalidateQueries`, so the
          effect fired and discarded the user's in-progress edit. Under the test's mocked
          hook the identity changed on literally every render, which turned an intermittent
          production bug into a deterministic failure.
Takeaway: an effect that resets local edit state must depend on the ENTITY IDENTITY being
          edited (`agent.id`), never on the fetched collection. Clear the draft explicitly in
          the mutation's `onSuccess` instead. Rule of thumb: if a dep is a query's `data`,
          ask what a background refetch would do to the user mid-typing.
Evidence: src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx
Status:   resolved

## Codebase Patterns

### 2026-08-29 · `.default()` on a Zod contract field is optional on input and REQUIRED on `z.infer` — a "purely additive" mirror edit breaks every literal in both packages

Trigger:  adding `project_context: z.boolean().default(true)` to `Agent` in
          `vendor/shared/contracts/knowledge.ts` and its mirror. The edit looked additive; the
          next `pnpm typecheck` was red in **both** packages with four `TS2741 Property
          'project_context' is missing` — one server mapper and three client test fixtures.
Cause:    `.default()` makes a field optional for `.parse()` **input** and required on the
          inferred output type. Every place that builds the object as a literal — rather than
          parsing one — must gain the key in the same breath.
Takeaway: before adding any field to a shared contract, sweep the producers:
          `grep -rn ": <Type> = {" server/src server/test client/src`. Every pure literal it
          finds belongs to the same step and the same commit as the contract edit; a *mapper*
          may be deferred only if a later step is named for it out loud. A plan step whose
          `Verify` runs `pnpm typecheck` but whose `Files:` omits those literals asserts a gate
          it cannot pass, and stops a correct implementation dead.
Evidence: server/src/vendor/shared/contracts/knowledge.ts:381; server/src/modules/agents/helpers.ts:20;
          client/src/app/agents/_components/AgentCard/AgentCard.test.tsx:11
Status:   resolved — the sweep is now a rule in `specs/plans/L05-project-context-folder.md` § Gate discipline

### 2026-08-29 · `wrapUntrusted` is applied by `assemblePrompt`, not by its callers — and it escapes, so a server-side pre-wrap corrupts what the user sees

Trigger:  a plan step said "every body through `wrapUntrusted()`" before handing documents to
          `PromptParts.specs`. Doing that would have been wrong.
Cause:    `assemblePrompt` already wraps each `parts.specs[i]` as `spec-N`
          (`reviewer-core/src/prompt.ts:149-151`), and `wrapUntrusted` **escapes** any
          `</untrusted>` inside its input (`:29-32`). A pre-wrap therefore does not merely
          double-delimit — the outer wrap escapes the inner one, and the mangled `<\/untrusted>`
          is persisted into `run_traces.prompt_assembly`, which the Run Trace drawer renders to
          the user. `renderSkillBlocks` **does** wrap, correctly, because the engine does *not*
          wrap `parts.skills`. The two renderers look symmetrical and are not.
Takeaway: check which slots `assemblePrompt` wraps before wrapping anything yourself. Today:
          `specs`, `repoMap`, `callers` and `diff` are wrapped by the engine; `skills` is not.
          Pin the decision with a test that asserts the block leaves the server unwrapped **and**
          that exactly one delimiter reaches the assembled prompt, so a later well-meaning wrap
          fails loudly instead of quietly corrupting a trace.
Evidence: reviewer-core/src/prompt.ts:29-32,149-151,161-162; server/src/modules/reviews/helpers.ts:181-207;
          server/test/context-prompt.test.ts:88-116
Status:   resolved

### 2026-08-06 · `FEATURE_MODELS` says its defaults "mirror each module's constants" — for `conventions` there is no module to mirror

Trigger:  picking the model for the conventions extractor, and reaching for
          `resolveFeatureModel(container, ws, 'conventions')` because that is the function with
          the obvious name
Cause:    the registry's own doc comment (`contracts/platform.ts:31-36`) promises "the defaults
          MIRROR each module's constants, so behaviour is unchanged until a model is explicitly
          picked". Four of the five entries are `gpt-4.1` or a deepseek flash. `conventions` is
          `openai / gpt-5.4` — the priciest default in the file — and it mirrors nothing, because
          no conventions module existed to have a constant. `resolveFeatureModel` would have
          silently bought that model on every scan. The escape is already documented one file over
          (`modules/settings/feature-models.ts:30-35`: "callers that keep their own dynamic default
          (e.g. conventions) use this directly"), but it reads as a style note, not a bill.
Takeaway: for a feature whose module is being written now, `getFeatureModelOverride` + a
          module-local constant — never `resolveFeatureModel`. Check the registry's default before
          trusting the "unchanged behaviour" promise: it only holds where the old constant exists.
          Note the registry is duplicated in `client/src/lib/feature-models.ts` (the client cannot
          import the runtime value), so the Settings row is already visible for features with no
          code behind them.
Evidence: server/src/vendor/shared/contracts/platform.ts:73-79;
          server/src/modules/settings/feature-models.ts:30-35; specs/L02-conventions-extractor.md
Status:   → promoted to `server/CLAUDE.md` § Conventions on 2026-08-30, at its second sighting:
          `risk_brief` was already in `FeatureModelId` with an `openai / gpt-4.1` default and a
          rendered Settings row pointing at nothing, so the PR brief CLAIMED the slot rather than
          creating one. `resolveFeatureModel` still has no caller; the first one should re-check this

### 2026-08-01 · The two `vendor/shared` trees have already diverged

Trigger:  comparing `server/src/vendor/shared` with `client/src/vendor/shared`
Cause:    there is no workspace and no build step keeping them in sync — they are two
          physical copies. Five files differ today. The server copy is ahead: it has
          `sessionId` on LLM options, `openrouter` in the `LLMProvider.id` union,
          `CommitFiles`, `AgentManifest`, and `AgentVersionConfig`.
Takeaway: harmless right now (the drift is confined to server-only ports the client never
          imports), but a contract edit **must** be applied to both copies. Diff them before
          committing anything under `vendor/shared`.
Evidence: server/src/vendor/shared vs client/src/vendor/shared
Status:   → promoted to `CLAUDE.md` (Gotchas)

### 2026-08-01 · An empty table in the schema is a future lesson, not dead code

Trigger:  `db/schema/` defines ~35 tables while the starter reads maybe a third of them
Cause:    the schema is intentionally complete from day 1 so lessons L01–L08 only ever add
          columns, never restructure. Same idea in `reviewer-core`: the `skills`, `memory`,
          and `specs` prompt slots exist and are simply never filled by the starter.
Takeaway: never "clean up" an unused table, contract, or prompt slot. Check the lesson table
          in `README.md` first.
Evidence: server/src/db/schema/
Status:   → promoted to `CLAUDE.md` (Gotchas)

### 2026-08-06 · A shape duplicated inside `vendor/shared` itself, not just across the two copies

Trigger:  adding `imported_file` to `SkillSource` in `contracts/knowledge.ts`, mirrored to the
          client copy — and the value still would not round-trip through a plugin export
Cause:    `contracts/productionize.ts` does not import `SkillSource`. `PluginSkill.source` has
          its OWN inline `z.enum([...])` with the same four members written out again. The
          mirror discipline everyone knows about is server-copy ⇄ client-copy; this is a
          second, quieter duplication *within* one copy, and nothing checks it.
Takeaway: after editing an enum or object in `vendor/shared`, grep the other contract files
          for its member names, not just for the symbol — an inline re-declaration will not
          show up in an import search. Left divergent here on purpose: `productionize.ts` is
          L08's file and is already drifted between the two trees, so widening the diff into
          it would have traded one debt for a worse one.
          Confirmed a second time on 2026-08-06 by the conventions extractor: `PluginConvention`
          (`productionize.ts:60-67`) re-declares the whole convention shape, `accepted: z.boolean()`
          included, so it did not move when `ConventionCandidate` gained `status`. Same file, same
          reason for leaving it — it is L08's, and already drifted between the two trees.
Evidence: server/src/vendor/shared/contracts/productionize.ts (PluginSkill.source, PluginConvention)
Status:   → promoted to `CLAUDE.md` (Gotchas). `PluginSkill.source` and `PluginConvention` stay
          behind their `knowledge.ts` originals until L08 touches that file

### 2026-08-02 · Correction: `PrMeta` needs `.nullish()` too, for a different reason

Trigger:  adding `findings_by_severity` to `PrMeta`, and reading the 2026-08-01 entry below,
          which says response-only contracts read straight from a table are free to use
          `.nullable()`
Cause:    that rule is incomplete. `PrMeta` is exactly such a shape, yet `.nullable()` would
          break it: `PrDetail = PrMeta.extend({...})` and `GET /pulls/:id` never emits the
          list-only fields at all. `.nullable()` requires the key to be *present*, so the
          detail endpoint would fail on a field it deliberately does not compute. That is why
          `score` and `cost_usd` are already `.nullish()` — the reason is structural, not the
          legacy-jsonb one.
Takeaway: before choosing `.nullable()`, check whether the schema is `.extend()`ed anywhere
          and whether every endpoint building the extended shape actually emits the field.
          The guard is cheap: `PrDetail.parse({...})` without the key, in `contracts.test.ts`.
Evidence: server/src/vendor/shared/contracts/platform.ts (PrMeta.findings_by_severity);
          server/test/contracts.test.ts
Status:   resolved — amends the entry below, which stays as written

### 2026-08-01 · A contract that also serializes a persisted jsonb doc needs `.nullish()`, not `.nullable()`

Trigger:  adding `cost_usd` to `RunStats` for L01, mirroring how the pre-removal code
          (commit `d45ab0d`) had declared it as `z.number().nullable()`
Cause:    `RunStats` is not only a response shape — it is the `stats` block **inside** the
          jsonb document stored in `run_traces.trace`, and rows written before the field
          existed have no `cost_usd` key at all. `.nullable()` requires the key to be
          present, so `GET /runs/:id/trace` would have 500'd on every historical run. The
          old code got away with `.nullable()` only because that field had been written
          since day one. Same trap waits on any future `RunStats`/`RunTrace` field.
Takeaway: before tightening or adding a field on `contracts/trace.ts`, ask whether old rows
          in `run_traces` carry it. If not, `.nullish()`. Response-only contracts read
          straight from a table (e.g. `RunSummary`) are free to use `.nullable()`.
Evidence: server/src/vendor/shared/contracts/trace.ts (RunStats.cost_usd);
          server/test/contracts.test.ts ("RunTrace parses a LEGACY stats block")
Status:   resolved — guarded by the legacy-stats fixture test

### 2026-08-01 · There is no landing page — `/` is a redirect

Trigger:  writing anything that assumes a stable home screen
Cause:    `src/app/page.tsx` redirects to the first repo's PR list, and falls back to
          `/onboarding` when the repo list is empty. What you see depends entirely on DB state.
Takeaway: never assert on "the home page". Browser flows that follow the redirect implicitly
          depend on which repo happens to be first — see `../e2e/INSIGHTS.md`.
Evidence: src/app/page.tsx
Status:   → promoted to `client/CLAUDE.md` (Gotchas)

#### From `INSIGHTS.md` — archived 2026-08-29

### 2026-08-28 · A `done` spec can be live code — `mcp/test/copy.test.ts` asserts the L04 Appendix byte for byte, character count included

Trigger:  a mentor review asked for `provider` to be dropped from `list_agents`. The tool
          description naming it lives in `mcp/src/copy.ts`, so the edit looked like one line
          in one package.
Cause:    `mcp/test/copy.test.ts` re-reads `specs/L04-mcp-server.md` § Appendix AT TEST TIME,
          parses its fenced blocks, and asserts each tool description matches byte for byte —
          plus the character count declared in the block's own `### … — NNN chars` heading.
          Editing `copy.ts` alone turns that lane red; editing the Appendix without
          recomputing the count does too. `specs/README.md` rule 5 ("never delete a spec;
          history explains why the code looks the way it does") reads as though every closed
          spec is inert, and for this one section it is the opposite.
Takeaway: before changing any string in `mcp/src/copy.ts`, `grep -n "chars" specs/L04-mcp-server.md`
          and move the Appendix first — the file's own rule is "the Appendix changes first and
          `copy.ts` follows". Recompute the count mechanically rather than by eye (632 → 622
          for a ten-character deletion). More generally: before assuming a `specs/` file is
          history, grep the test suites for its path — a spec a test reads is a source file.
          A round that edits a closed spec still appends its own `# Round N` section and
          leaves the prose as written; the Appendix is the one part that moves in place, and
          the round says why it had to.
Evidence: mcp/test/copy.test.ts:22 (SPEC_PATH), :98-107 (the character-count assertion);
          specs/L04-mcp-server.md § Appendix, § Round 2 D18
Status:   resolved

### 2026-08-23 · Seeded `patch` text is a contract with the CLIENT's parser — and nothing checks it

Trigger:  seeding PR #482's nine files so a findings badge could scroll the diff to
          `config.ts:12`, `webhooks.ts:61`, `users.ts:45`, `ratelimit.ts:28`
Cause:    which line a patch renders is decided by `client/src/components/diff-viewer/
          helpers.ts` `parsePatch`: it takes the NEW-side start from each `@@ -a,b +c,d @@`
          and increments once per `+`/context line, never on a `-`. So a finding's
          `start_line` is only reachable if the hunk header and the lines above it add up
          to that number. Nothing on either side asserts this — the server does not read
          patches, and the client has no fixture tying a seeded finding to a seeded hunk.
          Two of the four headers were off by exactly the net size of an earlier hunk.
Takeaway: when seeding or editing `patch` text that a feature jumps into, replay the
          parser's numbering over it before committing (a dozen lines of script: reset the
          counter at `@@`, skip `-` lines, record the number of every rendered line, assert
          each finding's `start_line` is in the map). Treat the hunk header as data under
          test, not as decoration. The degraded path — scroll to the card header when no
          rendered line matches — is what saves the reader when this is wrong, so build it
          in the same change.
Evidence: server/src/db/seed.ts (PR_482_FILES);
          client/src/components/diff-viewer/FileCard/FileCard.tsx (the focus effect);
          client/.../SmartDiffViewer.test.tsx ("falls back to the card header")
Status:   resolved

### 2026-08-21 · The canonical path -> skills routing table lives inside a REVIEW skill, so anything else that needs it must point, not copy

Trigger:  authoring `.claude/agents/planner.md` and `.claude/agents/implementer.md`, both of
          which need to know which project skill applies to which file
Cause:    the only maintained path -> skills map in this repo is section 3 of
          `.claude/skills/pr-self-review/SKILL.md` ("Route by path *and* by status"). Its name
          and its location say "pre-PR gate", so the obvious move when writing a new agent is
          to write a fresh table into the agent file - and then two tables drift, exactly the
          way `vendor/shared` does. That skill already carries the correct instinct in its own
          words ("Repo conventions are read, never copied") and the discovery command that
          keeps it honest: `ls -d .claude/skills/*/`, never `skills-lock.json`, which names
          skills that are not on disk and misses several that are.
Takeaway: any new agent, skill or doc that routes work to skills cites that section by path
          instead of restating it, and states only its DELTAS. For implementation-time use the
          deltas are three: add `design-reference` on UI steps (before the code, not after),
          drop `security` and drop `engineering-insights` - a self-reviewing implementer
          produces a green that hides findings, and two agents appending to `INSIGHTS.md` in
          parallel is how it gets a conflict.
Evidence: .claude/skills/pr-self-review/SKILL.md:55-89; .claude/agents/planner.md step 4;
          .claude/agents/implementer.md step 2
Status:   resolved - both new agents reference the table rather than duplicating it

### 2026-08-02 · e2e flows assert seed literals, so `seed.ts` is part of their contract

Trigger:  adding findings to the demo review, from the server package
Cause:    `e2e/specs/04-pr-findings.flow.json` waits on the literal strings `"2 findings"` and
          `"Hardcoded Stripe secret key in commit"`. Neither `seed.ts` nor anything in
          `server/` mentions this; the coupling is only visible from the e2e side. Changing
          the number of seeded findings silently breaks a flow in another package.
Takeaway: after editing `server/src/db/seed.ts`, grep `e2e/specs/*.json` for the values you
          changed. Note also that flows follow the home redirect to the **first** repo, so
          they need a freshly seeded single-repo DB — the dev DB will not do.
Evidence: e2e/specs/04-pr-findings.flow.json; server/src/db/seed.ts
Status:   → promoted to `CLAUDE.md` (Gotchas) on 2026-08-06, after the L02 conventions seed
          made it the second edit to `seed.ts` that had to be checked against the flows.
          Kept here for now — the flow/DB detail in the takeaway does not fit one line

#### From `server/INSIGHTS.md` — archived 2026-08-29

### 2026-08-28 · `PrMeta.status` is DERIVED, not the column — a third producer will disagree and nothing will complain

Trigger:  adding `GET /pulls/lookup` as a second endpoint returning `PrMeta`, built from the
          persisted row alone. The obvious mapping — pass `pull_requests.status` straight
          through — compiles, validates and is wrong.
Cause:    the `status` COLUMN holds GitHub's merge state (`open`/`merged`/`closed`); the
          `PrMeta.status` FIELD is review freshness (`needs_review`/`reviewed`/`stale`), which
          `GET /repos/:id/pulls` derives with `deriveReviewStatus(ghStatus, lastReviewedSha,
          headSha, updatedAt)`. `PrStatus` accepts both vocabularies, so neither Zod nor `tsc`
          objects: the lookup would have reported `open` for the same PR the list reports
          `needs_review`, and the two `PrMeta` producers would silently disagree.
Takeaway: any new endpoint returning `PrMeta` must call `deriveReviewStatus` (pure, persisted
          columns only, no GitHub) rather than reading the column. When two endpoints return
          one contract, the derived fields are the ones to check first — an enum wide enough
          to hold both meanings is exactly why the bug is invisible. Related, found the same
          round: `_shared/schemas.ts` holds only `IdParams` despite being described as where
          every request schema lives; module-specific request schemas live at the top of their
          own `routes.ts` (`agents/routes.ts:11,14,33,46`).
Evidence: server/src/modules/pulls/status.ts (deriveReviewStatus); server/src/modules/pulls/routes.ts
          (both PrMeta producers); server/src/vendor/shared/contracts/platform.ts (PrStatus)
Status:   resolved

### 2026-08-25 · `RunLogger` reaches exactly one module, so every service it calls is invisible in the Live Log

Trigger:  a review said the Live Log emits no amber events during the intent derivation. Two
          amber lines DO exist — `run-executor.ts` wraps the call in
          `runLog.step('Deriving PR intent', …, { kind: 'tool' })` — and the observation was
          still right about everything between them.
Cause:    `grep -rn RunLogger server/src` returns `platform/run-logger.ts` and
          `modules/reviews/run-executor.ts`, and nothing else. The executor is the only module
          holding a logger, so a service it calls has no way to say anything. `IntentService`
          spends its time in three external calls — a clone read per plan file, the linked-issue
          fetch, the model call — and emitted nothing for any of them, so the log went amber
          once and then silent for up to `INTENT_TIMEOUT_MS` (60 s; the default provider caps at
          90 s regardless). `step()` gives you a TIMING, not visibility: it says the work
          started and how long it took, which is exactly what you already knew.
Takeaway: `tool` is painted `var(--warn)` in `LiveLogStream.tsx` and means EXTERNAL I/O — so
          only the module doing the I/O can emit it honestly. To give one a voice, declare a
          two-method structural port (`tool` / `info`) in that module and pass `runLog` in;
          `RunLogger` satisfies it as it stands, so nothing adapts and nothing imports
          `platform/`. Keep the split: a conclusion drawn without leaving the process stays
          `info`, or the colour stops carrying information. When wrapping any multi-second
          service call in `step()`, ask what the user sees for the seconds in the middle.
Evidence: server/src/modules/intent/service.ts (`IntentProgress`, and the emits in `gather`
          and `deriveFor`); server/src/modules/reviews/run-executor.ts:381;
          server/test/intent.it.test.ts § "paints the derivation's external calls amber"
Status:   resolved

### 2026-08-25 · An "answer in English" rule will translate the one field that must stay verbatim

Trigger:  `INTENT_SYSTEM_PROMPT` had no constraint on output language, while its reply reaches
          two English-only surfaces — the Intent card (rendered from `messages/en/`) and
          `## PR intent (derived)` in every reviewing agent's prompt.
Cause:    the obvious fix ("write your reply in English") is wrong for one field.
          `IntentReplySchema.evidence[].quote` is the author's own words, kept so a reader can
          open `ref` and find them; a translated quote is no longer checkable, and the field
          silently stops doing its job. Nothing in the schema or the card would show it — the
          quote still renders, it just no longer matches its source.
Takeaway: before adding an output-language rule to any prompt, list the reply's fields and ask
          which are OUR prose and which are quoted from a source. Name the exception in the
          prompt explicitly; a model told "answer in English" translates everything, including
          what it was asked to copy. Same question applies to any future field holding a path,
          an identifier or a code fragment.
Evidence: server/src/modules/intent/constants.ts (`INTENT_SYSTEM_PROMPT`, the `LANGUAGE` block
          and the doc comment above it); server/src/modules/intent/helpers.ts:388-395
Status:   resolved

### 2026-08-06 · A `ContainerOverrides` field typed as a service CLASS cannot be overridden by anything

Trigger:  adding `conventions` to `ContainerOverrides` so a test (or a browser flow that must
          never reach a model) can stand in a stub
Cause:    TypeScript compares classes with `private` members nominally — a private field makes
          the type satisfiable only by instances of that exact class. `conventions?:
          ConventionsService` therefore types a field whose only legal value is a real
          `ConventionsService`, which is not an override at all. Every existing override in
          that interface happens to be a port INTERFACE (`GitClient`, `RepoIntel`, …), so the
          trap never surfaced before a service was brokered there.
Takeaway: expose the verbs, not the class: `export type ConventionsApi = Pick<ConventionsService,
          'extract' | 'list' | 'update' | 'createSkill'>`, and type both the override and the
          getter with it. A dedicated interface file (repo-intel's `types.ts`) is the heavier
          alternative and buys nothing until a second implementation exists.
Evidence: server/src/modules/conventions/service.ts (ConventionsApi);
          server/src/platform/container.ts (ContainerOverrides.conventions)
Status:   resolved

### 2026-08-06 · A convention candidate's line range is a search hint, not an assertion — rejecting wide ranges would protect nothing

Trigger:  reviewing `verifyCandidate` and noticing that nothing bounds `end_line - start_line`
Cause:    the claimed range is never tested beyond "it exists in the file". The check searches
          `[start - SNIPPET_CONTEXT_LINES, end + SNIPPET_CONTEXT_LINES]` for the normalized snippet
          and returns the offset where it was **found**, together with the file's own text for those
          lines. A model claiming lines 1-900 for a one-line snippet therefore gets the same verdict
          as one claiming 3-3: the numbers that get stored are where the code actually is. A wide
          range buys cheaper search, never false evidence.
Takeaway: the grounding guarantee lives in the snippet match and the read-back from disk, not in the
          numbers the model sent — a max-range rule would discard good evidence and prevent nothing.
          The constant that does need care is `SNIPPET_CONTEXT_LINES`: it is drift tolerance, and
          widening it trades grounding for recall until "near line 40" stops meaning anything.
Evidence: src/modules/conventions/helpers.ts (verifyCandidate); test/conventions-helpers.test.ts
          ("accepts a snippet the model placed one line off, and corrects the numbers")
Status:   resolved

#### From `client/INSIGHTS.md` — archived 2026-08-29

### 2026-08-06 · The design's `CodeEditor` has no port, and `BRIDGE.md` does not say so

Trigger:  the N7 artboard `conv-create` renders the merged skill body in `window.CodeEditor`;
          grep found no such export in `@devdigest/ui`, and BRIDGE.md's mapping table does
          not list it in either direction — neither ported nor named as missing
Cause:    the port covers `foundation/primitives.jsx` + `ui-kit.jsx`; `CodeEditor` lives
          outside both, so it fell out of the table silently. Every design screen that shows
          editable code or markdown (skill body, agent prompt, eval input) hits this.
Takeaway: substitute, do not port: `<Textarea mono rows={…}>` inside a `FormField` whose
          `right=` slot carries `~{tokens} tokens · {chars}/{max} chars` from
          `approxTokens()` (`@/lib/tokens`). That is what `SkillEditor/…/ConfigTab` already
          does, and the two screens edit the same field — a CodeEditor on one of them would
          make the same text look like two different things. Adding the primitive means
          touching `vendor/ui`, which needs an explicit request.
Evidence: src/app/repos/[repoId]/conventions/_components/CreateSkillModal/CreateSkillModal.tsx;
          src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/ConfigTab.tsx
Status:   resolved

### 2026-08-06 · `@devdigest/ui`'s `<Markdown>` tags its output `.dd-md` but ships no CSS for it

Trigger:  the skill Preview tab rendered headings and lists at browser defaults — Times-ish
          `h1`, no spacing — nothing like the rest of the app
Cause:    `primitives/Markdown.tsx` only overrides `p`, `strong`, `code` and `a` inline; every
          other element relies on the `.dd-md` wrapper class, and `grep dd-md` across
          `vendor/ui/styles.css` and the app's CSS returns nothing. The class is a hook that
          was never given rules.
Takeaway: any screen rendering `<Markdown>` with real documents (headings, lists, fences,
          tables) must bring its own `.dd-md` rules. Put them in that component's `styles.ts`
          and inject with a scoped `<style>` — `vendor/ui` is off-limits, and a global rule
          would be an invisible dependency for the next screen that uses the component.
Evidence: src/app/skills/[id]/_components/SkillEditor/styles.ts (MARKDOWN_CSS)
Status:   resolved

### 2026-08-02 · A card with `overflow: hidden` silently clips anything its rows pop up

Trigger:  the PR list's new findings popover rendered in the DOM, passed its test, and was
          invisible in the browser
Cause:    `pulls/styles.ts` `tableCard` carried `overflow: hidden` to clip the rows to its
          rounded corners. That clips every absolutely-positioned descendant too — popover,
          dropdown, tooltip — no matter how high its `z-index`. The design's own dashboard sets
          `overflow: visible` on the same container for exactly this reason.
Takeaway: before adding a hover popover, dropdown or tooltip to a table row, check the
          container's `overflow` first — the symptom is "renders, but nothing appears", which
          reads like a state bug and is not one. The trade is that the last row's corners no
          longer clip; the design accepts it.
Evidence: client/src/app/repos/[repoId]/pulls/styles.ts (tableCard);
          DevDigest-Design-unpacked/src/14-screen_dashboard.jsx:111
Status:   resolved

## Tool & Library Notes

### 2026-08-06 · `/pr-self-review --override` cannot unblock a scripted CRITICAL, though both the skill and the checks say it can

Trigger:  L02 ended with three scripted CRITICALs, all verified false positives — a
          user-authorised `vendor/ui/nav.ts` edit, a contract mirror whose two copies are now
          byte-identical, and a schema change `pnpm db:generate` confirms needs no migration
Cause:    `scripts/pr-self-review-gate.sh` section 3 re-runs the checks and `exit 2`s on any
          CRITICAL **before** it ever opens `last-verdict.json`. The override lives in that
          file and is only consulted in section 6, which section 3 never reaches. So the
          escape hatch the checks themselves advertise ("or run: /pr-self-review --override")
          does nothing for the findings that print it. Verified by feeding the gate a
          `gh pr create` payload: exit 2 with an override recorded.
Takeaway: for a scripted CRITICAL there are only two real options — change the code so the
          check stops firing (the right answer for the secret-literal one: a test fixture did
          not need a credential-shaped string), or `DEVDIGEST_SKIP_PR_REVIEW=1`. Three of the
          twelve checks are heuristics that cannot see intent: `check:contract-mirror`
          compares changed LINES, so repairing pre-existing drift on one side trips it even
          though the files end up identical; `check:schema-migration` cannot tell a DDL change
          from a TS-only enum widening. Either teach section 3 about the override, or stop
          suggesting it there.
Evidence: scripts/pr-self-review-gate.sh:60-78, .claude/skills/pr-self-review/SKILL.md §7
Status:   resolved 2026-08-30 — section 3 now reads the override before it blocks, taking the
          entry's own first option ("teach section 3 about the override"). It is honoured only
          when `override.reason` is present AND the verdict's `diff_sha` equals the current
          digest, so it still retires itself on the next edit; a digest that cannot be computed
          is not a match, deliberately unlike the file's general "an internal error allows the
          command" policy, because here an error would wave a CRITICAL through.
          `scripts/test-pr-self-review.sh` goes 41 passed / 4 failed → 42 / 3: it fixes
          "a recorded override releases a failing verdict" and breaks nothing. The three that
          remain share one cause the suite names itself in its first line —
          "clean worktree already fires: check:vendor-ui" — the same authorised `nav.ts` edit,
          which makes the two "a passing verdict allows" cases fail downstream. They go green
          when that edit stops firing, not through this file.
          The second half of the takeaway still stands and is NOT done: `check:contract-mirror`
          comparing changed lines, and `check:schema-migration` unable to tell DDL from a TS-only
          enum widening, are still heuristics that cannot see intent.

### 2026-08-05 · `set -euo pipefail` turns a vanishing untracked file into a silently empty digest

Trigger:  `scripts/test-pr-self-review.sh` failed 3 cases, then 5, then 0 on identical input —
          every failure was a gate case expecting "allow"
Cause:    `scripts/pr-self-review-hash.sh` hashed untracked files with
          `git ls-files --others -z | xargs -0 -r shasum -a 256` inside a `pipefail` script. A
          worktree is live: the suite itself plants and removes untracked files, so a path can
          disappear between the listing and the hashing. `shasum` then exits non-zero, `pipefail`
          aborts the whole script, and it prints **nothing**. Callers that do
          `X="$(hash.sh || echo "")"` get an empty string and skip whatever it guards — in the
          gate's case, the entire staleness check, so a verdict recorded for a different diff
          would have sailed through without a word.
Takeaway: any pipeline over `git ls-files --others` needs `|| true`; the digest is worth more
          intact-minus-one-file than absent. And a consumer must distinguish "computed and
          differs" from "could not compute" — collapsing the second into the first is how a gate
          starts allowing silently. Reproduce with a background `rm` racing the hash.
Evidence: scripts/pr-self-review-hash.sh (untracked-file block); scripts/pr-self-review-gate.sh
          (the empty-`NOW_SHA` branch)
Status:   resolved

### 2026-08-05 · `git diff --name-status` letters are relative to the merge-base, not to HEAD

Trigger:  a check that only fires on a modified file would not fire when the file was demonstrably
          being modified — `server/.dependency-cruiser-known-violations.json` reported `A`
Cause:    the review base is `git merge-base HEAD origin/main`, and that file was created by a
          commit **on this branch**. Against the base it is an addition, and it stays one no
          matter how many later commits edit it. Every file a branch introduces behaves this way.
Takeaway: a status filter of `M` means "existed at the branch point", not "changed now". Rules
          about editing something that already shipped are correct with `M`; rules about content
          must accept `A` as well. To exercise an `M`-only rule from inside the branch that
          created the file, re-base the single case onto the commit that added it.
Evidence: scripts/pr-self-review-checks.sh (check 2, check 10); scripts/test-pr-self-review.sh
          (`BASE_OVERRIDE`)
Status:   resolved

### 2026-08-05 · A dependency-cruiser rule that matches nothing looks exactly like a rule that passes

Trigger:  the first onion-guard config reported "no violations" while `modules/pulls/routes.ts`
          was demonstrably importing `drizzle-orm`
Cause:    npm dependencies resolve to their on-disk path, `node_modules/drizzle-orm/index.cjs`,
          so `to: { path: '^drizzle-orm' }` matches no module. It must be
          `to: { dependencyTypes: ['npm'], path: 'node_modules/(drizzle-orm|postgres)/' }`.
          Two neighbouring traps: `to: { anyOf: [...] }` is not valid schema (split it into two
          rules, the CLI errors out), and a rule listing a module's own barrel — e.g.
          `repo-intel/index.ts` re-exporting `./routes.js` — fires a false positive unless
          `^src/modules/[^/]+/index\.ts$` is in `pathNot`.
Takeaway: never trust a green depcruise run you have not seen fail. Prove each new rule by
          planting a violation (`mkdir src/modules/__probe && echo "import { eq } from
          'drizzle-orm'" > src/modules/__probe/service.ts`), confirming exit code 1, then
          removing it. `pnpm arch:check:all` shows the frozen list for comparison.
Evidence: server/.dependency-cruiser-onion.cjs (header comment)
Status:   resolved

### 2026-08-02 · `defaultNow()` is transaction start time, so "newest row wins" can tie exactly

Trigger:  writing an integration test for "the PR list counts the latest review" and finding
          there was nothing safe to assert about *which* review wins
Cause:    Postgres `now()` — what `defaultNow()` compiles to — returns the **transaction's**
          start timestamp, not the statement's. Rows written in one transaction (three agents'
          reviews, a batch seed) therefore share `created_at` to the microsecond, and
          `orderBy(desc(createdAt))` + "first row wins" degenerates into planner order. No
          column can break the tie by recency either: every id in this schema is
          `uuid().defaultRandom()`.
Takeaway: for any "latest per group" read, add `desc(<pk>)` as a secondary sort key. It does not
          make the pick *correct* — it makes it **stable**, which is the property a test can
          assert ("two identical requests return the same tally") and the one users notice.
          Real ordering under a tie needs `clock_timestamp()` or a monotonic column, i.e. a
          migration.
Evidence: server/src/db/schema/_shared.ts:9; server/src/modules/pulls/routes.ts;
          server/test/reviews.it.test.ts ("two reviews share a timestamp")
Status:   → promoted to `CLAUDE.md` (Gotchas) on 2026-08-06, after the conventions repository
          needed the same secondary sort key. Ordering correctness under a tie is still
          deferred to a migration.

#### From `INSIGHTS.md` — archived 2026-08-29

### 2026-08-28 · `.mcp.json` takes a per-server `timeout`, and it is one half of a pair that nothing else keeps ordered

Trigger:  a mentor review: `.mcp.json` declares no `timeout`, so a client can give up while
          `run_agent_on_pr` is still legitimately waiting.
Cause:    Claude Code supports a per-server `timeout` in milliseconds (≥ 1000) in each
          `.mcp.json` entry; it overrides `MCP_TOOL_TIMEOUT` for that server alone, and
          `claude mcp get devdigest` prints it back as `Timeout: 180000ms`. The reason it had
          never bitten locally is worth knowing before diagnosing one: Claude Code's own
          default tool timeout is hours long, so it is other clients — the Inspector included
          — whose defaults are shorter than a 120 s review. The real hazard is that the bound
          was implicit, and that the two numbers that must stay ordered
          (`.mcp.json` `timeout` > `DEVDIGEST_MCP_RUN_TIMEOUT_MS`) sit in different files with
          nothing between them. If the client wins that race, the model never sees the
          `still_running` sentence naming `get_findings`, and its next move is a second paid
          run.
Takeaway: declare `timeout` explicitly for any tool that blocks on purpose, keep it strictly
          above the server's own wait, and pin the ordering with a test that READS
          `.mcp.json` rather than restating the number — `mcp/test/config.test.ts` does, and
          it was verified by lowering the value to parity and watching the lane go red. A
          guard for an invariant nobody has seen fail is worth one deliberate failure.
Evidence: .mcp.json (timeout: 180000); mcp/src/config.ts (DEFAULT_RUN_TIMEOUT_MS);
          mcp/test/config.test.ts § "the client's timeout in .mcp.json"
Status:   resolved

### 2026-08-28 · dependency-cruiser omits `import type` — so `file_edges` has no row for a type-only dependency

Trigger:  L04's spec named a "direction control": the demo PR's changed file
          `src/auth/authorization.ts` imports `../domain/models`, so an inverted traversal
          would put `domain/models.ts` in the blast map. The criterion passed — and then
          `select … from file_edges where from_file='src/auth/authorization.ts'` returned
          NOTHING at all.
Cause:    the file's one import is `import type { Order, User } from '../domain/models'`, and
          `cruise()` runs with `tsPreCompilationDeps` at its default of `false`
          (`server/src/adapters/depgraph/index.ts` sets `exclude`, `doNotFollow` and
          `tsConfig`, and nothing else). Type-only imports vanish at compile time, so
          dependency-cruiser does not report them. The edge is not filtered by our adapter —
          it is never emitted.
Takeaway: `file_edges` is the RUNTIME import graph, not the TypeScript one. Anything reading
          it — blast, PageRank, `resolveReferences` — is blind to a type-only dependency, so
          a file that is imported only for its types has no rank and no dependents. And a
          test whose whole point is a graph edge must assert that the edge EXISTS before
          trusting what its absence proves; here the control was vacuous and the criterion
          still went green.
Evidence: server/src/adapters/depgraph/index.ts (the cruise options);
          server/test/blast.it.test.ts (the seeded direction control that replaced it)
Status:   resolved — the control moved into a test that seeds its own edge

### 2026-08-28 · The char count in an Appendix heading is load-bearing — `copy.test.ts` asserts it

Trigger:  rewriting `get_blast_radius`'s tool description when the stub became real. The
          fenced block and `mcp/src/copy.ts` were updated together, and `pnpm test` still
          failed.
Cause:    `mcp/test/copy.test.ts` parses `### \`<tool>\` — NNN chars` out of the heading and
          asserts `block.text.length === NNN`, on top of the byte-for-byte comparison against
          `copy.ts`. Changing a description therefore touches THREE places, and the heading is
          the one that reads like decoration. A second assertion in the same file pinned the
          old CONTENT ("keeps get_blast_radius announcing itself as not implemented"), which
          is correct while the tool is a stub and has to be inverted when it stops being one.
Takeaway: to change a tool description: edit the Appendix fence, recompute its length, update
          the heading's count, mirror into `copy.ts`, then re-read `copy.test.ts` for an
          assertion about that tool's WORDING. The guard is doing its job — it is just wider
          than "the two copies agree".
Evidence: mcp/test/copy.test.ts ("matches the character count each Appendix heading declares");
          specs/L04-mcp-server.md § Appendix
Status:   resolved

### 2026-08-28 · A cross-package `paths` alias does not force a Zod major — the `zod` SELF-PIN beside it does

Trigger:  `mcp/` needs Zod 4 (`@modelcontextprotocol/server@2.0.0` requires `^4.2.0` for
          Standard Schema, which Zod 3 does not implement) while `server/` and
          `reviewer-core/` are on `zod@^3.24.1`. Copying `reviewer-core/tsconfig.json`'s
          paths block — the `@devdigest/shared` alias PLUS its `zod` self-pin — made
          `cd mcp && pnpm typecheck` fail with one error, in the server's source:
          `contracts/platform.ts(97,72): TS2769` on
          `z.record(FeatureModelId, FeatureModelChoice).default({})`.
Cause:    Zod 4 infers an EXHAUSTIVE `Record<K, V>` for an enum-keyed record, so `{}` stops
          being a legal default. The contract is correct under the Zod 3 its package runs.
          The plan (L04 D14) read this as "the alias makes tsc compile Zod 3 source under
          Zod 4" and offered two fallbacks, both of which spend something: drop the alias
          and hand-copy the shapes, or fall back to the older SDK line. Both were
          unnecessary. `mcp/` and `server/` are separate package trees, so with NO `zod`
          entry in `paths` each side resolves its own Zod by ordinary node resolution
          (`mcp/` 4.4.3, `server/` 3.25.76) and the alias compiles clean. The self-pin is
          the whole cause; `reviewer-core` carries it harmlessly only because it is *also*
          Zod 3.
Takeaway: when a cross-package alias fails across a dependency major, delete the self-pin
          before dropping the alias — one tsconfig line versus a growing file of hand-copied
          types. Verify BOTH directions rather than arguing: flip the line, re-run typecheck,
          and prove the coupling still bites with a deliberate error (`a.slug` on `Agent`
          must produce TS2339). That coupling is the only drift guard `mcp/` has, since no CI
          workflow covers it.
Evidence: mcp/tsconfig.json (paths — alias, no zod); server/src/vendor/shared/contracts/platform.ts:97;
          mcp/CLAUDE.md § Gotchas
Status:   resolved

### 2026-08-25 · A vendored skill can be written for a stack this repo does not have — correct it in a delta table, never by forking

Trigger:  writing `security-reviewer` on top of `.claude/skills/security/`, which is vendored
          and locked by hash in `skills-lock.json`.
Cause:    the skill is "OWASP Top 10:2025 for React + Express + MongoDB + JWT". This repo is
          Fastify 5 + Postgres/Drizzle and has NO user auth at all — `LocalNoAuthProvider`
          returns the default workspace and system user. Applied literally, three of its ten
          categories aim at code that does not exist: A05 operator injection (Drizzle
          parameterises), A07 token verification (there are no tokens), and its secrets advice
          points at `process.env` while this repo's rule is one chokepoint at
          `adapters/secrets/local.ts`. It also has no category at all for the surface that
          matters most here — untrusted text reaching a prompt.
Takeaway: check a vendored skill's assumed stack before routing work to it, and record the
          mismatch as a delta table inside the CONSUMER (the agent, the routing rule), not by
          editing the skill: a locked skill is re-pulled by hash and a fork puts a second copy
          under maintenance. Keep the skill's own confidence ladder — HIGH reports, MEDIUM
          notes, LOW is not reported — because that part is stack-independent. The same check
          is owed to any other vendored skill whose frontmatter names a framework.
Evidence: .claude/agents/security-reviewer.md § "Step 1 — load the skill, then correct it for
          this repository"; .claude/skills/security/SKILL.md (frontmatter + § OWASP Top 10);
          server/src/modules/_shared/context.ts:10-12
Status:   resolved

### 2026-08-22 · Subagent frontmatter has no `hooks:` — but every hook payload carries `agent_type`

Trigger:  three agent files and `.claude/agents/README.md` all claimed the subagent frontmatter
          schema "accepts `disallowedTools` and a `hooks:` block scoped to a single agent",
          citing it as the known upgrade that would make `Bash`-read-only a real boundary.
Cause:    half of it was wrong. The subagent definition schema in Claude Code 2.1.240 carries
          `description`, `tools`, `disallowedTools`, `prompt`, `model`, `mcpServers`,
          `criticalSystemReminder_EXPERIMENTAL`, `skills`, `initialPrompt`, `maxTurns`,
          `background`, `memory`, `effort`, `permissionMode`, `observer`, `observerMessage`.
          There is no `hooks:` field. `disallowedTools` is real.
Takeaway: to scope a `PreToolUse` rule to one agent, register ONE repo-level hook and branch on
          `agent_type` inside it — the shared payload builder sets `agent_type` and `agent_id` on
          every hook event, `PreToolUse` included, so the script can see both the agent and the
          command string. That is the only place a per-agent argument rule can live. Verify a
          frontmatter field against the installed binary before writing prose about it:
          `strings -a "$(readlink -f "$(which claude)")" | grep -oE "disallowedTools:.{0,1500}"`
          prints the schema with its `.describe()` strings.
Evidence: scripts/readonly-agent-guard.sh:10-18 · .claude/agents/README.md § Permissions
Status:   resolved

### 2026-08-22 · `grep -E '(Write|Edit)'` on an agent's `tools:` line always fires — `TodoWrite` contains `Write`

Trigger:  verifying that the new read-only `architecture-reviewer` really lacks write access,
          with the check the plan had specified:
          `grep -E '^tools:' <file> | grep -Eq '(Write|Edit)' && echo FAIL || echo OK`
Cause:    the line is `tools: Read, Grep, Glob, Bash, Skill, TodoWrite`. Every agent in this
          repository carries `TodoWrite`, and a substring match on `Write` hits it, so the
          check reports FAIL on a file that is correct — and, worse, would report FAIL just as
          loudly on a file that is genuinely broken. It cannot distinguish the two.
Takeaway: `tools:` is a comma-separated list, so verify it as a list, not as a string. Split
          and match whole entries:
          `grep -E '^tools:' f | sed 's/^tools: *//' | tr ',' '\n' | sed 's/ //g' | grep -qx Write`.
          The same trap is waiting for `Read` (`ReadMcpResource`) and any future tool whose
          name contains another's. Applies to every "does this agent lack tool X" assertion in
          a plan's `Verify:` line.
Evidence: .claude/agents/architecture-reviewer.md:4; .claude/agents/plan-verifier.md:4;
          specs/four-new-subagents.md § "Implementation plan" Step 1 (the check as originally
          written)
Status:   resolved — the four new agent files were verified with the list-aware form

### 2026-08-06 · Drizzle's `text(name, { enum })` emits a bare `text` column — widening an enum needs no migration

Trigger:  L02 needed a fifth `SkillSource` (`imported_file`) and the plan budgeted a migration
          for it, on the assumption that the enum was enforced in the database
Cause:    `text('source', { enum: [...] })` is a TYPE-level narrowing only. `0000_init.sql`
          defines the column as plain `"source" text NOT NULL`, and `grep -c CHECK` over that
          file returns 0 — the schema has no CHECK constraint anywhere. Nothing in Postgres
          knows the allowed values, so adding one is a TypeScript edit plus the matching Zod
          enum, and `git status src/db/migrations` stays clean.
Takeaway: before planning a migration for an enum change, check whether the column is a real
          PG enum or a `text` with a TS-side `{ enum }`. In this repo it is always the latter.
          The corollary is the warning: an existing row can hold a value the enum no longer
          lists, and only the Zod parse at the edge will notice — so NARROWING one is the
          change that needs care, not widening.
Evidence: server/src/db/schema/skills.ts:13, server/src/db/migrations/0000_init.sql:316
Status:   resolved

#### From `server/INSIGHTS.md` — archived 2026-08-29

### 2026-08-06 · `pnpm db:generate` blocks on a rename prompt the moment one migration both drops and adds a column — only `expect` gets past it

Trigger:  reshaping `conventions` (drop `accepted`, add six columns) in one pass; `pnpm db:generate`
          printed "Is `category` column in `conventions` table created or renamed from another
          column?" and sat there until the 120 s timeout
Cause:    drizzle-kit cannot tell a drop+add from a rename, so it asks — once per added column,
          with `create column` pre-selected. Its prompt library reads the TTY directly, so
          **nothing piped answers it**: `printf '\n\n' | pnpm db:generate` and
          `script -q /dev/null bash -c "printf '\n' | pnpm db:generate"` both leave the prompt
          exactly where it was and write no files (the run does abort cleanly — `git status
          src/db/migrations` stays empty, so a failed attempt costs nothing).
Takeaway: drive it with `expect`, which is at `/usr/bin/expect` on this machine:
          `spawn pnpm db:generate` + `expect -re {created or renamed from another column} { send
          "\r"; exp_continue }` + `eof`. Pressing return takes `create column`, which is the right
          answer for a genuine drop+add. The alternative — two generate runs, drop first then add —
          avoids the prompt but leaves two migration files for one logical change.
          `drizzle-kit generate` needs no database either way; it diffs against
          `migrations/meta/<last>_snapshot.json`.
Evidence: server/src/db/migrations/0011_violet_ken_ellis.sql; server/drizzle.config.ts
Status:   resolved

### 2026-08-06 · drizzle-kit emits `ADD COLUMN … NOT NULL` with no default and no warning

Trigger:  tightening `conventions.category`/`evidence_*` to NOT NULL, expecting `db:generate` to
          object or to ask for a backfill value
Cause:    it does neither. `0011_violet_ken_ellis.sql` line 5 is
          `ALTER TABLE "conventions" ADD COLUMN "category" text NOT NULL;` — valid SQL that
          Postgres accepts on an empty table and rejects on a populated one. The failure therefore
          lands at `pnpm db:migrate`, on whichever machine has rows, not at generate time on yours.
Takeaway: a NOT NULL column addition is only safe if the table is provably empty — check
          `select count(*)`, not the seed script, and say so in the spec. Otherwise add it
          nullable, backfill, then tighten in a second migration. Same applies to
          `ALTER COLUMN … SET NOT NULL` (lines 1-4 of the same file).
Evidence: server/src/db/migrations/0011_violet_ken_ellis.sql:1-7
Status:   resolved

### 2026-08-06 · `fflate.unzipSync`'s `filter` runs over the central directory — use it to read ONE entry

Trigger:  skill import must extract `SKILL.md` from an uploaded bundle while provably never
          reading the `install.sh` next to it
Cause:    `unzipSync(bytes)` decompresses everything up front, so "read one file" naively
          means decompressing all of them and ignoring the rest — which is exactly the claim
          the feature must not make. `unzipSync(bytes, { filter })` instead invokes the
          callback once per central-directory entry with `{ name, size, originalSize }` and
          decompresses only the entries it returns true for.
Takeaway: two passes. First `filter: () => false` — collects every name and `originalSize`
          while decompressing nothing, which is also where the zip-bomb check belongs (sum
          `originalSize` BEFORE inflating anything). Then a second call filtered to the one
          chosen name. Bytes of every other entry are never touched, and the test asserts it
          by checking a sentinel string from `install.sh` is absent from the parsed draft.
Evidence: src/modules/skills/helpers.ts (draftFromZip), test/skills-helpers.test.ts
Status:   resolved

### 2026-08-06 · A prompt that lives in two hand-synced files needs a test, not a comment

Trigger:  `server/CLAUDE.md` says an agent prompt must be mirrored between
          `docs/agent-prompts/<n>.md` and `src/db/seed-prompts.ts` "by hand"
Cause:    that instruction has no enforcement, and the two copies are a ~90-line template
          literal versus a markdown file — a drift between them is invisible in review.
Takeaway: `test/agent-prompts-mirror.test.ts` asserts each file equals its constant. It cost
          five lines and it also retro-verified that the three original prompts were already
          in sync. Any future "keep these two in sync by hand" note in this repo deserves the
          same treatment.
Evidence: test/agent-prompts-mirror.test.ts
Status:   resolved

#### From `client/INSIGHTS.md` — archived 2026-08-29

### 2026-08-28 · A query held back by `enabled` is `isPending`, never `isLoading` — reading the wrong one renders NOTHING

Trigger:  the Blast tab drew a blank card for the whole window in which `usePullDetail`
          resolved, which is the tab's normal first paint. Every test was green.
Cause:    React Query v5 defines `isLoading = isPending && isFetching`. A disabled query
          never fetches, so it sits at `isPending: true, isLoading: false, data: undefined`.
          A component that guards with `if (isLoading) return <Skeleton/>` and then
          `if (!data) return null` therefore renders nothing at all for exactly as long as
          the gate is closed — and every gate in this client is deliberate (`useBlast`,
          `useSmartDiff`), so this is the common path, not an edge. The same guard swallowed
          a non-404 failure, since `isError` leaves `data` undefined too.
Takeaway: with an `enabled` gate, branch on `isPending` for the placeholder and on `isError`
          for the failure, and keep `!data` for the genuine "there is no such thing" answer.
          And a mock of the hook has to HONOUR `enabled` — one that answers with a populated
          payload regardless renders a state the component cannot reach, so the test asserting
          the gate cannot fail for the reason the gate exists.
Evidence: client/src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/BlastTab.tsx
          (the isPending/isError guards); BlastTab.test.tsx (the mock that reads `enabled`)
Status:   resolved

### 2026-08-23 · jsdom has no `scrollIntoView` — stub it on `Element.prototype`, and read `mock.instances` to learn WHICH element scrolled

Trigger:  proving that a findings badge scrolls the diff to the flagged line, and that a
          finding outside every hunk scrolls to the card header instead
Cause:    jsdom implements no scrolling API at all, so the component throws unless
          `Element.prototype.scrollIntoView = vi.fn()` is set first. And once it is stubbed,
          `expect(spy).toHaveBeenCalled()` passes for BOTH behaviours — the assertion cannot
          tell the line jump from the header fallback, which is the only thing worth
          testing about them.
Takeaway: `vi.fn()` records the receiver of every call in `mock.instances`, so the target is
          `scrollIntoView.mock.instances[0] as HTMLElement` — then assert something that
          identifies it (`getAttribute("data-line")`, or its `textContent`). Give the
          scrollable rows a `data-*` anchor for exactly this reason; it is also what the
          component uses to find them (`querySelector('[data-line="45"]')`), so the test and
          the implementation agree by construction. The highlight that follows is read off
          the style ATTRIBUTE, per the 2026-08-02 `var()` entry below.
Evidence: src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx
          ("scrolls the diff to the flagged line, and highlights it")
Status:   resolved

### 2026-08-12 · A synthetic mouse drag never starts an HTML5 drag — verify DnD by dispatching `DragEvent` with a real `DataTransfer`

Trigger:  checking the new drag-to-reorder on the agent Skills tab in the actual browser;
          `computer left_click_drag` across two rows moved nothing, which reads as a broken
          feature
Cause:    `dragstart` is fired by the browser's own drag recogniser, and CDP's synthetic
          mousedown/mousemove/mouseup do not feed it (real drags need `Input.dispatchDragEvent`).
          Nothing in the app ran at all. jsdom has the mirror-image gap: no `DataTransfer`
          implementation, so `fireEvent.dragStart(el)` hands the handler `undefined` and
          `e.dataTransfer.setData` throws.
Takeaway: two verifications, two techniques. In the browser, drive it from
          `javascript_tool`: build one `new DataTransfer()`, dispatch `dragstart` on the source
          and `dragover`/`drop` on the target with `{bubbles: true, cancelable: true}` — React's
          delegated handlers fire on untrusted events, and reading the styles requires an
          `await` first, because the state update is a rerender, not a synchronous write. In
          vitest, pass a stub: `fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(),
          getData: () => id, effectAllowed: "", dropEffect: "" } })`.
Evidence: src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx;
          .../SkillsTab.test.tsx (the `dt()` helper)
Status:   resolved

### 2026-08-12 · `@devdigest/ui`'s chart primitives are shaped for MONEY and SCORES — an integer count comes out as "$5.00"

Trigger:  porting the design's "Findings by category" donut for the skill Stats tab, over counts
          like `{ category: 'bug', count: 5 }`
Cause:    `charts/Donut.tsx` renders each legend value as `valuePrefix + value.toFixed(2)`, with
          `valuePrefix` defaulting to `"$"` — it was built for the cost breakdown, and there is
          no way to ask it for a plain integer (`valuePrefix=""` still yields "5.00").
          `CircularScore` has a related quirk: it draws its own number inside the ring, so a tile
          that also prints the value renders it TWICE, and `getByText("67")` throws on the
          duplicate — use `getAllByText` and assert the length.
Takeaway: for integer breakdowns use `BarRow`, whose right-hand number is the `suffix` string you
          pass (`value`/`max` only drive the bar width — the number is NOT derived from `value`).
          Keep `Donut` for currency. Before reaching for a chart primitive here, read how it
          formats its numbers; the design system encodes the unit, not just the shape.
Evidence: src/vendor/ui/charts/Donut.tsx; src/vendor/ui/charts/BarRow.tsx;
          src/app/skills/[id]/_components/SkillEditor/_components/StatsTab/StatsTab.tsx
Status:   resolved

### 2026-08-06 · `Textarea` swallows extra props, `TextInput` forwards them — only one can take an `aria-label`

Trigger:  labelling the in-card rule editor so its test could use `getByLabelText("Rule")`;
          `aria-label` on `<Textarea>` did nothing and TypeScript rejected `id`
Cause:    `vendor/ui/kit/TextInput.tsx` ends its props with
          `& Omit<React.InputHTMLAttributes<HTMLInputElement>, …>` and spreads `...rest` onto
          the input; `vendor/ui/kit/Textarea.tsx` declares five props and spreads nothing.
          Two sibling primitives, opposite prop contracts, and `vendor/ui` is do-not-touch.
Takeaway: nest the control inside its `<label>` — implicit association names both kinds of
          field and is what `getByLabelText` resolves. `FormField`'s label is NOT associated
          with its child (no `htmlFor`, child is a sibling), so a screen built from
          `FormField` has to be queried by `getByDisplayValue` or
          `document.querySelector("textarea")`, the way the skill-editor tests do.
Evidence: src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.tsx;
          src/vendor/ui/kit/Textarea.tsx vs src/vendor/ui/kit/TextInput.tsx
Status:   resolved

### 2026-08-02 · jsdom drops any CSS declaration containing `var()`, so `toHaveStyle` is blind to every design token

Trigger:  asserting that the severity counters render as dotted-underlined text in the
          severity colour; the component was correct and the test failed with an empty diff
Cause:    React writes `style="border-bottom: 1px dotted var(--crit)"` onto the element — the
          attribute is verifiably there — but jsdom's computed-style parser refuses to accept a
          declaration containing `var()`, so `toHaveStyle` sees nothing. Longhands
          (`borderBottomColor`) behave identically. Since nothing in this codebase styles with
          literal colours, this defeats every token-based visual assertion, not just border ones.
Takeaway: assert on `element.getAttribute("style")` with `toContain("... var(--crit)")`. Do not
          reach for `getComputedStyle` or try to inject the token — the parser, not the
          cascade, is what drops it.
Evidence: client/src/app/repos/[repoId]/pulls/_components/SeverityCounters/SeverityCounters.test.tsx
Status:   resolved

### 2026-08-23 · Two `setParam` calls in one tick keep only the last param — `search` does not advance between them

Trigger:  a badge in the Smart Diff has to land on `?tab=findings&findingId=…`, and the
          page already had a `setParam(key, val)` helper that looked like it could be
          called twice
Cause:    `setParam` builds its URL from `new URLSearchParams(search.toString())`, and
          `search` is the render's `useSearchParams()` value. Two calls in the same tick
          both read the SAME pre-navigation snapshot, so the second `router.replace`
          overwrites the first's URL and the first param is gone. Nothing errors; the
          navigation happens, one param short. Fixed by `setParams(patch)` taking a record
          and doing one `replace`, with `setParam` rewritten in terms of it.
Takeaway: any helper that derives the next URL from the CURRENT `search` is single-use per
          tick. If two params move together, they have to move in one call — and a helper
          shaped `(key, value)` quietly invites the bug, so give it the plural form as
          soon as a second param exists.
Evidence: client/src/app/repos/[repoId]/pulls/[number]/page.tsx (setParams)
Status:   resolved

### 2026-08-02 · `borderColor` is itself a shorthand — pairing it with `borderLeftColor` makes React warn

Trigger:  adding a filter to `FindingsPanel`, which made its cards rerender for the first
          time; every click printed "Updating a style property during rerender (borderColor)
          when a conflicting property is set (borderLeftColor)"
Cause:    `FindingCard/styles.ts` already carried a comment saying it used all-longhand to
          avoid exactly this, but `borderColor` sets all four sides, so it still conflicts
          with the `borderLeftColor` that draws the severity stripe. The warning had simply
          never fired, because nothing in the panel used to rerender. Fixed by spelling out
          `borderTopColor` / `borderRightColor` / `borderBottomColor`.
Takeaway: "longhand" in React's warning means *per-side*, not merely "not `border`".
          `borderColor`, `borderWidth`, `margin`, `padding` are all shorthands. If a style
          object sets one side explicitly, set the other three explicitly too — and note that
          a static component can hide this class of bug indefinitely.
Evidence: client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/styles.ts
Status:   resolved

## Recurring Errors & Fixes

#### From `server/INSIGHTS.md` — archived 2026-08-29

### 2026-08-01 · A "running" run that never finishes is usually a dead process, not a hang

Trigger:  a run stuck at `running` in the UI with no events arriving
Cause:    `RunBus` is in-memory. If the API restarted mid-run, the executor died with it: the
          row stays `running`, the SSE stream has nothing to replay, and there is no runner
          left to cancel. `reapStaleRuns()` on the next boot is what clears these.
Takeaway: check `agent_runs.status` and `run_traces` in the DB before assuming the engine
          hung. `cancelRun` deliberately marks the row cancelled **and** completes the bus so
          orphaned runs can also be dismissed from the UI.
Evidence: src/platform/sse.ts
Status:   → promoted to `CLAUDE.md` (Gotchas)

---

## Where the line budget actually stands

After the 2026-08-30 batch (L06 eval lab): the root `INSIGHTS.md` is **~660 lines** and the
diagnosis below has only hardened — 22 of its entries are now `open`. Four more moved here on
2026-08-30 and that bought ~85 lines; everything else that qualifies is either from the same
day as the session that wrote it or pinned to an open pair. Root shrinks by CLOSING open items.

After the 2026-08-29 batch: `server/INSIGHTS.md` 193 lines, `client/INSIGHTS.md` 109 — both
comfortably under the ~250 budget. The root `INSIGHTS.md` was **419 and could not go lower by
archiving**: 15 of its entries are `open`, one more is pinned to an open pair, and together
they are ~300 lines on top of a 52-line header. Root shrinks by *closing* open items, not by
moving them. `mcp/` (181), `e2e/` (106) and `reviewer-core/` (71) were left untouched — they are
under budget, and this file exists to serve the budget, not to drain the active files.
