# Insights — cross-package

Append-only. One entry per thing that surprised us, cost us time, or turned out not to be
what it looked like. Package-specific findings go in that package's `INSIGHTS.md`; this file
is only for what spans packages or the repo as a whole.

Written and read by the `engineering-insights` skill — see
[`.claude/skills/engineering-insights/SKILL.md`](.claude/skills/engineering-insights/SKILL.md).

## Sections

Every `INSIGHTS.md` in this repo carries the same seven sections, in this order. An empty one
stays, marked `_None yet._`, so there is always a place to append.

| Section | For |
|---|---|
| What Works | an approach that was tried and held up — reuse it |
| What Doesn't Work | a dead end or antipattern. **Most valuable, most often left empty** |
| Codebase Patterns | a convention or architectural decision the code does not announce |
| Tool & Library Notes | a quirk of a dependency, CLI, or the local environment |
| Recurring Errors & Fixes | a symptom seen more than once, with its fix |
| Session Notes | a dated summary, only when no single entry captures the session. Sparingly |
| Open Questions | left unresolved, so the next session does not re-derive it |

## Entry format

Newest first within a section.

```markdown
### YYYY-MM-DD · One-line title
Trigger:  what we were doing / what we saw
Cause:    what was actually going on
Takeaway: what to do differently next time
Evidence: path/to/file.ts:LINE
Status:   open | resolved | → promoted to <file>
```

An entry must be **non-obvious**, **specific** (names a file, symbol, or number),
**actionable cold**, and **durable**. "Be careful with async" is noise, not a lesson.

**Promotion rule:** an entry that saves us twice becomes a one-line rule in the relevant
`CLAUDE.md` and is marked `→ promoted` here. Keep each file under ~250 lines; once promoted
entries pile up, move them to `docs/insights-archive.md`.

---

## What Works

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

## What Doesn't Work

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

### 2026-08-01 · Docs drift found during the first full repo walkthrough

Trigger:  onboarding pass over the whole repository
Cause:    three statements in committed docs no longer match the code —
          (1) `README.md` and `server/README.md` say `DEVDIGEST_CLONE_DIR` defaults to
              `./clones`, but `server/src/platform/config.ts` defaults to
              `~/.devdigest/workspace`;
          (2) `TESTING.md` says `server/package.json` is `skip-worktree`, but no
              skip-worktree flag is set (`git ls-files -v` is clean);
          (3) `.gitignore` carries exceptions for `agent-runner/dist/`, and that package
              does not exist in the starter (it returns in L06).
Takeaway: treat prose in READMEs as a hypothesis, verify against code before acting on it.
          None of these are blocking, but each can burn twenty minutes.
Evidence: server/src/platform/config.ts
Status:   open — fix opportunistically when touching those files

> Archived 2026-08-06: *inheriting a neighbouring column's aggregation rule* (2026-08-04,
> resolved with L01's cost column) → [`docs/insights-archive.md`](docs/insights-archive.md).

## Codebase Patterns

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

### 2026-08-22 · The onion skill's own review checklist ends on a question `arch:check` cannot answer

Trigger:  writing `architecture-reviewer`'s procedure on top of
          `.claude/skills/onion-architecture/tooling.md` § "Review checklist for a backend diff"
Cause:    item 9 of that checklist is *"Does `pnpm arch:check` still exit 0?"*. It does — even
          when a cross-module import was just added, because `no-cross-module-import` is
          declared `severity: 'warn'` in `server/.dependency-cruiser-onion.cjs:96`, and
          dependency-cruiser exits 0 on warnings. `server/INSIGHTS.md` (2026-08-06) already
          records the exit-code half of this, but nothing connects it back to the checklist
          that a reviewer is told to follow, so the skill quietly instructs you to run a test
          that cannot fail for the rule it is most likely to catch.
Takeaway: read the **output** of `pnpm arch:check`, never its exit code, and treat checklist
          item 9 as "did the output stay empty". Anything automated that gates on this — a
          hook, a CI step, an agent's `Verify:` line — has the same defect unless it greps the
          output. `pnpm arch:check:all` (no `--ignore-known`) is the version that also surfaces
          the frozen debt in `server/.dependency-cruiser-known-violations.json`.
