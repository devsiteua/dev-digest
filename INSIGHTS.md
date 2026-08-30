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

_None yet._

> Archived 2026-08-29 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-28, 2026-08-07. What stays here is `open`, plus any resolved entry an
> open one points at.

## What Doesn't Work

### 2026-08-30 · Three assertions in one test needed their literals updated, and the fourth looked identical — updating it would have deleted the control

Trigger:  `seed.ts` now decides ten findings instead of four, so the per-file `finding_lines`
          expectations in `smart-diff.it.test.ts` had to move.
Cause:    three of them are DESCRIPTIVE — they record what the seed happens to contain, and
          editing the literal is the correct repair. The fourth,
          `expect(lines['src/server.ts']).toEqual([])` at `:179`, is the negative half of "an
          older review does not leak its findings": the test plants a finding on
          `src/server.ts` in a SUPERSEDED review and asserts the current review reports none
          there. Seeding a finding onto that file turns it red too — loudly, not silently — and
          the obvious repair, updating the literal exactly as the other three needed, converts
          a control into a tautology that can never fail again. The right repair was to move
          the seeded finding off that file.
Takeaway: when one data change makes several assertions in a file go red, sort them into
          descriptive and control BEFORE editing any. The tell is an expectation whose value is
          empty or absent: a control usually asserts that nothing is there, so "update the
          expected value" is precisely the move that destroys it. Sibling of the
          data-versus-lane sweep below — that one asks which step destroys a fixture, this one
          asks which step makes the obvious REPAIR destroy the control.
Evidence: server/test/smart-diff.it.test.ts:127-134,177-180; server/src/db/seed-evals.ts
Status:   open

### 2026-08-30 · A zero-count grep gate fires on prose and on type unions — and it is right both times

Trigger:  two gates the L06 plan wrote for itself, both of the form "grep this file for the
          vocabulary of X → 0". Both fired on first contact with the finished code.
Cause:    AC-17's gate (the scoring module must name nothing to do with a model) fired because
          the file's own DOC COMMENT used the word "container" while explaining that it must
          never reach for one. AC-28's (nothing writes `owner_kind` `'skill'`) fired on
          `ownerKind: 'skill' | 'agent'` — a type union in a signature, not a write.
Takeaway: fix the code, not the gate — and both fixes were improvements: the comment was
          reworded, and the inline union became the shared `EvalOwnerKind`, removing an inline
          re-declaration root `CLAUDE.md` § Gotchas already warns about. A zero-count gate
          cannot tell code from prose or a write from a type, and that is the same property
          that makes it reachable where a positive count is not (the entry below). Expect one
          to fire the first time it meets real code; that is the gate working, not a false
          alarm.
Evidence: server/src/modules/evals/scoring.ts:11-15; specs/plans/eval-pipeline.md § Step 3, Step 6
Status:   open

### 2026-08-30 · `allowedTools` is not a permission boundary under `bypassPermissions` — an eval run rewrote a committed file

Trigger:  running the workflow tier of `evals/`. Afterwards `git status` showed
          `server/INSIGHTS.md` modified: the `engineering-insights` activation case had called
          `Edit`, DELETED the real "tokenizer has two ways to count wrong" entry, and written one
          invented from the eval's own prompt — with an `Evidence:` line pointing at
          `server/src/adapters/pgvector/repo-intel.ts`, a file that does not exist.
Cause:    `Edit` is not in `WORKFLOW_ALLOWED_TOOLS`; neither are `Bash` or `SendMessage`, and the
          traces show all three were used. `runClaude` sets `permissionMode: "bypassPermissions"`,
          and bypassing permissions is exactly what bypasses the machinery that would have enforced
          `allowedTools`. The list is a hint to the model, not a boundary. `tasks.ts` asserted the
          opposite in a comment — "keep allowedTools a read-only allow-list ... a fresh session with
          bypassPermissions could otherwise take real actions in the repo" — and that comment is
          what made the gap invisible: the list looks like a guard and denies nothing.
