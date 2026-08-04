# PR Self Review — routed pre-PR review with a deterministic gate

Status: done
Owner: —
Packages touched: none (repo tooling: `.claude/`, `scripts/`)

## Goal

Before a pull request is opened, every changed file is reviewed by the skills that actually
apply to it, and `gh pr create` is blocked when the changes contain a CRITICAL — without the
author having to remember to ask.

## Context

Nothing sat between "code written" and "PR opened". No `.claude/commands/`, no git hooks, no
husky; the five CI workflows are test and typecheck lanes that never look at the diff. The one
recorded review finding in the repo is the 2026-08-04 `INSIGHTS.md` entry about the COST column
inheriting its neighbour's aggregation rule — caught by a mentor, by eye, late.

Meanwhile `.claude/skills/` holds thirteen skills whose domain knowledge only loads when a model
happens to think it relevant. This wires them to the diff on purpose.

Everything it needs already existed and is reused rather than restated:
`Severity`/`Finding`/`Review` (`server/src/vendor/shared/contracts/findings.ts`), **Blocker**
(`docs/glossary.md:40`), the gate arithmetic (`reviewer-core/src/output/to-review.ts:22-48`),
the scoring rule and the anti-inflation conventions (`docs/agent-prompts/README.md`), and the
executable onion guard added in `88d483c`.

## In scope

- `.claude/skills/pr-self-review/SKILL.md` — procedure, routing table keyed by path **and** git
  status, severity normalisation, gate arithmetic, report shape.
- `scripts/pr-self-review-hash.sh` — the single definition of the diff hash and of base
  resolution. Both the skill and the gate call it; neither inlines it.
- `scripts/pr-self-review-checks.sh` — twelve mechanical checks, the only source of automatic
  CRITICAL, emitted in the `Finding` field names.
- `scripts/test-pr-self-review.sh` — every check proven by a planted violation, plus negative
  cases for the tree's legitimate patterns.
- `scripts/pr-self-review-gate.sh` + `.claude/settings.json` — PreToolUse hook on `Bash`, gating
  `gh pr create` / `gh pr ready`.
- Wiring: `.gitignore`, the skills catalog, root `CLAUDE.md`.

## Out of scope

- Blocking `git push`, `git commit`, or the merge button. Merge can only be gated by branch
  protection plus a required check; a local hook cannot see the GitHub web UI either.
- Running test suites, typecheck or the build — CI's job. `pnpm arch:check` is the deliberate
  exception: ~1s, no Docker, and the only check that encodes architecture.
- Fixing anything. The skill declares no `Edit`.
- Posting to GitHub, calling an LLM API outside the session, or touching `skills-lock.json`.
- Copying the backend or frontend conventions into this skill. They have owners
  (`onion-architecture/tooling.md`, `frontend-architecture/references/devdigest-profile.md`)
  and a third copy would drift — as `client/CLAUDE.md` and `client/docs/component-anatomy.md`
  already have.
- A general bug hunt. That is `/code-review`.

## Acceptance criteria

- [x] A clean worktree produces no findings and no model review.
- [x] Each of the twelve scripted checks has been observed firing on a planted violation.
- [x] The tree's existing legitimate patterns stay silent: `refetch()`, `client/src/lib/api.ts`,
      `process.env` in the secrets adapter and the seed/migrate entrypoints, the prompt-authoring
      README, and the historical drift between the two `vendor/shared` copies.
- [x] `gh pr create` is denied, with `file:line` and a fix, when a CRITICAL is present.
- [x] `git push`, `git status`, `pnpm test` and `gh pr list` are never gated.
- [x] A mention of the words in prose (`echo … gh pr create …`, a commit message) does not trip
      the gate; `cd x && gh pr create` and `PAGER=cat gh pr create` do.
- [x] The gate blocks when no review has been run, even though the skill was never invoked.
- [x] A stale-but-clean verdict allows the PR with a printed note; a stale failing verdict blocks.
- [x] Any internal error in the hook allows the command **and** says why on stderr.
- [x] An architecture guard that could not run reports "not verified", never silence.
- [ ] Anti-inflation: a component pushed past 200 lines with nothing broken yields at most
      WARNING and the gate passes. Requires a model lane; see Risks.

## Test plan

`scripts/test-pr-self-review.sh` is the whole suite and covers both halves. Its first section
plants a violation for each scripted check and then asserts the tree's own legitimate patterns
stay quiet; its second section pipes a PreToolUse payload into `scripts/pr-self-review-gate.sh`
and asserts the exit code — 0 allows, 2 denies. It plants into the worktree and restores, and it
never runs `git clean`, because the feature's own scripts are untracked while it is being built.

It prints its own pass/fail tally rather than fixing a count here, so adding a case does not
require editing this spec.

No suite in `server/`, `client/`, `reviewer-core/` or `e2e/` is touched, and none needed
changing; both are run as a regression check.

## Risks

- **False blockers switch the gate off.** Mitigated by demoting every vendored `CRITICAL` to
  `WARNING` (react-best-practices tags "max 200 lines" and "max 5-7 props" CRITICAL), by making
  only the twelve mechanical checks auto-block, and by giving each check a test. `check:env-read`
  is a WARNING precisely because its exception list is open-ended.
- **A repo-wide `PreToolUse` hook runs on every Bash call for anyone who pulls.** The command
  filter is the first statement and the script exits 0 on any internal error, but a bug here is
  felt by every session in the repo.
- **The hash recipe drifting between the skill and the gate** would make the gate block
  everything or nothing, and "nothing" is silent. One script, two callers, never inlined.
- **A green `arch:check` without `reviewer-core/node_modules` is falsely green** — the alias
  resolves but the graph changes shape (`INSIGHTS.md`, 2026-08-05). Reported as a WARNING.
- The model-lane behaviour (routing, fan-out, normalisation) is specified but exercised by
  running the skill, not by an automated suite. The last acceptance criterion stays open until
  it has been run against a deliberately noisy diff.

## Open questions

None. Branch protection and a `pre-push` hook were considered and deliberately left out; add
them only if bypassing outside Claude Code becomes a real problem rather than a theoretical one.