Evidence: .claude/skills/onion-architecture/tooling.md § "Review checklist for a backend diff"
          item 9; server/.dependency-cruiser-onion.cjs:96-98; server/package.json:11-12
Status:   open — the skill is hand-authored and ours to edit, but changing a review checklist
          is its own decision; `architecture-reviewer.md` § Step 1 states the correction instead

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

### 2026-08-12 · Nothing persisted attributes a finding — or a run — to a SKILL, so every per-skill metric in the design is an agent-level approximation

Trigger:  building the skill editor's Stats tab from the design, which asks for USED BY, PULL
          FREQUENCY, ACCEPT RATE and FINDINGS (30D) per skill
Cause:    the chain stops one level short. `findings.review_id → reviews.agent_id` is the only
          producer link there is; `findings` has no skill column, `agent_runs` has no skill
          column and no agent VERSION either, and `agent_skills` records no timestamp. So an
          agent carrying three skills yields identical numbers under all three, and a run from
          before the attachment still counts. `run_traces.trace.prompt_assembly.skills` is a
          rendered STRING and the run log names the included skills in prose — neither is a
          queryable record of which skill ids a prompt carried.
Takeaway: any "how is this skill doing" number is attribution to the AGENTS that carry it —
          say so on screen, never average it into something that reads as the skill's own
          score, and drop the metrics that cannot be honest at all (PULL FREQUENCY was dropped
          for exactly this; RUNS (30d) took its place). Making it real needs a persisted
          skill↔run link, which is L06's eval pipeline, not a smarter query.
Evidence: server/src/db/schema/reviews.ts (findings); server/src/db/schema/runs.ts;
          server/src/vendor/shared/contracts/knowledge.ts (SkillStats);
          specs/L02-skills.md § Round 2 → Decisions
Status:   open — the approximation ships with an on-screen caveat until L06

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
Status:   open — `resolveFeatureModel` still has no caller; the first one should re-check this

### 2026-08-05 · One dependency-cruiser run over `server/src` also polices `reviewer-core`'s purity

Trigger:  wiring the onion guard and expecting to need a second config inside `reviewer-core`
          (which has no dependency-cruiser of its own — it installs with npm, not pnpm)
Cause:    `tsConfig: { fileName: 'tsconfig.json' }` makes the cruise follow the
          `@devdigest/reviewer-core` path alias, so `../reviewer-core/src/**` shows up as
          ordinary modules in the same graph (149 modules, 463 dependencies, ~1 s). Rules keyed
          on `from: { path: 'reviewer-core/src' }` therefore work from `server/`. The same is
          true of `@devdigest/shared`. This is why the CI step sits in the `typecheck` job of
          `server-unit.yml`, after the `npm ci` that installs reviewer-core's deps — without
          them the alias resolves but `openai` does not, and the graph quietly changes shape.
Takeaway: cross-package architecture rules go in `server/.dependency-cruiser-onion.cjs`, not in
          a new per-package config. `pnpm arch:check` ignores the 16 frozen violations in
          `.dependency-cruiser-known-violations.json`; never append to that file to unblock a
          change — it is the debt list, and anything new must fail.
Evidence: server/.dependency-cruiser-onion.cjs; .github/workflows/server-unit.yml (typecheck job)
Status:   open — baseline shrinks as touched files are fixed

### 2026-08-05 · `allowed-tools` in a skill narrows the session's tools — advisory skills must omit it

Trigger:  drafting frontmatter for the hand-authored `frontend-architecture` skill and copying
          `allowed-tools` from `engineering-insights` because it looked like house style