Takeaway: `disallowedTools` IS enforced independently of `permissionMode` — that is the only list
          that holds. Any headless session pointed at a real working tree needs a hard deny, not an
          allow-list, and the check that it works is `git status` before and after, not the trace.
          Distinct from the skill-frontmatter `allowed-tools` field (2026-08-05, below): same name,
          different mechanism, and that one does restrict.
Evidence: evals/src/config.ts:43 (EVAL_DENIED_TOOLS); evals/src/runtime/run-claude.ts:65,69
Status:   resolved — hard deny added and verified by re-running the offending case: the session
          still tries to write, the tree is unchanged, the skill still activates

### 2026-08-30 · An eval that names a path is testing its own fixture until you check the path exists

Trigger:  L06 experiments 3 and 4. Both shipped suites looked runnable and measured nothing.
Cause:    every path they asserted was absent from this repository. The agent fixtures described
          `server/src/modules/checkout/**` and `reviewer-core/src/pipeline/run.ts`; all three
          workflow trace cases asserted `server/docs/api-contracts.md`,
          `reviewer-core/docs/pipeline.md` and `reviewer-core/insights/gotchas.md`. Worse, the
          agent practices demanded the rule identifiers `inward-only-dependencies`, `di-discipline`,
          `reviewer-core-zero-io` and `reviewer-core-ground-findings-gate`, none of which exists —
          the real names are in `server/.dependency-cruiser-onion.cjs` (`no-fastify-below-delivery`,
          `no-concrete-adapter-in-app-layer`, `core-stays-pure`, …). So the one practice the whole
          A/B rested on could pass only by hallucinating an invented string, and scored 0% in BOTH
          variants: an agent citing the REAL rule was graded FAIL.
Takeaway: before trusting any series, resolve every path and every identifier a case asserts against
          the tree — one `for f in ...; do [ -e "$f" ]` loop costs seconds and a wrong one costs a
          full run to discover. A tool-using agent makes this worse, not better: it goes looking,
          fails to find the files, and correctly REFUSES, so its most correct behaviour scores zero.
Evidence: evals/agents/architecture-reviewer/architecture-reviewer.cases.ts (header);
          evals/workflow/review-workflow.cases.ts (header); server/.dependency-cruiser-onion.cjs:25-96
Status:   resolved — both suites rebuilt against paths and rule names that exist

### 2026-08-30 · Deleting one statement of a rule does not delete the rule — the onion skill states its DI requirement three times

Trigger:  L06 experiment 2 — remove the DI-container rule from `onion-architecture/SKILL.md` and
          watch the tied expectation fall. The delta was ZERO on every practice.
Cause:    not a weak case, a lenient grader, or a strong base model — the three causes the lesson
          names. The rule was redundantly encoded. With the requirement sentence gone the model
          still reconstructed it from the ring map (ring 2 imports rings 0-1, so a service
          instantiating a ring-3 class is already illegal) AND from the surviving composition-root
          DESCRIPTION, which still named `platform/container.ts` as where wiring lives. Its own
          words: "Application layer should not instantiate Infrastructure classes ... add it to the
          container in `platform/container.ts`". Removing the whole paragraph moved the tied
          expectation 100% → 50% with all six controls flat and the case score unchanged.
Takeaway: before breaking an artifact to measure it, grep the artifact for every restatement of the
          rule and remove the rule, not one sentence of it. A null delta is evidence about the
          ARTIFACT's redundancy before it is evidence about the model. The same audit is cheap
          insurance the other way: `architecture-reviewer` states its citation rule exactly once, so
          one deletion there was a real break.
Evidence: .claude/skills/onion-architecture/SKILL.md § Ring map + § Forbidden imports item 3
Status:   open — the redundancy is a strength in production and a confound in evals; not "fixed"

### 2026-08-30 · A routing row written with a package-relative path sends the model to the repo root

Trigger:  the workflow eval's package-local routing case passed 1 of 2 runs.
Cause:    `reviewer-core/CLAUDE.md:54` writes its target as `` `docs/prompt-contract.md` `` —
          relative to the package. In BOTH runs the model first tried `docs/prompt-contract.md` from
          the repo root, which does not exist; run 1 gave up and read `src/prompt.ts` instead, run 2
          recovered and found `reviewer-core/docs/prompt-contract.md`. The rule is ambiguous about
          its own anchor, and a package `CLAUDE.md` is loaded into a session whose cwd is the repo.
