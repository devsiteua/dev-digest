# Retro ledger — what each pipeline run cost

One entry per multi-agent run, appended by `/workflow-retro` and by nothing else. Newest
last. Entries are **never rewritten**: the whole value of this file is that run seven can be
compared with run three, and a file that tidies its own history cannot do that.

**Not `INSIGHTS.md`.** That journal records what we learned about the *code*; this one records
what we learned about the *run* — which agents, in which order, at what cost. A lesson about
Drizzle belongs there. A lesson about `implementer` re-reading the same six files in every
context belongs here.

**Not a dashboard.** It is a markdown file. Nothing parses it, nothing charts it, and no
number in it is authoritative beyond what the entry itself says it measured.

## Entry template

```markdown
## <YYYY-MM-DD> — <feature in one line>

**Plan:** `specs/plans/<slug>.md` · **Spec:** `specs/<slug>.md` · **Mode:** default | deep
**Agents:** N launched — `a → b → a → c`
**Tokens:** <total> · <per agent, largest first> · cache reads <n>, counted separately

- **Easy:** <the stages that needed no correction>
- **Hard:** <every place a human intervened, a step went red, an iteration was spent>
- **Duplicated:** <the same file, convention or finding paid for twice, with the number>
- **Missed:** <what the run should have caught and did not, and who caught it instead>

**Proposals**
1. <change> → `<path/to/file.md>` § <section>
   Because: <the measurement above>   Costs: <what gets worse>
```

Any field that was not measured is written `not measured`. An estimate written as a number is
worse than a gap, because the next entry will be compared against it.

## Entries

_None yet. The first run of the pipeline writes the first one._

## 2026-08-29 — Project Context Folder: the pipeline's first real run

**Plan:** `specs/plans/L05-project-context-folder.md` · **Spec:** `specs/L05-project-context-folder.md` · **Mode:** deep
**Agents:** 5 distinct, 8 launches — `spec-creator → spec-creator → implementation-planner → implementer ⟂ → implementation-planner → implementer → architecture-reviewer → plan-verifier` (`⟂` = stopped on a red gate)
**Tokens:** subagents 3,209,346 fresh in · 166,089 out · **88,414,308 cache reads, counted separately** · 666 turns.
Main session 628,629 fresh · 297,043 out · 48,069,690 cache reads · 231 turns. Wall clock ≈ 61 min of agent time, 450 tool calls.

| Agent | Model (measured) | Fresh in | Out | Cache reads | Turns |
|---|---|---|---|---|---|
| `implementer` (2 launches) | `claude-opus-5` | 921,869 | 72,582 | **58,381,013** | 309 |
| `implementation-planner` (2) | `claude-opus-5` | 886,436 | 45,582 | 8,203,894 | 96 |
| `plan-verifier` | **`claude-sonnet-5`** | 543,369 | 22,512 | 9,992,531 | 110 |
| `spec-creator` (2) | `claude-opus-5` | 444,813 | 11,638 | 3,058,941 | 57 |
| `architecture-reviewer` | **`claude-sonnet-5`** | 412,859 | 13,775 | 8,777,929 | 94 |

`implementer` is 66% of all subagent cache reads on its own: one context carried a 489-line plan, both packages and 309 turns, and re-read all of it every turn. That single number is what the first proposal addresses.

**AC-23 is proven, not assumed.** `message.model` says `claude-sonnet-5` on all 204 reviewer and verifier turns, while their own files still read `model: opus`. The call-site override works.

- **Easy:** `spec-creator`'s blocking round paid for itself — 26 criteria written once, none rewritten, `0 NOT MET` at verification. The architecture review returned **0 CRITICAL**, so the two-iteration fix budget was never touched.
- **Hard:** the plan shipped a gate it could not satisfy. Step 2 asserted a green `typecheck` over one file Step 4 owns and three files **no step owned**, which cost a full `implementer` launch that ended in a stop, plus a second planner launch to repair. A human intervened four times, all at designed gates.
- **Duplicated:** `reviewer-core/src/prompt.ts` and the `wrapUntrusted` question were independently investigated by **four** contexts — spec-creator wrote § Untrusted inputs, the planner re-derived it in Requirements review, the implementer deviated over it, the reviewer judged it. Each paid full freight; only the last had the other three's conclusions.
- **Missed:** the pre-existing `skills.it.test.ts:780` flake (≈2 runs in 9) — every agent that ran the lane ran it **once** and reported green. Found only because the main session ran it nine times. Also missed by everyone but the repair pass: `AgentVersionConfig.project_context` bare would have 500'd `GET /agents/:id/versions` on any database with history; no AC covered it and no test could see it.

**Proposals**

1. Let a plan declare its own implementer seams → `.claude/skills/implement/SKILL.md` § Run the plan, and `.claude/agents/implementation-planner.md` § Handoff.
   Because: 58,381,013 cache reads and 309 turns in one context; `--steps` exists and went unused because nothing tells the caller where to cut. A plan-declared seam (here: server done at Step 5) would have made two smaller contexts.
   Costs: contradicts § Run the plan's current "launch `implementer` once" rule, and two contexts rediscover the repository — the seam must be earned by the plan, not imposed by the skill.
2. Move `Gate discipline` from this plan into the agent that writes plans → `.claude/agents/implementation-planner.md`.
   Because: one unsatisfiable gate cost a whole `implementer` launch. The planner already wrote the wording and asked for it to be routed; it is currently a section in one plan file, so the next plan will not have it.
   Costs: a longer agent file, and a producer sweep per contract-editing step that most steps will not need.
3. Fix `deep` mode's source of truth → `.claude/skills/workflow-retro/SKILL.md` § Modes.
   Because: § Modes says subagent turns carry `isSidechain: true` in `~/.claude/projects/<slug>/*.jsonl`. This run's transcript has **zero** sidechain turns; every number in this entry came from the task output files instead. The documented path measures nothing.
   Costs: the replacement path is harness-internal and may move without notice — the skill would be documenting an implementation detail.
4. Make a revised plan update its own state block, or forbid the block → `.claude/agents/implementation-planner.md` § Step 6.
   Because: `plan-verifier` found the plan still saying "Steps 3–9 are untouched" after all nine shipped. The `Covers:` table stayed true; the prose did not.
   Costs: one more thing to keep in sync, which is the same class of problem it fixes.
5. Run the integration lane more than once before calling it green → `.claude/skills/implement/SKILL.md` § Verification.
   Because: a ≈22% flake read as a pass in every single-run report this session.
   Costs: the lane takes ~11s per run and starts 14 Postgres containers; three runs is 35s added to every `/implement`.