Cause:    `allowed-tools` restricts what may be used *while the skill is active*, so it splits
          hand-authored skills into two kinds. `engineering-insights` is procedural — it runs, edits
          `INSIGHTS.md`, and finishes — so `Read, Edit, Grep, Glob` is correct and protective. An
          advisory skill is loaded **in the middle of someone else's implementation**; declaring
          `Read, Grep, Glob` there would forbid `Write`/`Edit` at the exact moment the caller needs
          them. Only two skills on disk declare the field, and both are the procedural kind — the
          omission everywhere else is the convention, not an oversight.
Takeaway: declare `allowed-tools` only when the skill itself performs a bounded action. Leave it out
          for reference skills. Unknown frontmatter keys are tolerated, so a `version:` can be added
          freely — `typescript-expert` already carries `category`, `risk`, `source`, `date_added`.
Evidence: .claude/skills/engineering-insights/SKILL.md vs
          .claude/skills/frontend-architecture/SKILL.md; .claude/skills/typescript-expert/SKILL.md
Status:   open — applies to every skill authored from here on

### 2026-08-02 · Two severity tallies with different rules now coexist, deliberately

Trigger:  adding the PR-header scoreboard to a product whose PR list already had a FINDINGS
          column, and having to answer "which findings does this number count?" twice
Cause:    they cannot be the same rule. The list column counts the **latest review only** — it
          sits beside a SCORE ring describing exactly one review, and summing runs there would
          triple-count one defect three agents each found. The header counts **every finding on
          the PR** — it sits above the accordions listing those findings and must match the
          "Agent runs" tab count, which is what "the counters agree with the list" means.
Takeaway: a third surface must pick one on purpose, not by copying whichever neighbour is
          closer. The server's rule (newest `kind='review'`, summaries excluded) has a client
          twin in `latestReviewFindings` (`client/src/lib/findings.ts`) precisely so the PR-list
          hover popover cannot list findings the numbers above it never counted — keep the two
          in step if either changes.
Evidence: server/src/modules/pulls/routes.ts; client/src/lib/findings.ts;
          client/.../[number]/_components/PrSeveritySummary/PrSeveritySummary.tsx
Status:   open

### 2026-08-02 · A feature cut from the starter leaves its scaffold behind — grep before building

Trigger:  building the L01 findings-severity counters, expecting a from-scratch feature
Cause:    every removed feature was cut at the leaves, not at the root. Waiting in the tree
          before a line was written: `rollupSeverities()` + a `SeverityCounts` type in
          `pulls/status.ts`, pure and unit-tested with **no importers**; an unused `divider`
          style in `FindingsPanel/styles.ts`; `panel.noMatchBody` reading "Adjust the filters
          **above**" for filters that no longer existed; `toggleGroup` already carrying
          `marginLeft: auto` to leave room on the left; and a comment in `pulls/routes.ts`
          asserting the breakdown was *intentionally* withheld. Roughly half the feature was
          already there.
Takeaway: before starting any L02–L08 feature, grep for its vocabulary across `src/`,
          `messages/en/*.json` and the `styles.ts` files. An unused export, an orphan style,
          or copy referring to a control that does not exist is the removed feature's
          outline — and it encodes decisions already made. Also treat such comments as
          suspect: that `routes.ts` one described the cut, not a design position.
Evidence: server/src/modules/pulls/status.ts; client/.../FindingsPanel/styles.ts
Status:   open — expect the same on every remaining lesson

### 2026-08-02 · `@devdigest/ui` declares a fourth severity the API can never produce

Trigger:  building severity counters and wondering whether `INFO` needed a chip
Cause:    `vendor/ui/primitives/tokens.ts` types `Severity` as
          `CRITICAL | WARNING | SUGGESTION | INFO` and gives `INFO` a colour, icon and label,
          while the contract enum has only the first three. Two client constants maps carry
          an `INFO` bucket as well, and `FindingCard` casts the 3-value contract type to the
          4-value UI type. Nothing rejects `INFO` — it is simply unreachable, because Zod
          would refuse it on the way in.
Takeaway: iterate severities from `SEVERITY_KEYS` (`client/src/lib/severity.ts`), never from
          `Object.keys(SEV)` — the latter yields a level that is always zero. In a file
          importing both, alias one of the two `Severity` types. `vendor/ui/**` is
          do-not-touch, so the divergence is permanent.