Takeaway: write every path in a `Read when` row so it resolves from the REPO ROOT, even in a package
          file. The root `CLAUDE.md`'s rows do this already; the package ones do not.
Evidence: reviewer-core/CLAUDE.md:54; evals/workflow/review-workflow.cases.ts
Status:   open — same shape likely in the other `<pkg>/CLAUDE.md` files; not swept

### 2026-08-30 · Every integration lane in this repo runs `seed()` — and a step that UN-writes a fixture inverts the ordering check that catches it

Trigger:  planning `specs/eval-pipeline.md`. Two ordering faults, one the mirror of the other.
          `In scope` listed the seed extension tenth; the plan put it at Step 4. Then AC-30's
          lane — "a finding whose review has no agent is refused" — needed a row that Step 4
          had just deleted.
Cause:    (a) `server/test/integration.it.test.ts:7,47` imports `seed` and runs it — and so does
          every other file in the lane: `grep -L "db/seed" server/test/*.it.test.ts` returns
          nothing, **15 of 15**. So EVERY integration lane asserts against seed output, whatever
          its subject is, and every step owning such a lane depends on the seed step even when
          nothing in its description mentions the seed.
          (b) Step 4 backfills the demo review's `agent_id` `where agent_id is null`. AC-30's
          lane needs a review WITH `agent_id` null. The lane would have been unrunnable *after*
          the step it depends on — not before it, which is the direction the 2026-08-30 entry
          below describes and the only direction its sweep can see. A sweep asking "which step
          writes this row" returns nothing, because the answer is that a step removes it.
Takeaway: two checks, and the second is the one nobody runs. First: in this repository the seed
          step is a prerequisite of every persisted-row lane, so it belongs at the FRONT of a
          plan regardless of where the spec lists it. Second: for each lane, also ask which step
          DESTROYS its fixture — a backfill, a de-duplication, a `NOT NULL` migration, a cleanup
          all qualify, and each is invisible to the write-side sweep. The fix is for the lane to
          insert its own fixture (`t.reviews` with `agentId` omitted, the idiom already at
          `server/test/reviews.it.test.ts:417`, `smart-diff.it.test.ts:147`,
          `skills.it.test.ts:574`), never to weaken the step that does the destroying.
Evidence: server/test/integration.it.test.ts:7,47; server/test/reviews.it.test.ts:417;
          specs/plans/eval-pipeline.md § Coverage → the data-versus-lane sweep
Status:   open — sharpens the entry below rather than replacing it; that one still owns the
          write-side direction

### 2026-08-30 · A requirements gap can sit BETWEEN two sections, with both of them reading correctly alone

Trigger:  `specs/eval-pipeline.md` passed its own eight-point self-check — ids sequential, one
          EARS pattern per row, no empty `How it is checked`, zero `[NEEDS CLARIFICATION]` — and
          was approved and committed. `implementation-planner` then could not build Step 4 from
          it.
Cause:    § In scope promised the seed leaves "at least eight findings with real decisions";
          AC-01 required a case set of ≥8 and its check counted `eval_cases`. Two different
          populations, and eight decided findings do not become eight cases by themselves —
          nothing else writes `eval_cases` during a seed. Each sentence is correct in isolation,
          so no per-section check can fail: the defect exists only in the relation between them.
          Pulling on it surfaced a real missing criterion (`reviews.agent_id` is nullable at
          `server/src/db/schema/reviews.ts:28` while `eval_cases.owner_id` is `notNull` at
          `schema/eval.ts:13`, so a finding can have no owner to give a case) which became AC-30
          — after the spec had been called complete.
Takeaway: a spec self-check that walks sections one at a time cannot find this class. Add one
          cross-section pass: for every noun a prose section promises to produce, find the
          criterion that counts it and check they count the SAME population. Cheap heuristic —
          any two places naming the same number (here "eight") are the pair most likely to
          disagree. Expect the planner to be the first reader who has to satisfy both at once;
          that is not a planning failure, it is where this defect is designed to surface.
