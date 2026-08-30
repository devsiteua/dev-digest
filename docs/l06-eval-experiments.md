# L06 lab — the four eval experiments

The runbook for the second half of L06's lab: experiments 2 to 5. It exists because the
lesson text and the `evals/` package that shipped with it disagree in four places, and each
disagreement costs a model run to discover.

**Order.** The lab comes before the homework, in this branch. The homework's spec
([`../specs/eval-pipeline.md`](../specs/eval-pipeline.md)) and plan
([`../specs/plans/eval-pipeline.md`](../specs/plans/eval-pipeline.md)) are already written and
committed, but no product code exists yet — so running the lab now still puts it first for
everything that gets built. Two reasons the order is not cosmetic:

1. Experiment 2 **temporarily removes a rule** from `.claude/skills/onion-architecture/SKILL.md`.
   The homework's plan assigns that skill to `implementer` on Steps 1, 5, 6 and 7. Running
   `/implement` while the skill is degraded is a quietly worse implementation that nobody would
   trace back to the cause.
2. Experiment 5 adds the routing table and the CI job. Landing them after the homework's code
   means the gate never covered the code it exists to gate.

**Do not start the homework's `/implement` until every artifact this file degrades is restored
and the restore is confirmed on a series, not on one run.**

## State verified in the tree, not remembered

Checked at `7548450`. The lesson text assumes some of this and is wrong about the rest.

| Claim in the lesson | What is actually here |
|---|---|
| "run the ready-made eval for `onion-architecture`" | **There is none.** `evals/skills/` holds exactly one suite, `dependency-checker`. Experiment 2 has to write the eval before it can break anything. |
| the shipped skill suite is runnable | **Its target does not exist.** `evals/skills/dependency-checker/` evaluates `.claude/skills/dependency-checker`, and that skill is not in this repository — it was authored during the recording and never landed here. |
| experiment 3 needs a "version B" built by hand | **Half of it is pre-wired.** `evals/agents/architecture-reviewer-lite/architecture-reviewer-lite.eval.ts` already imports the strict variant's cases so the pair is a controlled A/B. What is missing is only the agent artifact `.claude/agents/architecture-reviewer-lite.md`. |
| the workflow suite covers control/treatment for `CLAUDE.md` | **It does not.** `evals/workflow/review-workflow.cases.ts` carries 5 cases — 3 `trace` and an `activation` pair — and its comment at line 47 records that the contrast case was downgraded, because "the control run (empty tmpdir) could still reach the real repo". Experiment 4 has to restore a real control. |

Also true, and worth knowing before the first run:

- `pnpm eval:quality` is green — 17 skills, 0 failures, with `WARN no eval file` on the skills
  that carry no suite. That warning is the normal state today, not a defect.
- `evals/src/config.ts:9-10` — `EVAL_MODEL` defaults to `claude-haiku-4-5` and
  `EVAL_JUDGE_MODEL` to `claude-sonnet-5`, a stronger family on purpose, to soften
  self-preference in the judge.
- By default the package runs on the **Claude Code subscription**: the API key is stripped from
  spawned processes (`evals/src/runtime/env.ts:38`), and the spawned `claude` binary carries the
  login. That path needs nothing configured.
- `EVAL_BACKEND=openrouter` switches the same tests to a cheap model with no code change — but
  it reads `OPENROUTER_API_KEY` **from the shell environment** and throws when it is unset
  (`env.ts:31`, `run-openrouter.ts:23`). In this repository the real key lives in
  `~/.devdigest/secrets.json`, which is the *server's* read chokepoint and is never exported to
  a shell, while `server/.env`'s copy of the name is deliberately empty. So the fallback backend
  needs the key exported by hand for that command; it will not find it on its own.
- `onion-architecture` is **hand-authored and ours to edit** (root `CLAUDE.md` § Do not touch
  lists it among the six that must stay out of `skills-lock.json`). Breaking it deliberately is
  legal; breaking a vendored skill would not be.

**Budget.** Two runs per configuration, maximum. The lesson asks for this explicitly and every
experiment below is written to it. A statistical claim from a single run is not evidence, and a
third run rarely changes the answer a second one gave.

## Experiment 2 — break a skill, and write our own cases

**Goal.** Show that removing one rule from a skill drops *the expectation tied to that rule*,
not the overall score — and that the drop reproduces across a series.

**Precondition.** The eval does not exist. Write it first:
`evals/skills/onion-architecture/onion-architecture.{eval,cases}.ts` plus a `fixtures/`
directory. This is not extra work — it is the lab checklist's own "own `<skill>.cases.ts` with
curated expectations", satisfied by the same artifact.

Fixtures go in `evals/skills/<name>/fixtures/`, **never inside the skill directory**: a planted
violation sitting next to the rules would be read by the model as reference material.

**Procedure.**

