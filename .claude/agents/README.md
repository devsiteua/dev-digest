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
| [`planner`](planner.md) | Turns a task into a Development Plan grounded in this repo's constraints | `opus` | proactively, or "plan X" |
| [`implementer`](implementer.md) | Executes an approved plan across `server/` and `client/` | `inherit` | **explicitly only** |
| [`researcher`](researcher.md) | Investigates and reports — repository, external docs, or both | `sonnet` | proactively, or "research X" |

`model: inherit` means the implementer runs on whatever the session runs on, so
implementation quality tracks the model you chose. `planner` is pinned to `opus` because
planning is where reasoning buys the most.

## Permissions

`tools` is an allowlist. **Omitting it inherits every tool**, so every agent here lists its
tools explicitly — the absence of `Edit` from `planner` is a property of the process, not a
promise in prose.

| Agent | Has | Deliberately lacks | Why |
|---|---|---|---|
| `planner` | `Read` `Grep` `Glob` `Bash`* `Write` `Skill` `TodoWrite` | `Edit` | a planner that can edit code will edit code |
| | | `WebSearch` `WebFetch` | external facts are `researcher`'s job |
| `implementer` | `Read` `Edit` `Write` `Grep` `Glob` `Bash` `Skill` `TodoWrite` | `WebSearch` `WebFetch` | implementation does not browse; unknowns come back as questions |
| `researcher` | `Read` `Grep` `Glob` `Bash`* `WebSearch` `WebFetch` `TodoWrite` | `Write` `Edit` | reports never mutate the tree |

`Bash`* — read-only by instruction (`cat`, `grep`, `git log`, `git show`). The tool itself
cannot be narrowed per agent: **`tools` says which tools, never with which arguments.**
Argument-level control lives in `.claude/settings.json` (`permissions.allow` / `deny`) and in
`PreToolUse` hooks, and both apply inside a subagent exactly as they do in the main session —
which is why `scripts/pr-self-review-gate.sh` still blocks `gh pr create` from inside
`implementer`. If you ever need to gate *which agents may run at all*, that is a permission
rule too: `Agent(planner)`, `Agent(implementer)`.

Prohibitions that are instruction-only, not tool-only (`implementer` must not commit, push,
or touch `client/src/vendor/ui/**` and `server/src/db/migrations/**`) are written into the
agent file because no tool boundary expresses them.

## Artifacts in and out

| Agent | Takes | Produces on disk | Returns to the caller |
|---|---|---|---|
| `planner` | a task, plus the packages it touches | one plan file: `specs/<slug>.md`, or `<pkg>/specs/<slug>.md` for single-package work, following `specs/TEMPLATE.md` plus `Constraints in force` · `Implementation plan` · `Handoff` | path, step count, skills the implementer will need, risks, blocking questions |
| `implementer` | **a path to a plan file** + which steps to run | the code changes themselves | changes table, every command with its real output, deviations, blocked steps, what was not checked, insight candidates |
| `researcher` | a concrete question | nothing | a fixed-template report: conclusion, evidence with `file:line` or URL, and an explicit "Not found" |

```
task ─► planner ─► specs/<slug>.md ─► implementer ─► code + report
                                          │
                                          ├─ architecture review   ─┐
                                          ├─ security review        ├─ not this agent's job
                                          └─ /pr-self-review        ─┘
```

## What is deliberately not here

- **No architecture or security review agent yet.** `implementer` names both as out of scope
  in every report, so the gap is visible rather than silently filled by the agent that wrote
  the code.
- **Review skills are not agents.** `/pr-self-review` (this repo) and `/code-review`
  (built-in) stay skills; `implementer` runs neither, because an implementer that reviews
  itself produces a green that hides findings.
- **`engineering-insights` is nobody's subagent.** `implementer` returns insight *candidates*;
  the main session records them. Two agents appending to one `INSIGHTS.md` is a conflict
  waiting to happen.
- **No agent chains further.** None of the three can spawn another.

## Where planner's and implementer's rules come from

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

**One thing the sources do not settle.** Whether splitting `planner → implementer` is itself
an anti-pattern is genuinely open: one community writeup calls role-based handoff a
"telephone game", another recommends exactly this pipeline, and no official Anthropic page
says either. The design takes the split and pays for it with two guards — the plan is a file
rather than a retelling, and `implementer` must **stop and report** on any divergence instead
of re-planning. If the telephone effect shows up anyway, it will show up as deviation reports,
which is the point of that section.

## Adding an agent

1. `name` + `description` are the only required fields — but list `tools` anyway.
2. Write the `description` for the router, not for a human: what it does, when to use it, and
   the trigger terms (English and Ukrainian, as the existing three do). "Use proactively" is
   an invitation — leave it out for anything that writes to the tree.
3. Give it a **fixed output template** where every section stays even when empty. An empty
   "Not found" is a claim; an omitted one is a gap.
4. Point at existing rules; never restate a skill or a `CLAUDE.md` convention inline.
5. Say what the agent does **not** cover, and who does.
