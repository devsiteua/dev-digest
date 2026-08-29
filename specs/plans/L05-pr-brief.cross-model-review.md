# Cross-model review — `specs/plans/L05-pr-brief.md`

Reviews the L05 PR Brief implementation plan with a model from a **different family** from the
one that wrote it, before any of the plan was executed.

| | |
|---|---|
| Plan reviewed | [`L05-pr-brief.md`](L05-pr-brief.md) |
| Spec behind it | [`../L05-pr-brief.md`](../L05-pr-brief.md), 41 criteria |
| Plan written by | Claude Opus 5 (Anthropic) via `implementation-planner` |
| Reviewed by | **`openai/gpt-5.1-codex-max`** (OpenAI) via OpenRouter |
| Rounds | 5, same reviewer and same prompt each time |
| Input | the full spec + the full plan, `temperature: 0` |
| Cost | **$0.4059** total · 186 027 tokens in, 24 567 out |

Each round ran over the plan the **previous round had corrected**, so every round first
confirmed the last fix and only then looked for something new. The reasoning behind each fix
lives in the plan's own `### Defects in this plan, found by cross-model review`; this file is
the short record of what was found, what it cost, and what was done about it.

## What it found

| Round | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | BLOCKER | `read()` hashed the **untrimmed** input while `generate()` hashed the trimmed one. Every brief large enough to fire one rung of the budget ladder would read `stale` forever, however many times it was regenerated. | **Fixed.** `assemble → trim → hash` became one function, `briefStateOf`, which is the only way to obtain a `state_key`; a `grep -c` for it returning anything but 2 is a failure. |
| 2 | MAJOR | The 8 000-token budget was never stated to include the system prompt. A test counting the user string alone would pass while `system + user` exceeded the ceiling. | **Fixed.** The ladder takes `system` as a parameter and re-counts `count(system + user)` as one call — never `count(system) + count(user)`, which differs because BPE merges across the join. A fixture where the two numbers differ makes it falsifiable. |
| 3 | BLOCKER | The card was specified to call the page's `openFile`, but `page.tsx` appeared in no step that could hand it down. The card would have called a prop nobody gives it. | **Fixed.** The whole chain landed in Step 9, and the prop is **required**, not optional like the neighbouring `onOpenFinding?:` — so a broken thread is a `typecheck` failure rather than a dead button. |
| 4 | MAJOR | Coverage named fewer test lanes than the spec's own `How it is checked` column. | **Fixed, and swept.** All 41 criteria were re-checked lane by lane: **three** disagreements, not one — AC-15, AC-39 and AC-32. `§ Coverage` now carries per-lane checking as a standing rule. |
| 5 | MAJOR | AC-13 obliges a budget drop to reach **both** the route log and the stored `trimmed` field; only the second was verified anywhere. | **Fixed.** Step 6 asserts the log line too, using the collector `intent.it.test.ts:430-435` already establishes. |
| 5 | MINOR | Claimed the `GET` half of the rate-limit rule had no coverage. | **Rejected.** AC-26 names a *route review* as that half's check, and an eleven-`GET` test would assert the absence of a limit by failing to trip it. **But checking it found a real gap the reviewer had not named:** nothing verified the `GET` carries no override, so a `grep -c "rateLimit"` → 1 was added. |

## Three classes, in the order they surfaced

| Rounds | Class | Why the plan's own gates could not catch it |
|---|---|---|
| 1–3 | an instruction that reads correctly and **cannot be executed** | every gate the plan specifies was written by the same author as the defect, and prose compiles for nobody |
| 4 | a gate the plan and all its own checks agree is present, and the spec says is missing | coverage was checked per *criterion*, never per *lane* |
| 5 | a criterion whose own verification is weaker than its obligation | round 4's sweep compares the plan against `How it is checked`, so a thin cell passes it |

## Why the loop stopped at five

Not because a round came back clean — because of the trend. Severity fell monotonically
(BLOCKER, BLOCKER, MAJOR, MAJOR, MINOR), each round's class was narrower than the last, and
round 5's only genuinely new gap was found by **disagreeing** with the reviewer rather than by
following it. A sixth round would have been looking for a fourth class with the third class's
instrument.

The remaining defects are cheaper to find in code than in prose, and that is what
`implementer`, `architecture-reviewer` and `plan-verifier` are for — unlike this reviewer, they
read the code rather than the description of it.

## What this bought

Two BLOCKERs that would have reached the implementer **as instructions**, and both invisible to
every gate we would otherwise have run. Round 1's in particular: the demo PR has nine changed
files against a `BRIEF_TRIM_MAX_FILES` of 12, so no rung binds, the trim is a no-op, the hashes
agree, and the e2e flow and the integration lane both pass. It would have failed only on a
large real pull request — which is to say, only in front of a user.

## Reproducing it

The reviewer was called directly over OpenRouter with the spec and the plan as one user
message, `temperature: 0`, and a system prompt asking for ordering errors, nominally-covered
criteria, unfalsifiable claims, hidden coupling between commits, and missing work — with an
explicit instruction to report nothing at a severity rather than invent something to fill a
section. No repository access, no tools: it saw exactly the two documents a human reviewer
would be handed.