Evidence: client/src/vendor/ui/primitives/tokens.ts:3; client/src/lib/severity.ts
Status:   open — harmless as long as nothing enumerates the UI type

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

> Moved to [`docs/insights-archive.md`](docs/insights-archive.md), which keeps their reasoning:
> on **2026-08-02**, two promoted entries from 2026-08-01 — *the two `vendor/shared` trees have
> already diverged* and *an empty table in the schema is a future lesson*; on **2026-08-06**,
> *a shape duplicated inside `vendor/shared` itself* (promoted) and the two `.nullish()` /
> `.nullable()` entries (2026-08-02 + 2026-08-01, resolved and test-guarded, and they read as
> one pair — the second amends the first, so they moved together).
> Every rule they produced is live in `CLAUDE.md` (Gotchas).

## Tool & Library Notes

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

### 2026-08-06 · `seed.ts` never converges on rename: a skill dropped from `SEED_SKILLS` survives, still linked, and its checklist is still in the prompt

Trigger:  splitting the seeded `api-contract-compat` skill into `breaking-change` /
          `response-schema` / `semver-discipline`, and asking what `pnpm db:seed` does to a
          machine that already ran the old seed
Cause:    the seed is insert-only in **both** halves, and each half fails differently. The
          skill loop is guarded on *that skill's own absence*, so the three new rows do
          appear — but nothing deletes the row whose constant was removed, because the loop
          never enumerates what is in the table. The link loop is guarded on the agent having
          **no links at all** (`if (existingLinks.length > 0) continue`), so an agent that
          already carries one link gets none of the new ones. Net effect on a dev DB: the old
          monolithic skill is still attached and still enabled, the three replacements sit
          unattached on `/skills`, and the demo runs on exactly the prompt it was supposed to
          stop using — with no error anywhere. Fresh volumes and CI (`skills.it.test.ts` seeds
          an empty database) both look green, so nothing catches it.
Takeaway: the entry below classifies seed additions into "needs a fresh volume" and "upgrades
          in place". RENAMES are a third class that neither guard handles, and re-seeding
          cannot fix: write the manual steps into the doc that drives the demo
          (untick the old link, delete the old skill) rather than assuming `pnpm db:seed`
          converges. `docker compose down -v` is not the escape — it takes every imported
          repository with it. The same shape applies to any seeded row keyed by NAME:
          `SEED_AGENT_SKILLS`, `seedAgents`, `SEED_DEMO_PRS`.
Evidence: server/src/db/seed.ts (the `SEED_SKILLS` loop and the `existingLinks.length > 0`
          guard); docs/skills-control-experiment.md § Setup
Status:   open — a "delete rows whose name left the constant" pass would fix it properly, but
          it would also delete a user's hand-edited copy of a seeded skill

### 2026-08-06 · `StructuredRequest.timeoutMs` is a no-op on OpenRouter — the timeout is fixed when the client is constructed

Trigger:  the conventions extractor holds an HTTP request open for its single model call, so it
          asks for a generous `timeoutMs` (180 s) instead of the 60 s adapter default
Cause:    only `adapters/llm/{openai,anthropic}.ts` read `req.timeoutMs` (`withTimeout(...,
          req.timeoutMs ?? DEFAULT_TIMEOUT)`). `OpenRouterProvider` passes `opts.timeoutMs ??
          90_000` to the OpenAI SDK **constructor** and never looks at the request field —
          and `Container.buildLlm` builds it without `timeoutMs`. So on the provider that
          serves every default model in this repo (`openrouter / deepseek-v4-flash`), the real
          ceiling is 90 s per attempt × the SDK's 2 retries, whatever the caller asked for.
          The port declares the field for all three providers, which is what makes it look
          honoured.