1. Write 3 to 5 expectations and one negative prompt. Cut every criterion a model would pass
   with no skill at all, and every criterion for which no evidence could be quoted — those two
   cuts are what separates a real case from a generated draft.
2. `pnpm eval:repeat` the suite, labelled as the baseline. Two trials.
3. Remove one concrete rule from `SKILL.md` — the DI-container requirement is the lesson's
   example.
4. Repeat the series with the degraded skill, and check that **the related expectation** is what
   fell.
5. Restore the rule. Confirm recovery **on the series**, not on a single green run.

**Evidence to keep.** The two labelled series and the delta between them, naming the expectation
that moved.

**Commit.** One commit for the new suite and its fixtures. The break and the restore are not
committed — they are a working-tree experiment that ends where it started. Confirm with
`git diff --stat .claude/skills/onion-architecture/` returning empty before moving on.

## Experiment 3 — two versions of one agent

**Goal.** The same controlled A/B, one level up: an agent definition rather than a skill.

**Procedure.**

1. Create `.claude/agents/architecture-reviewer-lite.md` as a copy of `architecture-reviewer.md`
   with the "cite the specific documented rule per finding" hard rule removed. Change nothing
   else — the eval is only a controlled comparison if the artifact is the single variable.
2. `pnpm eval:repeat` both, each with its own label; two trials each.
3. `pnpm eval:delta` the two labels.

**Expected result.** A specific expectation falls — the one about citing a rule. A movement in
an aggregate score with no identifiable expectation behind it is not the result; if that is what
appears, read the trajectories. The lesson names the three usual causes: a weak case, a lenient
grader, or a base model strong enough to cite the rule without being told to.

**Commit.** The `-lite` agent is a committed artifact — it is the experiment's apparatus, and
the pre-wired eval expects it to exist.

## Experiment 4 — the whole workflow

**Goal.** Prove behaviour that no single artifact owns: dispatch, activation, and whether
`CLAUDE.md` changes what gets read.

The suite must carry four kinds. Three are present; the fourth has to be rebuilt:

| Kind | State |
|---|---|
| dispatch — an architecture task creates `architecture-reviewer` | present |
| positive activation — a genuine discovery activates `engineering-insights` | present |
| negative activation — explaining the same topic must **not** activate it | present |
| control/treatment for `CLAUDE.md` | **downgraded**, see `review-workflow.cases.ts:47` |

The control must be genuinely isolated. The recorded reason the old one was dropped is that an
empty temporary directory could still reach the real repository, which makes the control and the
treatment the same run wearing two labels.

**What counts as evidence.** Actual tool calls and files read. The sentence "I invoked the
reviewer" in a transcript proves nothing — the assertion is on the trace.

**Safety.** A session that reads the live repository gets a **read-only allow-list**. No `Bash`,
no `Write`, unless the case genuinely needs them.

**Cost.** Sessions dominate the bill here. Merge what can be merged into one session — the
suite already does this deliberately, combining `CLAUDE.md` routing and subagent dispatch into a
single trace case — and keep the total at six sessions or fewer, two runs each.

## Experiment 5 — the routing table and CI

**Goal.** Make the rule "which eval runs after which change" part of the project, not part of
someone's memory.

**In `CLAUDE.md`:**

| Change | Minimum check |
|---|---|
| `.claude/skills/**` | `eval:quality` + that skill's eval |
| `.claude/agents/**` | that agent's eval + the relevant workflow case |
| `CLAUDE.md` / routing rules | `eval:workflow` |
| an eval case or a grader | re-calibrate the baseline |

**In CI:**

- `eval:quality` is **blocking**. Model runs **publish a report** and a comparison against the
  baseline; they do not block, because a probabilistic check with a threshold is the wrong shape
  for a hard gate.
- `paths` filter, `concurrency` limit, `timeout`, budget.
- A skill or agent with no eval logs a **skip**, and does not fail the job.
- **No secrets reach a fork pull request**, and the job takes no write permission it does not
  need.
- The model is switchable through a job parameter — nothing about it belongs on a UI.

**Commit.** The CI files are focused enough to be one commit; the `CLAUDE.md` table is another,
because it is a rule the repository now enforces and it should be readable alone in its diff.

## Done when

The lesson's own checklist, minus experiment 1, which is already done:

- [ ] `pnpm eval:quality` green
- [ ] an own `<skill>.cases.ts` with curated expectations
- [ ] two agent versions compared as series, with a visible spread
- [ ] a workflow trace proving dispatch, positive activation and a negative control
- [ ] the project's rules say which eval follows which kind of change
- [ ] CI passes no secrets to fork PRs and holds no excess write permission

And the one this file adds, which the lesson does not:

- [ ] `git status` clean on `.claude/skills/onion-architecture/` — every deliberate break
      restored, and the restore confirmed on a series

## Then, and only then

The homework continues from its own plan, in a fresh session, from Step 1:
[`../specs/plans/eval-pipeline.md`](../specs/plans/eval-pipeline.md).
