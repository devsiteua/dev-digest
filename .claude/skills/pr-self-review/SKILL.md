---
name: pr-self-review
description: "Reviews every open local change before a pull request is opened, and blocks `gh pr create` when a CRITICAL is found. Routes each changed file to the skills that apply to it — UI skills on UI files, backend and data skills on server files — normalises each skill's native severity scale onto CRITICAL/WARNING/SUGGESTION, drops any finding that does not cite a real diff line, and writes a verdict keyed to the diff hash so a green result cannot be reused after the code changes. Trigger terms: pr self review, self review, review my changes, review before PR, pre-PR check, gh pr create, open a pull request, ready to open a PR, can I merge, is this safe to ship."
allowed-tools: Bash, Read, Grep, Glob, Task, Write
---

# PR Self Review

The last thing that runs before a pull request exists. Route the diff to the skills that
apply to it, gate on what is provably wrong, and say plainly what was not checked.

Invoke as `/pr-self-review [--base <ref>] [--fail-on never|critical|warning|any] [--override "<reason>"]`.

**What this is not.** Not a general bug hunt — that is `/code-review`. Not a test runner —
that is CI. Its contribution is routing, this repo's own conventions, and a deterministic
gate. If you catch yourself writing findings any reviewer would produce without the routing
table, you are duplicating `/code-review` badly.

## 1. Scope the diff

```sh
BASE_SHA=$(scripts/pr-self-review-hash.sh --print-base)   # never resolve the base by hand
git diff --name-status "$BASE_SHA"                        # committed + staged + unstaged
git ls-files --others --exclude-standard                  # untracked — these count too
```

Uncommitted work is in scope. This runs *before* a PR, so what is on disk is what ships.
Say so in the report when the tree is dirty: a green verdict on a tree the author is still
editing is a green verdict on the wrong thing.

**Drop from review, keep in the hash** — generated, vendored, or lock content:
`server/src/db/migrations/**`, `client/src/vendor/ui/**`, `server/clones/**`, `.next/**`,
any lockfile. On the L01 pull request one generated migration snapshot was 3443 of 8480
lines. These paths still reach the scripted checks — that they were *touched* is the finding,
not what is inside them.

Empty diff and a clean tree → say "nothing to review" and stop. That is a result, not a failure.

## 2. Run the scripted checks first

```sh
scripts/pr-self-review-checks.sh          # JSON array of findings, ~1s
```

These are the **only** source of automatic CRITICAL. Each one is mechanical, has a written
owner in this repo, and has been watched failing (`scripts/test-pr-self-review.sh`).

If they return a CRITICAL you may report and stop — the gate is already decided, and a
blocked pull request should not cost five subagents. Say that you stopped early.

Two of them return WARNING on purpose: `check:env-read`, whose exception list is open-ended,
and the two `check:arch-*` degradations. **A missing architecture guard is reported, never
assumed clean.**

## 3. Route by path *and* by status

Status comes from `git diff --name-status` and is **relative to the merge-base**, so a file
first created on this branch reads `A` even when you are editing it now.

| Status | What applies |
|---|---|
| `A`, `R` | placement skills (`frontend-architecture`) **and** quality skills |
| `M` | quality skills only — do not argue about where a file lives when it merely changed |
| `D` | scripted checks only — orphaned imports, stale copy, e2e literals |

Discover skills with `ls -d .claude/skills/*/` and read each `name` from frontmatter.
**Do not read `skills-lock.json`** — it names skills that are not on disk and misses several
that are. A skill named below but absent degrades its lane to repo rules with a printed note.