Takeaway: a per-request timeout only binds on OpenAI/Anthropic. To change it for OpenRouter,
          pass `timeoutMs` where `container.buildLlm` constructs the provider — a per-call
          value would need the provider to apply it per request (`this.client.withOptions`),
          which it does not do today. Same asymmetry applies to `maxRetries`: OpenRouter reads
          `req.maxRetries` for SCHEMA reprompts, while network retries come from the SDK
          constructor.
Evidence: reviewer-core/src/llm/openrouter.ts:54; server/src/adapters/llm/openai.ts:66;
          server/src/platform/container.ts (buildLlm); server/src/modules/conventions/constants.ts
Status:   open — documented in the L02 spec's Risks; fix only if a scan actually times out

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
Status:   open

### 2026-08-02 · The seed now creates one `agent_run`, and the guard that made it upgradeable

Trigger:  closing the entry below, so the timeline counters could be demoed at all
Cause:    the whole demo block sits inside `if (!pr)`, which only fires when PR #482 is
          created. Anything added there is invisible on an already-seeded database — the two
          extra findings this session added are exactly that. The new `agent_runs` row is
          instead guarded on *"this PR has no runs yet"*, so it backfills an existing dev DB
          without dropping the volume.
Takeaway: seed additions come in two flavours. Data attached to a row created by `if (!pr)`
          needs a fresh volume to appear — plan a reset, or the demo runs on stale data.
          Anything guarded on its own absence upgrades in place; prefer that shape. Also do
          **not** set `pullRequests.lastReviewedSha` while seeding: `deriveReviewStatus` would
          flip #482 to `reviewed`, and the PR list opens on the `needs_review` filter, so the
          demo PR would disappear and take e2e flows 02/04/05 with it.
Evidence: server/src/db/seed.ts (the `existingRuns.length === 0` block)
Status:   resolved — supersedes the entry below

### 2026-08-01 · `pnpm db:seed` creates zero `agent_runs` — run-related UI cannot be eyeballed

Trigger:  booting `./scripts/dev.sh` to visually confirm the new run-cost column, timeline
          badge, and trace Stats tile
Cause:    the seed populates repos, PRs, agents, reviews, and findings, but **no** runs —
          `select count(*) from agent_runs` on a freshly seeded dev DB is 0. So the PR-list
          COST column, the Agent-runs timeline, and the run trace drawer all render their
          empty state no matter what you changed. Filling them needs a real review, which
          means a real API key and a billable model call.
Takeaway: for anything keyed off `agent_runs` or `run_traces`, the `*.it.test.ts` lane
          (testcontainers + `MockLLMProvider`, which reports usage and cost) is the
          verification — not a browser click-through. Don't burn time booting the stack.
Evidence: server/src/db/seed.ts; server/test/reviews.it.test.ts
Status:   open — seeding a demo run would make run UI reviewable without a model call

### 2026-08-01 · `skills-lock.json` does not describe the skills that are actually on disk

Trigger:  authoring the first hand-written skill, and needing to know whether editing
          anything under `.claude/skills/` breaks the "vendored from GitHub by hash" rule
Cause:    the lock and the tree have drifted in both directions. On disk but **not** locked:
          `mermaid-diagram`, `react-best-practices`, `react-testing-library`, `security`.
          Locked but **not** on disk: `architecture-patterns`, `github-workflow-automation`.
          Nothing inside a skill directory says which of the two it is.
Takeaway: `skills-lock.json` is the only authority on what is vendored — never infer it from
          the directory listing. Re-vendoring a skill silently overwrites hand edits, so a
          hand-authored skill must stay out of the lock.
Evidence: skills-lock.json vs .claude/skills/
Status:   open — the lock is stale in both directions; left untouched on purpose

> Archived 2026-08-06 → [`docs/insights-archive.md`](docs/insights-archive.md): the three
> resolved `pr-self-review` / dependency-cruiser tooling entries from 2026-08-05 (*`set -euo
> pipefail` and the empty digest*, *`--name-status` letters are relative to the merge-base*,
> *a rule that matches nothing looks like a rule that passes*), and *`defaultNow()` is
> transaction start time* (2026-08-02), now a `CLAUDE.md` Gotcha.

## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

_None yet._
