---
name: implement
description: "Runs an approved Development Plan end to end: implementer writes the code step by step, architecture-reviewer judges it, at most two fix iterations close every CRITICAL, typecheck and unit tests and arch:check run for every package touched, and plan-verifier returns the AC → task → test → commit matrix last. Takes a path to a plan file and refuses without one. It executes a plan; it never writes one and never writes a spec, and it opens no pull request. Trigger terms: implement, implement the plan, run the plan, execute the plan, build the plan, /implement, реалізувати план, виконати план, запусти план, збудуй за планом."
allowed-tools: Bash, Read, Grep, Glob, Task
---

# Implement

The command that turns an approved plan into a reviewed, verified diff. One human types it,
one plan file drives it, and nothing in it decides *what* to build.

Invoke as `/implement <path-to-plan> [--steps 1-4] [--tests] [--no-review]`.

**What this is not.** Not a planner and not a spec writer — both of those are agents a human
launches separately, before this. Not a pull-request gate: `/pr-self-review` is that, and it
runs after this, not inside it. Not an autonomous loop — it stops at a red command and hands
back rather than re-planning around it.

## 1. Scope — what it launches, and what it never launches

| Stage | Agent | Model | When |
|---|---|---|---|
| 1 | `implementer` | `inherit` | always |
| 2 | `architecture-reviewer` | **`sonnet`, overridden at the call** | always, unless `--no-review` |
| 3 | `implementer` again, with the findings | `inherit` | only while a CRITICAL is open, at most twice |
| 4 | `test-writer` | `inherit` | only with `--tests` |
| 5 | `plan-verifier` | **`sonnet`, overridden at the call** | always, last |

**Two agents are never launched from here, under any flag:** the one that writes the
specification and the one that writes the plan. Both stages are typed by a human, on purpose
— the pipeline is not autonomous, and an `/implement` that could re-plan around an obstacle
would defeat the reason a plan is approved before it runs. If a requirement is missing, this
command stops and says so; it does not go and get one.

The mechanical form of that rule: **§4's launch table is the complete list of agents this
skill may start**, and it has five rows naming four agents. A reviewer checks it by reading
that table, not by grepping the prose — this section has to name what it forbids in order to
forbid it.

**The reviewers' own files stay `model: opus`.** The downgrade is an override passed at the
call site, because the reason those files are pinned to opus (`.claude/agents/README.md` §
Catalog) stays true everywhere else. Opus on two read-only agents across a whole run is the
single largest avoidable cost, and this is the one place it is worth paying less.

## 2. Flags

| Flag | Default | Effect |
|---|---|---|
| `--steps N-M` | every step | run only that range of the plan's steps |
| `--tests` | **off** | launch `test-writer` after the fixes land. Off by default for budget: a plan whose steps already name their tests does not need a second agent to write them |
| `--no-review` | off | skip `architecture-reviewer` and its loop. For a plan that touches no code — prose, docs, config |

`--tests` and `--no-review` change which *agents* run. Neither changes §6: typecheck, unit
tests and `arch:check` run for every package the diff touched, whatever was passed.

## 3. Preflight — refuse early, and cheaply

Nothing is launched until all of this passes. Every refusal below costs zero agents.

1. **A plan path was given.** Without one, stop and ask:

   ```
   ## Which plan?

   `/implement` runs an approved plan and needs its path — `specs/plans/<slug>.md`.
   No agent has been launched.

   Plans I can see: <ls specs/plans/ *//specs/plans/>
   If none of these is it, the plan does not exist yet: run `implementation-planner`
   against the spec first.
   ```

2. **The file exists and reads like a plan** — it has `## Implementation plan` and at least
   one `### Step`. A spec passed by mistake is caught here: it has `Acceptance criteria`
   instead, and the answer is to plan it first.

3. **The spec behind it is approved.** Follow the plan header's `Spec:` link. If that file
   carries a `[NEEDS CLARIFICATION]` marker, or its `Status:` is still `draft` with markers
   in it, **stop**: a draft spec is not an approved one (`specs/README.md` rule 5). Print the
   markers and hand back. A `draft` with no markers is a judgement call — say so and ask.

4. **The tree is clean enough to attribute a change to this run.** `git status --short`.
   Uncommitted work in the plan's own files is reported before starting, never silently
   built on top of.

