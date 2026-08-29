# Implementation plan — L05 spec-driven development pipeline

Spec: [`../L05-sdd-pipeline.md`](../L05-sdd-pipeline.md) · Spec ID `L05-SDD-PIPELINE`
Branch: `lesson-05` · Written by hand, because the agent that would write it is what this plan builds.

## Requirements review

What the spec leaves open, checked before planning rather than discovered during it:

- **Verified, not assumed.** `AC-22` speaks of `CRITICAL` findings; `architecture-reviewer`
  already emits exactly `CRITICAL | WARNING | SUGGESTION` (`.claude/agents/architecture-reviewer.md:132`),
  so the criterion sits on a scale that exists.
- **Gap, closed by decision.** The spec does not say what `/implement` does when a step's own
  `Verify` command fails. Taken here: it stops at that step and reports, mirroring
  `implementer`'s existing deviation policy — a skill that re-plans around a red command is
  the failure mode the whole pipeline exists to prevent. Recorded in Step 5.
- **Gap, deliberately left open.** The spec fixes what the two `SKILL.md` files must *do*, not
  their section layout. That is prose shape, and copying the anatomy of
  `.claude/skills/pr-self-review/SKILL.md` is a better answer than inventing a house style here.
- **Ordering constraint the spec implies but does not state.** The conventions (`specs/README.md`,
  `specs/TEMPLATE.md`, `CLAUDE.md`) must land **first**: every agent and skill file written
  afterwards points at them, and `.claude/agents/README.md` § Adding an agent, rule 4 forbids
  restating a convention inline. Written down here as Step 1.

## Constraints in force

| Constraint | Source | What it forbids here |
|---|---|---|
| Rules live in the agent file; the registry is a map | `.claude/agents/README.md`, opening | restating an agent's rules in `README.md` |
| Point at existing rules; never restate a skill or convention | same, § Adding an agent, rule 4 | a second copy of the EARS reference or the skills routing table |
| Hand-authored skills stay out of `skills-lock.json` | root `CLAUDE.md` § Do not touch | adding `implement/` or `workflow-retro/` to the lock |
| A new `docs/` file needs an index row and an owner | `docs/README.md` § Adding a document, rule 4 | committing `docs/retro/ledger.md` unlisted |
| Historical specs are a record, not documentation | `specs/README.md` rule 5 | rewriting `planner` → `implementation-planner` inside `specs/L03-*.md` |
| A guard fails **open**, with a message on stderr | `scripts/readonly-agent-guard.sh`, header | any new gate that blocks silently |
| English everywhere except the EARS criteria table | root `CLAUDE.md` § Conventions (after Step 1) | Ukrainian prose in an agent or skill file |

## Implementation plan

### Step 1 — the conventions everything else points at
Files:   `specs/README.md` (edit) · `specs/TEMPLATE.md` (rewrite) · `CLAUDE.md` (edit)
Do:      Merge the SDD sections into the template (15 sections, `Spec ID` / `Supersedes` in the
         header). Add to `specs/README.md`: the EARS reference copied **verbatim** from the
         spec's Appendix, the `AC-NN` rule, the `[NEEDS CLARIFICATION]` status gate, the
         `approved ≈ in-progress` mapping, and where plans live. Add to `CLAUDE.md` the one
         language exception and the two new skills in § Do not touch. Move the spec to
         `Status: in-progress`.
Verify:  `[ $(grep -c '^## ' specs/TEMPLATE.md) -eq 15 ]` · `grep -n 'Mavin' specs/README.md`
         · `grep -n 'EARS' CLAUDE.md`
Covers:  AC-05, AC-08, AC-32, AC-33, AC-36, AC-38
Depends: none
Commit:  `docs(specs): the spec format the pipeline writes into`

### Step 2 — `spec-creator`
Files:   `.claude/agents/spec-creator.md` (new)
Skills:  none — read `.claude/agents/README.md` § Adding an agent first
Do:      Frontmatter (`tools` allowlist with the four read-only MCP tools, no `Task`, no web,
         no `run_agent_on_pr`; `model: opus`). Body: hard rules, the six blocking categories,
         the reading order, the design-source analysis step, the EARS step pointing at
         `specs/README.md`, the write-path rule, the self-check, the return template.
Verify:  `head -6 .claude/agents/spec-creator.md` · `grep '^tools:' … | grep -cv Task` ·
         `[ $(wc -l < .claude/agents/spec-creator.md) -le 320 ]`
Covers:  AC-01, AC-02, AC-03, AC-04, AC-06, AC-07, AC-09, AC-10, AC-35
Depends: Step 1
Commit:  `feat(agents): spec-creator, the agent that answers what and why`

### Step 3 — `planner` becomes `implementation-planner`
Files:   `git mv .claude/agents/planner.md .claude/agents/implementation-planner.md` + rewrite ·
         `.claude/agents/{implementer,architecture-reviewer,security-reviewer,doc-writer,plan-verifier}.md`
         (references) · `server/test/readonly-agent-guard.test.ts:118`