Evidence: specs/eval-pipeline.md § In scope + AC-01, AC-09, AC-30; commits 2038e95 → 2378d54
Status:   open

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

### 2026-08-30 · The seed-literal obligation is wider than `e2e/specs/*.json` — an integration test reads those literals too

Trigger:  editing `seed.ts` to decide ten findings, and looking for everything that would
          break.
Cause:    root `CLAUDE.md` § Gotchas names exactly one obligation: after editing `seed.ts`,
          grep `e2e/specs/*.json` for the values changed. The L06 plan quoted that rule, swept
          only `e2e/`, and concluded "exactly one flow asserts a seed-derived count" — true,
          and incomplete. `server/test/smart-diff.it.test.ts` hard-codes seed-derived
          `finding_lines` per file, and went red on values no flow mentions. The rule is
          narrower than the fact it describes, and a plan that trusts it inherits the gap.
Takeaway: after editing `seed.ts`, grep the WHOLE repository for the literals changed — not
          one package, and not the one package a gotcha happens to name. `check:e2e-contract`
          only enforces the e2e half, so nothing automated covers the rest.
Evidence: server/test/smart-diff.it.test.ts:127-134; e2e/specs/04-pr-findings.flow.json:3,14;
          root CLAUDE.md § Gotchas
Status:   open — the `CLAUDE.md` gotcha still names only `e2e/specs`

### 2026-08-30 · `skillContent()` injects SKILL.md plus a `references/` DIRECTORY — a skill's sibling pages never reach the model

Trigger:  designing the L06 experiment-2 break, and needing to know whether editing
          `onion-architecture/SKILL.md` was actually a controlled variable.
Cause:    `skillContent()` reads `SKILL.md` and then, only if a `references/` **directory** exists,
          every `*.md` inside it. `onion-architecture` keeps its extra pages as sibling FILES —
          `tooling.md`, `references.md` — so neither is injected. That matters because
          `tooling.md:22` restates the DI-container rule the experiment removes; had it been loaded,
          the break would have been invisible for a reason nobody would have found. Note also that
          frontmatter is NOT stripped for skills (it is for agents, via `agentContent`), so a
          skill's `description` and trigger terms are always in the payload.
Takeaway: a skill eval measures SKILL.md and a `references/` directory, nothing else. Before drawing
          any conclusion from a skill eval, check where that skill's content actually lives — and
          remember the content-tier runs with NO tools, so the model cannot go read the rest.
Evidence: evals/src/artifacts/load.ts:19-31; .claude/skills/onion-architecture/tooling.md:22
Status:   open

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

> Archived 2026-08-30 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-06, 2026-08-29. Moved because each is `resolved`/`→ promoted`, has shipped, and no
> open entry points at it.

## Tool & Library Notes

### 2026-08-30 · Three ways `evals/` prints a number that is not the measurement

Trigger:  the L06 lab. Each one produced a confident, plausible, wrong result.
Cause:    (1) `record()` computes `outcome` from the judge threshold when there is a verdict and
          otherwise falls back to `!result.isError` — "did the session run". EVERY workflow case has
          no grounding gate and no judge, so the whole tier's pass rates measured session success: a
          contrast whose control read the very document it must not read reported **100%**, and a
          negative-activation "50%" was a session error, not a failed assertion.
          (2) On a subscription limit the SDK returns the string
          `You've hit your session limit · resets 7:10pm` as the model's OUTPUT; `record()` persists
          it and the judge grades it, yielding a clean-looking 0% with no indication the run never
          happened. The tell is `tok_out: 0` with `turns: 1` and a sub-second duration.
          (3) In `runQualityCases` the `await task(...)` sits OUTSIDE the try/finally, so when
          `runClaude` throws, `record()` never fires and the case silently vanishes from the series —
          a "2 runs" series reporting `n=1` on one case, with nothing saying so.
