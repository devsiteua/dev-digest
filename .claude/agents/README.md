# Agents

Subagents available to Claude Code in this repository. Each one runs in its **own context
window**: it sees the `CLAUDE.md` hierarchy and its own file, but not this conversation, not
the files already read, and not the skills already invoked. Only its final report comes back.

That single fact shapes everything below — an agent that needs an input must be handed a
**path**, and an agent whose output matters must write a **file**, because a summary is all
that survives the trip home.

This file is a map. The rules themselves live in each agent's own file; do not restate them
here, and do not let this table become a second source of truth.

## Catalog

| Agent | Responsibility | Model | Invoked |
|---|---|---|---|
| [`implementation-planner`](implementation-planner.md) | Turns an approved spec into a Development Plan grounded in this repo's constraints | `opus` | **explicitly**, with a spec path |
| [`implementer`](implementer.md) | Executes an approved plan across `server/` and `client/` | `inherit` | **explicitly only** |
| [`researcher`](researcher.md) | Investigates and reports — repository, external docs, or both | `sonnet` | proactively, or "research X" |
| [`test-writer`](test-writer.md) | Writes tests as the deliverable, across `client/`, `server/` and `reviewer-core/` | `inherit` | **explicitly only** |
| [`architecture-reviewer`](architecture-reviewer.md) | Judges the design of code that exists, one axis in depth, read-only | `opus` | **explicitly only** |
| [`plan-verifier`](plan-verifier.md) | Checks finished code against a plan, item by item, with an evidence cell per item | `opus` | **explicitly only** |
| [`doc-writer`](doc-writer.md) | Turns a shipped feature into permanent documentation, with diagrams | `sonnet` | **explicitly only** |
| [`security-reviewer`](security-reviewer.md) | Traces attacker-controlled input to a sink, one surface in depth, read-only | `opus` | **explicitly only** |

`model: inherit` means the agent runs on whatever the session runs on, so its output quality
tracks the model you chose — `implementer` and `test-writer` both write code, so both take it.
`implementation-planner` is pinned to `opus` because planning is where reasoning buys the most;
`architecture-reviewer`, `plan-verifier` and `security-reviewer` are pinned there too,
because none of them produces code and all three fail by being lazy rather than by being
uninformed.

Only `researcher` is invited to run proactively. Everything that writes to the tree, and
every agent that returns a verdict someone might act on, is invoked by name — including
`implementation-planner`, which now needs a spec path and cannot usefully be guessed into.

## Permissions

`tools` is an allowlist. **Omitting it inherits every tool**, so every agent here lists its
tools explicitly — the absence of `Edit` from `implementation-planner` is a property of the
process, not a promise in prose.

| Agent | Has | Deliberately lacks | Why |
|---|---|---|---|
| `implementation-planner` | `Read` `Grep` `Glob` `Bash`* `Write` `Skill` `TodoWrite` | `Edit` | a planner that can edit code will edit code |
| | | `WebSearch` `WebFetch` | external facts are `researcher`'s job |
| `implementer` | `Read` `Edit` `Write` `Grep` `Glob` `Bash` `Skill` `TodoWrite` | `WebSearch` `WebFetch` | implementation does not browse; unknowns come back as questions |
| `researcher` | `Read` `Grep` `Glob` `Bash`* `WebSearch` `WebFetch` `TodoWrite` | `Write` `Edit` | reports never mutate the tree |
| `test-writer` | `Read` `Edit` `Write` `Grep` `Glob` `Bash` `Skill` `TodoWrite` | `WebSearch` `WebFetch` | same as `implementer`: unknowns come back as questions |
| `architecture-reviewer` | `Read` `Grep` `Glob` `Bash`* `Skill` `TodoWrite` | `Write` `Edit` | a reviewer that can write becomes the author it is reviewing |
| | | `WebSearch` `WebFetch` | external facts are `researcher`'s job |
| `plan-verifier` | `Read` `Grep` `Glob` `Bash`* `TodoWrite` | `Write` `Edit` | a verifier that fixes what it finds stops being a verifier |
| | | **`Skill`** | a loaded quality skill turns item-by-item verification into a general code review — the one failure mode that agent exists to prevent |
| `doc-writer` | `Read` `Grep` `Glob` `Bash`* `Write` `Edit` `Skill` `TodoWrite` | `WebSearch` `WebFetch` | it documents this repository, not the internet |
| `security-reviewer` | `Read` `Grep` `Glob` `Bash`* `Skill` `TodoWrite` | `Write` `Edit` | a reviewer that can write becomes the author it is reviewing |
| | | `WebSearch` `WebFetch` | a CVE or an advisory is `researcher`'s job; this agent reads code |