| Path | Lane | Skills |
|---|---|---|
| `server/src/modules/**/routes.ts` | BACKEND | onion-architecture, fastify-best-practices, zod |
| `server/src/modules/**/repository*.ts` | BACKEND | onion-architecture, drizzle-orm-patterns, postgresql-table-design |
| `server/src/modules/**/service.ts` | BACKEND | onion-architecture, typescript-expert |
| `server/src/{platform,adapters}/**` | BACKEND | onion-architecture, security |
| `server/test/**` | BACKEND | onion-architecture |
| `server/src/db/schema/*.ts` | DATA | drizzle-orm-patterns, postgresql-table-design |
| `{server,client}/src/vendor/shared/**` | ENGINE | zod, onion-architecture |
| `reviewer-core/src/**` | ENGINE | onion-architecture, typescript-expert, zod |
| `client/src/app/**`, `client/src/components/**` | FRONTEND | react-best-practices, next-best-practices, *(A/R:* frontend-architecture*)* |
| `client/src/lib/hooks/*.ts`, `client/src/lib/*.ts` | FRONTEND | react-best-practices, typescript-expert |
| `client/**/*.test.tsx` | FRONTEND | react-testing-library |
| `client/src/components/mermaid-diagram/**`, docs with a ```mermaid fence | FRONTEND / REPO | mermaid-diagram |
| `e2e/**` | REPO | typescript-expert *(`*.ts` only)* |
| `INSIGHTS.md`, `*/INSIGHTS.md` | REPO | engineering-insights |
| everything else | REPO | — |

**Repo conventions are read, never copied.** Each zone has an owner and this skill points at
it instead of restating it:

| Lane | Read for conventions |
|---|---|
| BACKEND · DATA · ENGINE | `.claude/skills/onion-architecture/tooling.md` → "Review checklist for a backend diff" |
| FRONTEND | `.claude/skills/frontend-architecture/references/devdigest-profile.md` |
| REPO | `e2e/CLAUDE.md`, `specs/README.md`, root `CLAUDE.md` |

A third copy would drift. It already has: `client/CLAUDE.md:25-27` and
`client/docs/component-anatomy.md:20` state opposite rules for how many files a component
folder needs, and the tree follows the narrower one. When two sources disagree, the more
specific document wins.

Print the routing decision *before* reviewing, and list any changed file that matched no lane.
A human must be able to see "these 4 files → FRONTEND → react-best-practices" and disagree.

## 4. Review each lane

| Lanes with changes | How |
|---|---|
| docs / specs only | scripted checks only. No model review at all |
| exactly one | inline, in this context. The common case |
| two or more | one subagent per lane, launched together |

Never load five skills into one context: `react-testing-library` alone is 603 lines and
`typescript-expert` 431 — they push out the diff you are reviewing.

Give each lane: its file list with statuses, `git diff "$BASE_SHA" -- <its paths>` (never the
whole diff), the paths of its skills, and the conventions file from the table above. Lanes may
`Read` any file in the repo for context — a finding in `routes.ts` usually needs `service.ts`
to judge. Findings are still restricted to diff lines by §6.

Return findings in the field names of the `Finding` contract
(`server/src/vendor/shared/contracts/findings.ts`): `severity`, `category`, `title`, `file`,
`start_line`, `end_line`, `rationale`, `suggestion`, `confidence`, plus `source`.

**When a lane is too big** — past ~400 changed lines, the threshold the product's own engine
uses to switch to map-reduce — split it by file. If it still does not fit, review the riskiest
files first and **state what was not covered**, in the report and in the artifact. Silent
truncation reads as "all clear", which is worse than no review.

Reuse a lane's findings when its slice is unchanged since the last run (`lanes[].slice_sha`).
Scripted checks always re-run; they are free.

## 5. Normalise severity onto the project's scale

Severity is exactly `CRITICAL | WARNING | SUGGESTION` — the enum at `findings.ts:11`. Skills
speak different dialects, and `docs/agent-prompts/README.md` warns that a foreign scale gets
mapped onto the enum inconsistently and inflates it.

**A vendored skill's finding starts at WARNING.** It reaches CRITICAL only when the diff shows
the mechanism.

| Source | Native | → | Promotion |
|---|---|---|---|
| react-best-practices | `CRITICAL` (Component Design, Derive Don't Store, Key Prop, Over-Engineering) | WARNING | only for behaviour visibly broken in the diff. **Never** for line count, prop count, or "premature abstraction" |
| react-best-practices | `HIGH` / `MEDIUM` | WARNING / SUGGESTION | — |
| security | `HIGH` **confidence** | WARNING | CRITICAL when attacker-controlled input reaches the sink *inside the diff* |
| security | `MEDIUM` / `LOW` confidence | WARNING / drop | LOW is not reported — the skill's own rule |
| zod | `impact: CRITICAL` | WARNING | CRITICAL when the schema is a request boundary and the change lets invalid input through |
| typescript-expert | `risk: critical` in frontmatter | — | **not a severity.** It labels the skill, not a finding |
| onion-architecture, frontend-architecture | none | WARNING | CRITICAL only via `check:arch` |
| fastify, next, postgresql, drizzle, RTL, mermaid | none | SUGGESTION | WARNING when it also breaks a stated convention |
| a scripted check | — | **as emitted** | the only automatic CRITICAL |
| a vocabulary not in this table | — | WARNING max | and emit a SUGGESTION that this table is stale |

**CRITICAL means one of three things.** A scripted check fired; or the change is reachable
from the diff and loses data, leaks a secret, crosses a workspace boundary, or bypasses auth;
or it cannot work — will not compile, will not boot, breaks a migration.

**Anti-inflation.** Anything phrased "might", "could", "if not already handled", "consider",
"potentially" is at most WARNING. Style, naming, file size, missing tests and over-engineering
are never CRITICAL. Only CRITICAL blocks, so three CRITICALs on a formatting change is a
broken review, not a thorough one.

## 6. Ground, dedupe, score, gate

**Ground.** A finding whose line range does not intersect a real hunk is **dropped, never
softened** — the same gate as `reviewer-core/src/grounding.ts`. Report it as `kept/total passed`.

**Findings whose `source` starts with `check:` are exempt.** Grounding exists to catch a model
citing a line it invented; a scripted check derived its line from the diff in the first place,
and a few are lane-level facts with no line to point at — "the architecture guard could not
run" is the important example. Dropping those would make the report say `pass` while the hook,
which re-runs the same checks, denies `gh pr create` with a reason the report never mentioned.

**Dedupe.** Lanes overlap on purpose. Key on file + overlapping range + title stem; keep the
higher severity and merge `source`.

**Score and gate**, mirroring `reviewer-core/src/output/to-review.ts:22-48`:

```
SEV_RANK         = { SUGGESTION: 1, WARNING: 2, CRITICAL: 3 }
FAIL_ON_MIN_RANK = { never: ∞, critical: 3, warning: 2, any: 1 }   # default: critical
blockers = count(f where SEV_RANK[f.severity] >= FAIL_ON_MIN_RANK[failOn])
gate     = blockers > 0 ? "fail" : "pass"
verdict  = no findings ? "approve" : blockers > 0 ? "request_changes" : "comment"
score    = clamp(100 - 35*CRITICAL - 12*WARNING - 3*SUGGESTION, 0, 100)
```

The gate is computed from severities, never from a verdict — `docs/architecture.md`,
invariant 5.

## 7. Write the verdict, then report

Write `.claude/pr-self-review/last-verdict.json` (gitignored). `diff_sha` comes from
`scripts/pr-self-review-hash.sh` — **never** recompute it inline; the gate recomputes it the
same way, and two recipes that disagree make the gate block everything or nothing.

```json
{
  "schema": 1,
  "diff_sha": "…", "base": "origin/main", "base_sha": "…", "dirty": false,
  "generated_at": "…Z", "fail_on": "critical",
  "counts": { "critical": 0, "warning": 2, "suggestion": 3 },
  "blockers": 0, "score": 67, "verdict": "comment", "gate": "pass",
  "coverage": "all changed files reviewed", "grounded": "5/7",
  "lanes": { "FRONTEND": { "slice_sha": "…", "findings": [] } },
  "override": null,
  "findings": []
}
```

`--override "<reason>"` re-runs the review, then records
`{"reason": …, "at": …, "blockers": N}`. A reason is mandatory. Because the override is stored
against this `diff_sha`, changing the code retires it.

Report shape:

```
PR Self Review — origin/main…HEAD · diff a1b2c3d4 · 14 files (3 skipped: generated)
Lanes: BACKEND(4 → onion-architecture, fastify-best-practices) · FRONTEND(8 → react-best-practices)
Grounding: 5/7 passed        Coverage: all changed files reviewed

CRITICAL (1)
  Contract changed without its mirror — server/src/vendor/shared/contracts/findings.ts:74
    <rationale>
    Fix: apply the same edit to client/src/vendor/shared/contracts/findings.ts

WARNING (2) …    SUGGESTION (3) …

Score 32/100 · verdict request_changes · blockers 1 (fail_on=critical)
GATE: FAIL — `gh pr create` is blocked for this diff.
```

**Zero findings is a good answer.** Report `approve`, score 100, one line, and stop. There is
no target count; padding the list corrupts the score and trains the author to ignore the gate.