Takeaway: check `tok_out` and the record COUNT before reading any eval summary, and for the workflow
          tier read `trace.reads` / `trace.subagents` / `trace.skills` and evaluate the assertion
          yourself. A green from this harness is a hypothesis until the trace confirms it.
Evidence: evals/src/records/record.ts:59-65; evals/src/dsl/case.ts:95
Status:   resolved for (1) — `RecordData.outcome` added and each workflow runner passes its own
          verdict; (2) and (3) remain open

### 2026-08-30 · `eval:delta` keys on the full vitest nodeid, so it cannot compare two agents

Trigger:  L06 experiment 3 — `pnpm eval:delta ar-strict ar-lite`, exactly as the lab prescribes.
          Every row rendered `—% -> n/a`.
Cause:    the nodeid embeds the eval file path and the `describe()` name, so
          `.../architecture-reviewer/... > agent:architecture-reviewer > <case>` never matches
          `.../architecture-reviewer-lite/... > agent:architecture-reviewer-lite > <case>` — even
          though `architecture-reviewer-lite.eval.ts` imports the strict variant's cases precisely so
          the two share every case. The A/B the package is built for is the one comparison the CLI
          cannot render.
Takeaway: for a cross-artifact A/B, compare the two `results/repeat-<label>.json` files by the LAST
          segment of the nodeid (`id.split(" > ").pop()`), which is the shared case name. Harder
          evidence still is to count the thing itself in `results/outputs/` — grepping the emitted
          rule identifiers showed strict 2/2 and lite 0/2 where the graded delta said 100% → 50%,
          because the judge had passed a lite answer naming one identifier against a practice asking
          for two.
Evidence: evals/src/delta.ts:66; evals/agents/architecture-reviewer-lite/architecture-reviewer-lite.eval.ts
Status:   open — a `--by-name` flag would fix it; not written

### 2026-08-30 · A per-lesson worktree boots its web UI on the one port its own API refuses

Trigger:  preparing the L06 implementation handoff and checking what `./scripts/dev.sh` would
          actually do in the `dev-digest-l06` worktree, whose `server/.env` sets
          `API_PORT=3061` / `WEB_PORT=3060`.
Cause:    the two halves read the port from different places and only one of them reads `.env`.
          The API does: `config.ts:38-39` parses `API_PORT`/`WEB_PORT`, so Fastify listens on
          3061 — `scripts/dev.sh:104` printing "starting API on :3001" is hard-coded prose that
          has never been true in a worktree with an override. The client does NOT:
          `client/package.json:6` is `next dev -p 3000`, a literal that neither `WEB_PORT` nor
          `PORT` can move. And CORS is a strict single-origin allow-list built from the value
          the client ignores — `app.ts:90` registers `origin: [config.webOrigin]` where
          `webOrigin` is `http://localhost:${WEB_PORT}` (`config.ts:94`). Net effect: web on
          3000, API on 3061, allow-list holding 3060 — every browser request is blocked, while
          `client/.env`'s `NEXT_PUBLIC_API_BASE=http://localhost:3061` is correct and makes the
          setup look right. Nothing logs a mismatch; the failure appears only in the browser.
Takeaway: in a worktree with a `WEB_PORT` override, start the client as
          `cd client && pnpm exec next dev -p $WEB_PORT` — `pnpm dev` is the wrong command
          there, whatever `dev.sh` says. Two durable fixes if this bites twice: make
          `client/package.json`'s script read the variable, or widen `app.ts:90` to accept both
          origins in development. Do NOT "fix" it by setting `WEB_PORT=3000`, which is what
          every parallel lesson worktree would then collide on. `scripts/e2e.sh:32-41` is the
          one place that already does this correctly — it exports both ports because "the API
          derives its origin from WEB_PORT", which is the same trap, solved.
Evidence: client/package.json:6; server/src/app.ts:90; server/src/platform/config.ts:38-39,94;
          scripts/dev.sh:104,109; scripts/e2e.sh:32-41
Status:   open

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

> Archived 2026-08-30 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-06. Moved because each is `resolved`/`→ promoted`, has shipped, and no
> open entry points at it.

## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

_None yet._
