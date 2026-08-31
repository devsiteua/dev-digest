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
`CLAUDE.md` and is marked `→ promoted` here.

**Archiving rule:** keep each file under ~250 lines. Over budget, spill to
[`docs/insights-archive.md`](docs/insights-archive.md) — verbatim, under the same section, and
leave a `> Archived …` blockquote at the foot of the section listing the dates that left, so a
grep for a cited date still lands on a pointer. Only `→ promoted` and `resolved` entries whose
lesson has shipped qualify. An `open` entry never moves, and neither does a resolved one an
open entry points at ("the entry below") — the pair stays whole.

---

## What Works

### 2026-08-30 · The lesson's own start branch answers "does this infrastructure really exist" in one command

Trigger:  a spec had to state whether the finding-grouping heuristic the L07 brief calls ready
          infrastructure exists. Grepping this tree proves only that it is not here NOW — it
          cannot distinguish "the lab never shipped it" from "we deleted it".
Cause:    every lab in this course has a paired `upstream/lesson-N-lab/<topic>-start` and
          `-finish` branch, and they answer different questions.
          `git ls-tree -r --name-only <start-branch> | grep -iE "<feature vocabulary>"` is the
          inventory of what the lesson actually hands you; the same grep on `-finish` shows what
          the answer was supposed to look like. For L07: zero matches on
          `upstream/lesson-7-lab/multiagents-start` (`ca62cbe`) for
          `group|cluster|similar|multi-agent|conflict`, and on `multiagents-finish` (`af92aa8`)
          the two server files and the eight client components that were "already there".
          `git ls-tree` reads the branch without checking it out, so it costs nothing and
          disturbs no worktree — which matters when several are live at once.
Takeaway: run it before writing a spec whose brief claims infrastructure is ready. It converted
          the largest open question in `specs/multi-agent-review.md` into a stated fact with
          evidence, in one command. This EXTENDS the 2026-08-02 entry under Codebase Patterns
          ("a feature cut from the starter leaves its scaffold behind — grep before building"):
          that one says grep THIS tree, and it is not enough on its own, because the two trees
          disagree and only the start branch is authoritative about the starting point. Note the
          finish branch is the finished lab with every parallel worktree already merged, so it
          is a reference, never a source to copy from — copying breaches the boundaries the
          fan-out exists to teach.
Evidence: upstream/lesson-7-lab/multiagents-start (ca62cbe) vs multiagents-finish (af92aa8);
          specs/multi-agent-review.md § Open questions 1
Status:   open — applies to every remaining lesson brief

> Archived 2026-08-29 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-28, 2026-08-07. What stays here is `open`, plus any resolved entry an
> open one points at.

## What Doesn't Work

### 2026-08-30 · A seed addition can break an e2e flow without touching a single literal that flow asserts, and the `CLAUDE.md` gate for this cannot see it

Trigger:  seeding a finished three-agent run on demo PR #482. The rule in root `CLAUDE.md`
          § Gotchas — "after editing `seed.ts`, grep `e2e/specs/*.json` for the values you
          changed" — was run and came back clean, because the block only ADDS rows and changes
          no existing literal.
Cause:    flow 09 locates a control by `find role button --name "Open the suggestion on line 28
          …"`, and that name is built from **the latest review's** findings — `latestReviewFindings`
          picks the newest `created_at`, and the server's PR-list tally uses the same rule
          (root `INSIGHTS.md` 2026-08-02 records the two-tallies design). Three new `reviews`
          rows on `defaultNow()` would have become the newest, moving "latest" off the
          `model: 'seed'` review and silently renaming the button. Nothing textual changes, so a
          literal grep is blind to it: what moved was a DERIVED SELECTION over the table.
Takeaway: when seeding into a table some surface reduces to "the latest one" / "the top one" /
          "the highest-scoring one", the grep is not enough — find who computes that reduction
          and either stamp the new rows so they lose it, or accept that the flow's name changes
          and update it in the same commit. Here the new rows carry an explicit `createdAt`
          equal to the parent run's `ran_at`, six hours old, so the seeded review stays newest
          and every surface flows 02/04/05/09/10 assert is untouched. The general shape: a
          literal grep tests the TEXT a flow asserts, never the QUERY that produces it.