Do:      Input is a spec path. Add the requirements review, `Covers: AC-NN` on every step, the
         coverage table, the single-agent / multi-agent question in `Handoff`, and the closing
         recommendations. Remove everything that writes requirements: a gap in the spec goes
         back to `spec-creator`. Plan path becomes `specs/plans/<slug>.md`.
Verify:  `grep -rn "\bplanner\b" .claude/ CLAUDE.md scripts/ server/test/ | grep -v implementation-planner`
         → empty · `cd server && pnpm exec vitest run test/readonly-agent-guard.test.ts`
Covers:  AC-11, AC-12, AC-13, AC-14, AC-15, AC-16
Depends: Step 1
Commit:  `refactor(agents): planner becomes implementation-planner, and takes a spec`

### Step 4 — `plan-verifier` walks the spec, not only the plan
Files:   `.claude/agents/plan-verifier.md` (edit)
Do:      Accept two paths. The unit of verification becomes the `AC-NN` extracted verbatim from
         the spec; the matrix is `AC → task → test → commit`. With no spec, verify against the
         plan and say out loud that the AC column is empty.
Verify:  `grep -n 'AC-' .claude/agents/plan-verifier.md`
Covers:  AC-17, AC-18
Depends: Step 3
Commit:  `feat(agents): plan-verifier walks AC → task → test → commit`

### Step 5 — `/implement`
Files:   `.claude/skills/implement/SKILL.md` (new)
Skills:  copy the anatomy of `.claude/skills/pr-self-review/SKILL.md`
Do:      Takes a plan path; refuses without one. Runs `implementer` → `architecture-reviewer`
         (`model: sonnet` at the call) → fix iterations, at most two, until no `CRITICAL` →
         typecheck / unit / `arch:check` always → `plan-verifier` (`sonnet`) last.
         `test-writer` only behind `--tests`. Never launches `spec-creator` or
         `implementation-planner`. A failed `Verify` stops the run and reports.
Verify:  `ls .claude/skills/implement/SKILL.md` · `grep -c 'spec-creator' …/SKILL.md` → 0 ·
         `grep -n 'sonnet' …/SKILL.md`
Covers:  AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25
Depends: Step 4
Commit:  `feat(skills): /implement, the command that runs an approved plan`

### Step 6 — `/workflow-retro` and its ledger
Files:   `.claude/skills/workflow-retro/SKILL.md` (new) · `docs/retro/ledger.md` (new) ·
         `docs/README.md` (index row)
Do:      Manual invocation only. Reports agents launched and their order, tokens spent, what was
         easy, what was hard, what information was duplicated, what was missed — then concrete
         proposals, each naming the agent or skill file to change. Output goes to chat **and** as
         one appended ledger entry. `deep` additionally reads run logs from disk.
Verify:  `grep -n 'ledger' docs/README.md` · `grep -c 'workflow-retro' .claude/skills/implement/SKILL.md`
         → 0 · `grep -c 'workflow-retro' .claude/settings.json` → 0
Covers:  AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-36
Depends: Step 5
Commit:  `feat(skills): /workflow-retro, and the ledger it writes to`

### Step 7 — the registries
Files:   `.claude/agents/README.md` · `.claude/skills/README.md` · `CLAUDE.md` (§ Session protocol)
Do:      Catalog row, permissions row, artefacts row and the flow diagram for `spec-creator`;
         the planner's new name everywhere; two skill rows. Session protocol gains the pipeline
         in one sentence. Nothing in the lock file.
Verify:  `grep -c 'implement\|workflow-retro' skills-lock.json` → 0 ·
         `grep -n 'spec-creator' .claude/agents/README.md`
Covers:  AC-34, AC-37
Depends: Step 6
Commit:  `docs(agents): the registry, rewritten around the SDD pipeline`

### Step 8 — close the structural half
Files:   none (verification pass) · `specs/L05-sdd-pipeline.md` (status)
Do:      Re-run every `How it is checked` command that is a shell command, from AC-01 to AC-38.
         Then `/pr-self-review`. Any red is a fix in the step that owns it, never a note here.
Verify:  the AC table, top to bottom · `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
Covers:  the structural half of every AC
Depends: Step 7
Commit:  `chore(specs): the pipeline's structural criteria, checked`

### Step 9 — the first real run (boundary of this plan)
Do:      Run the pipeline once, for real, on the first L05 feature: `spec-creator` writes the
         Project Context Folder spec, `implementation-planner` plans it, `/implement` executes,
         `/workflow-retro` records what it cost. This is where the behavioural criteria are
         observed rather than read, and where this plan ends and the feature work begins.
Verify:  a new spec under `specs/`, a new plan under `specs/plans/`, one entry in
         `docs/retro/ledger.md`
Covers:  AC-03, AC-04, AC-06, AC-07, AC-12 … AC-18, AC-20, AC-22, AC-28 … AC-31 (observed)
Depends: Step 8

## Coverage