5. **Print the plan's `Coverage` table before launching anything.** The user is authorising
   a run; they should see which criteria it claims to close, and which the plan already said
   it does not. A plan with no coverage table is a warning, not a refusal — say the column is
   unavailable and continue.

## 4. Run the plan

Launch `implementer` once, with the plan path and the step range. Not once per step: the plan
is a file it reads, and one context that carries steps 1–9 is cheaper and more coherent than
nine that each rediscover the repository.

Give it: the plan path, the step range, and nothing else that the plan already says. Re-stating
a step in the prompt is how the prompt and the plan start to disagree.

**A step's own `Verify` command failing stops the run.** The skill reports which step, the
command, and its real output, then finishes only the steps the plan marks as independent of
it. It does not re-plan around a red command, does not "try a different approach", and does
not carry on to the review — that is the deviation policy every plan carries in `Handoff`,
and re-planning around a failure is precisely the failure mode this pipeline exists to
prevent.

## 5. Loop — architecture review and fixes

Skipped entirely under `--no-review`. Otherwise:

```
implementer  ──►  architecture-reviewer (sonnet)  ──►  findings
                            ▲                             │
                            └──── implementer, fixes ◄─────┘
                                   at most 2 iterations
```

- Give the reviewer a **scope that resolves to a file list** — the diff this run produced,
  not "the repository". That is the input its file asks for.
- The loop's exit condition is **no `CRITICAL` findings left**. `WARNING` and `SUGGESTION` do
  not spend an iteration; they are reported and handed to the human.
- **Two iterations, hard.** After the second, if a `CRITICAL` is still open the run stops,
  reports it, and hands back. It never loops a third time, and it never opens a pull request.
  A reviewer and an implementer that disagree twice are a decision for a person, not a budget
  to burn.
- Each fix iteration goes back to `implementer` with the findings verbatim — severity,
  `file:line`, rationale. Not a summary: the reviewer's wording is what the fix is judged
  against.

## 6. Verification — always, whatever the flags

For **every package the diff touched**, and no others:

| Package | Commands |
|---|---|
| `server` | `pnpm typecheck` · `pnpm exec vitest run --exclude '**/*.it.test.ts'` · `pnpm arch:check` |
| `client` | `pnpm typecheck` · `pnpm test` |
| `reviewer-core` | `npm test` — **npm**, not pnpm; report the test count, since it passes with no tests |
| `mcp` | `pnpm typecheck` · `pnpm test` — `arch:check` does not cover `mcp/`; its ring table is enforced by hand |
| `e2e` | do not run. Name the flows the diff puts at risk |

Integration tests (`.it.test`) need Docker. Run them when it is up; when it is not, say so —
a skipped lane is reported, never counted as green.

Read `arch:check` by its **output**, not its exit code: `no-cross-module-import` is a warning
and still exits 0 (`server/INSIGHTS.md`, 2026-08-06).

A red command here stops the run the same way §4 does. Report it with its real output.

## 7. Plan verification, last

`plan-verifier` on `sonnet`, given **both paths** — the spec and the plan — plus the diff
range that defines the finished code. It runs after the fixes, not before them: verifying a
tree that is about to change verifies nothing.

Its `AC → task → test → commit` matrix is the answer to "is it done". Pass it through to the
report as it came back; do not re-summarise its verdicts into a sentence.

## 8. Report

```
/implement — specs/plans/<slug>.md · steps 1-9 · packages: server, client
Coverage claimed: AC-01…AC-38 (38 of 38) · flags: none

Steps      9 run, 9 green            Deviations: none
Review     2 CRITICAL → 1 iteration → 0 CRITICAL, 3 WARNING open
Verify     server: typecheck ✓ unit 214 ✓ arch:check clean
           client: typecheck ✓ test 96 ✓        it.test: skipped — Docker down
Plan       38 criteria · 31 MET · 3 PARTIAL · 0 NOT MET · 4 NOT VERIFIED

Open after this run
  WARNING  <file:line> — <what>
  PARTIAL  AC-22 — <the gap the verifier named>

Not done: <steps blocked, and by what> | none
Next: `/pr-self-review` before the pull request. Nothing here opened one.
```

**Green is a claim, so it names its evidence.** Every command in the `Verify` block is one
that actually ran, with its real count. A lane that could not run says which and why, in the
place a number would have been — a skipped check reported as a pass is worse than no check.

**This command never commits, never pushes, and never opens a pull request.** The plan's
`Commit plan` says where the boundaries are; a human decides when to cross one.