Evidence: server/src/db/seed.ts (the L07 multi-agent block's explicit createdAt);
          e2e/specs/09-pr-smart-diff.flow.json:19; client/src/lib/findings.ts (latestReviewFindings)
Status:   open — the `CLAUDE.md` gotcha is correct and incomplete; this is the half it misses

### 2026-08-30 · A lesson brief's "what already exists" table is a hypothesis, and the row hardest to doubt was the false one

Trigger:  `reference/lessons/kickoff/L07A.md` § "Що вже є в коді (не писати заново)" is a table
          of ready infrastructure, each row citing a file. Three of its rows are false, and the
          spec written from it would have planned around all three.
Cause:    (a) "паралельне виконання вже готове" — `run-executor.ts:122-129` is
          `for (const … of jobs) { await this.runOneAgent(…) }`. No `Promise.all`, no
          `allSettled`, no queue. (b) "готова евристика групування знахідок" — does not exist
          anywhere, in this tree or in the branch the lab starts from (see the What Works entry
          above). (c) "A додає атрибуцію знахідок, яку читає ingest у B" — the attribution has
          been there since the starter (`server/src/db/schema/reviews.ts:28-30`); what the work
          actually changes under the neighbouring worktree is the SHAPE of `agent_runs`.
          Row (a) is the instructive one. The cited file EXISTS, the line range is right, and
          two of the three properties the row claims are genuinely there — the diff and intent
          really are prepared once for the whole batch (`:106`, `:120`) and the per-agent error
          isolation really is real (`:129-142`). A reader who opens the file to check sees a
          batch-shaped function doing batch-shaped work and confirms the row. The one missing
          property is invisible precisely because the surrounding claims are true.
Takeaway: check such a row by grepping for its MECHANISM, not by opening the file it cites:
          `grep -nE "Promise\.(all|allSettled)|PQueue|concurrenc" <file>` for a concurrency
          claim, `git ls-tree` for a "module already exists" claim (What Works, above). Opening
          the file and reading around confirms shape, and shape is what a partially-true row
          already has. Note that a mechanism named in copy or in a table can also exist
          ELSEWHERE in the repo and still be absent from the path in question — `p-queue` is a
          real dependency here (`server/package.json:40`, used by `platform/jobs.ts` and
          `repo-intel/pipeline/full.ts`) and is simply not on the review path, which is why
          both the brief and `client/messages/en/runs.json:121` can name it without lying
          obviously. This is the same shape as the 2026-08-01 entry below ("treat prose in
          READMEs as a hypothesis"), one level up: there the prose was stale, here it is a
          structured inventory written to be trusted.
Evidence: reference/lessons/kickoff/L07A.md § Що вже є в коді;
          server/src/modules/reviews/run-executor.ts:106,120,122-129;
          server/src/db/schema/reviews.ts:28-30; specs/multi-agent-review.md § Context
Status:   open — the same table format opens every remaining kickoff brief

### 2026-08-30 · A plan's own dependency graph can encode an ordering that cannot be executed, and every gate in the plan agrees with it

Trigger:  `specs/plans/L05-pr-brief.md` placed AC-39's integration case in Step 6 — "the two
          seeded `pr_brief` rows, read through `GET` at `stale: true`". Step 6 builds the
          integration lane. The rows it reads are written by Step 10. Step 10 `Depends: Step 6`.
Cause:    the plan had been swept for coverage in three directions — every criterion has a step,
          no step invents a criterion, and (after a cross-model review round) every *lane* the
          spec's `How it is checked` column names has a step. All three passed. None of them
          asks whether the step that owns a lane can actually *run* it: the sweep matches lanes
          to steps, never the data a lane reads to the step that produces it.
Takeaway: when a lane asserts against data, check which step writes that data and whether the
          dependency arrow points the right way. The same shape recurs wherever a test is placed
          by subject rather than by prerequisite — fixtures, seeds, migrations. In execution the
          honest fix is to move the case to the step that makes it possible and say so, not to
          weaken the assertion so it fits where it was asked for.
Evidence: specs/plans/L05-pr-brief.md · server/test/brief.it.test.ts
Status:   open

### 2026-08-30 · A plan gate written as `grep -c <symbol> <file>` → N cannot distinguish an import line from a call site

Trigger:  a step's `Verify` read `grep -c "briefStateOf" server/src/modules/brief/service.ts`
          → **2**, "any other number means the two paths have stopped hashing the same string".
          The real count is 3, and always would have been.
Cause:    `grep -c` counts matching *lines*, and the `import { … briefStateOf … }` line is one
          of them. The floor for "two call sites of an imported function" is three. The gate was
          unreachable as written, so an implementer following it literally sees a mismatch with
          no way to tell a regression from the plan being wrong.
Takeaway: a gate meant to count call sites greps for the call — `grep -c "symbol("` — or states
          its arithmetic out loud ("2 call sites plus 1 import = 3"). More generally, a gate a
          plan writes for itself is never run before the plan is approved, so any gate with a
          hard-coded number should be executed against the current tree while the plan is being
          written, even when the code it will check does not exist yet: the count of what is
          already there is checkable today.
Evidence: specs/plans/L05-pr-brief.md · server/src/modules/brief/service.ts:21,87,124
Status:   open

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

> Archived 2026-08-29 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-28 ×2, 2026-08-25, 2026-08-24, 2026-08-23, 2026-08-22 ×2, 2026-08-02.
> What stays here is `open`, plus any resolved entry an open one points at.

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

### 2026-08-28 · Three silent narrowings sit between a real call site and a row in the blast map

Trigger:  the demo PR's map shows `tests/authorization.test.ts:34` as a caller of
          `canViewOrder` — but the file also calls it at line 39, and that row is absent.
Cause:    three independent filters, none of which announces itself.
          (a) `resolveReferences` (`repository.ts`) sets `references.decl_file` only when a
          `file_edges` row exists from referencing to declaring file, the declaring file
          EXPORTS that exact name, and there is exactly one candidate (`HAVING count(*) = 1`)
          — so a call through a barrel is never attributed and an ambiguous name is dropped
          rather than guessed.
          (b) `getResolvedCallers` INNER JOINs `file_rank`, so a caller file with no rank row
          is invisible; that only bites on a partial index, which is what `status: 'partial'`
          exists to say.
          (c) the de-duplication key is `file|ENCLOSING SYMBOL|toSymbol`, and the enclosing
          symbol falls back to the file's basename when the caller file has no `symbols`
          rows. A test file the indexer never parsed therefore collapses ALL its references
          to one row, whatever line they are on.
Takeaway: the map is precision-first by construction: a row in it is a real call, but its
          absence is not evidence of no call. Do not "fix" a missing caller downstream — the
          three rules above are where the answer is, and (c) in particular means a caller
          count from a symbol-less file is a count of FILES, not of call sites.
Evidence: server/src/modules/repo-intel/repository.ts (resolveReferences, getResolvedCallers);
          server/src/modules/repo-intel/service.ts (enclosingFromRows, the seenCaller key)
Status:   open — (c) is a real under-count; correcting it means keying on the line when the
          enclosing symbol is unknown, which no consumer needs yet

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
Status:   → promoted to `server/CLAUDE.md` § Conventions on 2026-08-30, at its second sighting:
          `risk_brief` was already in `FeatureModelId` with an `openai / gpt-4.1` default and a
          rendered Settings row pointing at nothing, so the PR brief CLAIMED the slot rather than
          creating one. `resolveFeatureModel` still has no caller; the first one should re-check this

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

> Moved to [`docs/insights-archive.md`](docs/insights-archive.md), which keeps their reasoning:
> on **2026-08-02**, two promoted entries from 2026-08-01 — *the two `vendor/shared` trees have
> already diverged* and *an empty table in the schema is a future lesson*; on **2026-08-06**,
> *a shape duplicated inside `vendor/shared` itself* (promoted) and the two `.nullish()` /
> `.nullable()` entries (2026-08-02 + 2026-08-01, resolved and test-guarded, and they read as
> one pair — the second amends the first, so they moved together).
> Every rule they produced is live in `CLAUDE.md` (Gotchas).

> Archived 2026-08-29 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-28, 2026-08-23, 2026-08-21, 2026-08-02. What stays here is `open`,
> plus any resolved entry an open one points at.

## Tool & Library Notes

### 2026-08-30 · A parallel worktree's ports live in its own `.env`, but `client`'s `dev` script hardcodes 3000 and ignores them

Trigger:  bringing the stack up in `dev-digest-l07a` to run the L07 measurement. The API came
          up on 3073 as expected; `cd client && pnpm dev` died with
          `EADDRINUSE :::3000` because a neighbouring worktree was already there.
Cause:    two independent traps. (a) Each worktree carries its own ports —
          `server/.env` has `API_PORT=3073`, `client/.env` has `NEXT_PUBLIC_API_BASE=…:3073` and
          `WEB_PORT=3072` — while root `CLAUDE.md`, `mcp/`'s `test:live` and most plan text all
          name 3001/3000. A "is the route registered?" probe against 3001 from this worktree
          gets Fastify's own 404 from the NEIGHBOUR, which is indistinguishable at a glance from
          a route that was never registered. (b) `client/package.json`'s script is
          `"dev": "next dev -p 3000"` — a literal, so `WEB_PORT` is declared in `.env` and read
          by nothing. The server's script honours its `.env`; the client's does not, so the two
          halves of one worktree disagree.
Takeaway: in a worktree, read the ports from `server/.env` and `client/.env` before starting or
          probing anything, and start the web with `pnpm exec next dev -p $WEB_PORT` rather than
          `pnpm dev`. When a probe returns a plausible-looking 404, confirm the port belongs to
          THIS worktree before believing it. Also note Next spawns a worker that survives a
          plain `kill` on the parent — `lsof -ti tcp:<port>` again and `kill -9` the remainder.
Evidence: server/.env (API_PORT=3073); client/.env (WEB_PORT=3072); client/package.json ("dev");
          root CLAUDE.md § Commands
Status:   open — every L06-L08 lesson runs two worktrees at once

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
Status:   resolved 2026-08-30 — a scan did not time out, but a BRIEF did, and in front of a
          user: `POST /pulls/:id/brief` ran 126 s against a 60 s `BRIEF_TIMEOUT_MS`.
          Three changes, because the bug was three-layered:
          1. `completeStructured` now enforces `req.timeoutMs` as a WALL-CLOCK budget with an
             AbortController, so the field binds on OpenRouter too. AbortController and not the
             siblings' `Promise.race`: racing abandons the request but leaves it in flight,
             still spending tokens nobody is waiting for. One signal covers every attempt, so a
             retry does not restart the budget. Five tests in
             `reviewer-core/test/openrouter-timeout.test.ts`, four of which go red without it.
          2. `Container.buildLlm` now passes `timeoutMs: 30_000` — the PER-ATTEMPT value this
             entry said was the place to set it. The library's 90 s default was LONGER than any
             caller's budget, so the SDK could never retry inside one.
          3. `BRIEF_TIMEOUT_MS` 60 s → 90 s. The two above are not enough on their own:
             30 + 30 = 60 was exactly the old ceiling, so a stalled attempt still failed with a
             retry that had no room to finish.
          **The number that made all three legible: a healthy call is 14-28 s** (five
          consecutive live runs), while OpenRouter intermittently stalls one outright. Without
          measuring the healthy case, any of the three could have been "fixed" to a number that
          merely hid the other two.
          Still true and NOT changed: `maxRetries` keeps the same asymmetry — OpenRouter reads
          `req.maxRetries` for schema reprompts while network retries come from the SDK
          constructor.

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

> Archived 2026-08-29 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-28 ×4, 2026-08-25, 2026-08-22 ×2, 2026-08-06. What stays here is
> `open`, plus any resolved entry an open one points at.

## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

_None yet._