| AC | Step | AC | Step | AC | Step |
|---|---|---|---|---|---|
| AC-01 | 2 | AC-14 | 3 | AC-27 | 6 |
| AC-02 | 2 | AC-15 | 3, 9 | AC-28 | 6, 9 |
| AC-03 | 2, 9 | AC-16 | 3, 9 | AC-29 | 6, 9 |
| AC-04 | 2, 9 | AC-17 | 4, 9 | AC-30 | 6, 9 |
| AC-05 | 1 | AC-18 | 4, 9 | AC-31 | 6, 9 |
| AC-06 | 2, 9 | AC-19 | 5 | AC-32 | 1 |
| AC-07 | 2, 9 | AC-20 | 5, 9 | AC-33 | 1 |
| AC-08 | 1, 2 | AC-21 | 5 | AC-34 | 7 |
| AC-09 | 2 | AC-22 | 5, 9 | AC-35 | 2 |
| AC-10 | 2 | AC-23 | 5 | AC-36 | 1, 6 |
| AC-11 | 3 | AC-24 | 5 | AC-37 | 7 |
| AC-12 | 3, 9 | AC-25 | 5 | AC-38 | 1 |
| AC-13 | 3 | AC-26 | 6 | | |

Every criterion from AC-01 to AC-38 appears at least once.

## Commit plan

**One commit per step, nine at the ceiling.** The boundary is not arbitrary: every step above
already ends in a command that passes or fails, and that command is the commit's gate. A step
whose `Verify` has not passed does not get committed.

| # | Step | Commit |
|---|---|---|
| 1 | conventions | `docs(specs): the spec format the pipeline writes into` |
| 2 | `spec-creator` | `feat(agents): spec-creator, the agent that answers what and why` |
| 3 | planner → `implementation-planner` | `refactor(agents): planner becomes implementation-planner, and takes a spec` |
| 4 | `plan-verifier` | `feat(agents): plan-verifier walks AC → task → test → commit` |
| 5 | `/implement` | `feat(skills): /implement, the command that runs an approved plan` |
| 6 | `/workflow-retro` + ledger | `feat(skills): /workflow-retro, and the ledger it writes to` |
| 7 | registries | `docs(agents): the registry, rewritten around the SDD pipeline` |
| 8 | structural verification | `chore(specs): the pipeline's structural criteria, checked` |
| 9 | first real run | commits belong to the feature, not to this plan |

Rules, in the house style the log already uses (`type(scope): what changed, and the second
thing it changed`):

- **Never one giant commit.** Eight prose steps squashed into one makes `git bisect` useless
  and makes Step 3 — the rename, the one step most likely to need reverting on its own —
  impossible to revert without dragging six others with it.
- **Never a commit for its own sake either.** If a step turns out to be a no-op, it gets no
  commit. Nine is the ceiling, not a quota.
- **A commit never leaves the tree broken.** Step 3 renames a file and fixes every reference to
  it in the same commit; split across two, the registry points at a file that does not exist.
- **`/pr-self-review` runs before the pull request, not before each commit.** A `PreToolUse`
  hook blocks `gh pr create` until it passes (root `CLAUDE.md` § Session protocol).
- **Commit only when asked.** This plan says where the boundaries are; it does not authorise
  pushing or opening a pull request.

## Handoff

Plan file:      `specs/plans/L05-sdd-pipeline.md`
Entry point:    Step 1
Execution mode: **single-agent pass.** Steps 1–7 are prose in `.claude/` and `specs/`, each one
                depending on the previous, with no parallelisable code. A multi-agent run would
                pay for eight contexts to serialise anyway. Step 9 is the multi-agent one, and
                it runs through `/implement`, which is the point.
Verification:   per step above; `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
                at Step 8; `/pr-self-review` before the pull request.
Closing step:   after Step 8 passes, set the spec's `Status:` to `done` and remove its pointer
                from the Read-when list of any `CLAUDE.md` that carries one (`specs/README.md`
                rule 6). Then run `/engineering-insights` — routed to the **root** `INSIGHTS.md`,
                since this work spans `.claude/`, `specs/` and `docs/` rather than one package.
                That is the moment the planning-time hypotheses in Recommendations are either
                confirmed as lessons or dropped; nothing goes in the journal before then,
                because its entries are read as high-confidence guidance and a hypothesis
                recorded as a lesson devalues every entry beside it.
                Commit: `docs(specs): close the pipeline spec, and record what it taught`.
Deviation policy: stop at the step, report the divergence, finish the independent steps. Do not
                re-plan, and do not amend the spec — a gap in it goes back to `spec-creator`.

## Recommendations

- **Write Step 2 last among the prose steps if context runs short.** It is the longest file and
  the one that benefits most from having Steps 3–7 already written, because it points at them.
- **Do not import the abandoned parallel-session work.** It was written against different
  conventions (a root `plans/` directory) and before this spec existed; discarded by decision on
  2026-08-29.
- **Add the write guard the moment a stray file appears** in a diff from `spec-creator`. The
  decision to go prompt-only is recorded with its trigger in the spec's Open questions #1, so
  reversing it is a twenty-line commit and not a re-litigation.
- **Run `/workflow-retro` after Step 9, not after Step 8.** There is nothing to analyse until a
  real multi-agent run has happened.