`Bash`* — read-only. **`tools` says which tools, never with which arguments**, so the tool
itself cannot be narrowed in the frontmatter. Argument-level control lives in
`.claude/settings.json` (`permissions.allow` / `deny`) and in `PreToolUse` hooks, and both
apply inside a subagent exactly as they do in the main session — which is why
`scripts/pr-self-review-gate.sh` still blocks `gh pr create` from inside `implementer`. If you
ever need to gate *which agents may run at all*, that is a permission rule too:
`Agent(implementation-planner)`, `Agent(implementer)`.

For the four read-only agents the asterisk is now a **boundary, not an instruction**.
`scripts/readonly-agent-guard.sh` is registered once, on `PreToolUse` / `Bash`, and filters by
agent itself: the hook payload carries `agent_type` on every event, so the script recognises
`architecture-reviewer`, `plan-verifier`, `researcher` and `security-reviewer` and exits 2 on
a redirection, `rm`,
`mv`, `sed -i`, `tee`, a `git` command that changes state, a package install, a `db:*` script
or `docker compose down`. Its allow/deny table is `server/test/readonly-agent-guard.test.ts`,
and it fails open with a message on stderr — a guard that silently blocks every shell is worse
than no guard.

Scoped per agent in the frontmatter would be narrower, and it is not available: the subagent
definition schema in Claude Code 2.1.240 carries `description`, `tools`, `disallowedTools`,
`prompt`, `model`, `mcpServers`, `skills`, `initialPrompt`, `maxTurns`, `background`, `memory`,
`effort`, `permissionMode`, `observer` and `observerMessage` — **no `hooks:` field**. (An
earlier version of this section claimed otherwise; it was checked against the installed CLI
and the claim did not hold.) `disallowedTools` does exist and is not used here, because every
agent already lists `tools` as an allowlist and a second, overlapping list would only give two
places to forget.

Prohibitions that are instruction-only, not tool-only (`implementer` must not commit, push,
or touch `client/src/vendor/ui/**` and `server/src/db/migrations/**`) are written into the
agent file because no tool boundary expresses them.

## Artifacts in and out

| Agent | Takes | Produces on disk | Returns to the caller |
|---|---|---|---|
| `implementation-planner` | **a path to a spec file** | one plan file: `specs/plans/<slug>.md`, or `<pkg>/specs/plans/<slug>.md` for single-package work, carrying `Requirements review` · `Constraints in force` · `Implementation plan` · `Coverage` · `Commit plan` · `Handoff` · `Recommendations` | plan path, step count, coverage of the spec's criteria, skills the implementer will need, risks, blocking questions |
| `implementer` | **a path to a plan file** + which steps to run | the code changes themselves | changes table, every command with its real output, deviations, blocked steps, what was not checked, insight candidates |
| `researcher` | a concrete question | nothing | a fixed-template report: conclusion, evidence with `file:line` or URL, and an explicit "Not found" |
| `test-writer` | what to cover, and the regression the test must catch | test files, fixtures and test helpers — nothing else | files table, every command with its real output and test count, what is deliberately not covered, whether production code stayed untouched |
| `architecture-reviewer` | **a scope that resolves to a file list** — a diff, paths, or a package | nothing | findings with a severity and a `file:line` each, pre-existing debt kept separate, `Checked and clean`, `Not checked` |
| `plan-verifier` | **a path to a plan file** + what counts as the finished code | nothing | `Items extracted: N` and a table with exactly N rows, each `MET`/`PARTIAL`/`NOT MET`/`NOT VERIFIED` with evidence, plus scope creep and out-of-scope sweeps |
| `doc-writer` | the subject, its source material, and who will read it | markdown at the addresses in `docs/README.md`, plus its pointer lines | routing decision, every claim with the `file:line` that verified it, diagrams and why each earned its place, contradictions found |
| `security-reviewer` | **a scope that resolves to a file list** — a diff, paths, a package, or a named surface | nothing | findings that each name a source, a sink and the `file:line` between them, `Checked and clean` with what made it safe, `Not checked`, assumptions |

```
task ─► implementation-planner ─► specs/plans/<slug>.md ─► implementer ─► code + report
                         │                                │
                         │       ┌────────────────────────┤
                         │       ├─► test-writer           ─► tests + report
                         │       ├─► architecture-reviewer ─► findings
                         └───────┼─► plan-verifier         ─► N items, N verdicts
                                 ├─► doc-writer            ─► docs/ + pointers
                                 ├─► security-reviewer     ─► findings
                                 │
                                 └─  /pr-self-review       a skill, not an agent
```

`plan-verifier` is drawn from both ends because it takes two inputs: the plan `implementation-planner` wrote
and the code `implementer` produced. Nothing in this picture spawns anything else in it.

## What is deliberately not here

- **No agent for a whole-diff pre-PR verdict.** `/pr-self-review` is the gate, and it routes
  a diff across every lane at once. `architecture-reviewer` and `security-reviewer` exist for
  the opposite shape: one axis, one surface, in depth, on a scope you name. Neither replaces
  the gate, and the gate does not replace either.
- **Review skills are not agents.** `/pr-self-review` (this repo) and `/code-review`
  (built-in) stay skills; `implementer` runs neither, because an implementer that reviews
  itself produces a green that hides findings.
- **`engineering-insights` is nobody's subagent.** `implementer` returns insight *candidates*;
  the main session records them. Two agents appending to one `INSIGHTS.md` is a conflict
  waiting to happen.
- **No agent chains further.** None of the eight can spawn another.

## Where these agents' rules come from

External, official — read 2026-08-21:

| Source | What it settled here |
|---|---|
| [Subagents](https://code.claude.com/docs/en/sub-agents) | frontmatter contract (`name` + `description` required, `tools` inherits when omitted); `description` is what drives delegation; a subagent inherits `CLAUDE.md` but not conversation history; **only a summary returns** |
| [Permissions](https://code.claude.com/docs/en/permissions) | `tools` vs argument-level Bash rules; `Agent(Name)` as a permission rule |
| [Best practices](https://code.claude.com/docs/en/best-practices) | `Explore → Plan → Implement → Commit`; **plan as a file** checked by a separate reviewer subagent; a read-only reviewer scoped to `Read, Grep, Glob, Bash` |
| [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | every subagent needs an objective, an output format, tool guidance and **clear task boundaries**; named anti-patterns: overlapping responsibilities, over-spawning, endless exploration |
| [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | a subagent returns ~1–2k condensed tokens — the reason a plan cannot travel as prose |
| [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) | progressive disclosure: descriptions first, bodies on demand — why skills are invoked per step rather than preloaded |

Internal, this repository:

| Source | What it settled here |
|---|---|
| root `CLAUDE.md` § Session protocol | both agents read `INSIGHTS.md` before code, and the wrap-up belongs to the session |
| `.claude/skills/pr-self-review/SKILL.md` §3 | the canonical path → skills routing table. Both agents **point at it**; neither copies it |
| `specs/README.md`, `specs/TEMPLATE.md` | where a plan lives, its sections, and why `Out of scope` carries the most weight |
| `docs/agent-prompts/README.md` § Skills / rules | a rule copied between two prompts wanted to be a skill — the reason the routing table is single-sourced |
| `INSIGHTS.md` 2026-08-21 entry | the routing table's location, and the three implementation-time deltas to it |
| `docs/README.md` | the index `doc-writer` routes by, so the routing table is not copied into an agent file |
| `TESTING.md` § Suite map, § Conventions | the four lanes `test-writer` chooses between, and the `*.it.test.ts` split |
| `docs/architecture.md` § "The five invariants" · § Tenancy | the axes `architecture-reviewer` walks |
| `server/INSIGHTS.md` 2026-08-06 | `arch:check` exits 0 on a `warn` — why the reviewer reads output, not exit codes |
| `specs/README.md` rule 3 | why `plan-verifier` sweeps `Out of scope` as a negative check |

**One thing the sources do not settle.** Whether splitting `implementation-planner → implementer` is itself
an anti-pattern is genuinely open: one community writeup calls role-based handoff a
"telephone game", another recommends exactly this pipeline, and no official Anthropic page
says either. The design takes the split and pays for it with two guards — the plan is a file
rather than a retelling, and `implementer` must **stop and report** on any divergence instead
of re-planning. If the telephone effect shows up anyway, it will show up as deviation reports,
which is the point of that section.

## Adding an agent

1. `name` + `description` are the only required fields — but list `tools` anyway.
2. Write the `description` for the router, not for a human: what it does, when to use it, and
   the trigger terms (English and Ukrainian, as every agent here does). "Use proactively" is
   an invitation — leave it out for anything that writes to the tree.
3. Give it a **fixed output template** where every section stays even when empty. An empty
   "Not found" is a claim; an omitted one is a gap.
4. Point at existing rules; never restate a skill or a `CLAUDE.md` convention inline.
5. Say what the agent does **not** cover, and who does.
