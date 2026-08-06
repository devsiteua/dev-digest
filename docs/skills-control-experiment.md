# The skills control experiment

How to show that a skill changes what an agent finds — by running the same agent
on the same diff twice, once with its skills detached and once with them attached.

This is a manual procedure, not a test. It makes real model calls, so it is
non-deterministic and it costs money; that is exactly why it lives here and not in
`e2e/`, where flows must stay LLM-free.

## Why the split between prompt and skill decides the outcome

An agent's `system_prompt` and its skills both end up in the same request. If the
concrete checks are written into the system prompt, the agent finds the defect with
its skills detached, and the experiment shows nothing.

So the seeded agents are deliberately built the other way round:

| In the **system prompt** | In the **skill** |
|---|---|
| "You review the tests in this diff" | Enumerate every branch the diff adds; find the one with no assertion |
| Severity rubric, anti-inflation rule | The boundary-value list to check: empty, null, `0`, the limit, the limit + 1 |
| Verdict mapping, findings discipline | The over-mocking and flakiness catalogues |
| "You review contract changes" | The request/signature/stored-data taxonomy, and the two-copy `vendor/shared` trap |
| "Would a working caller still work?" | The response-shape list, the semver classification, the deprecation mechanics |

Detached, the agent knows *which way to look*. Attached, it knows *what to look
for*. That difference is the demonstration.

## Setup

```sh
./scripts/dev.sh
cd server && pnpm db:migrate && pnpm db:seed
```

The seed creates both agents **disabled** — `Run all enabled agents` deliberately
does not pick them up — plus the two demo PRs and six skills. Run each agent by
name from the Run review dropdown; a named agent runs regardless of its flag.

A seventh skill, `deprecation-policy`, is **not** seeded: it ships as
`server/test/fixtures/skills/deprecation-policy.md` so that experiment 2 can walk
the import path. Add it with **Add skill → Import file**, then attach it on the
agent's Skills tab. It arrives `enabled: false` with `source: imported_file`, so
enable it before the run — and note that its body is `wrapUntrusted`-ed in the
prompt, which is visible in the trace and is the point of importing rather than
seeding one.

> **On a database seeded before the `api-contract-compat` split, re-seeding is not
> enough — two manual steps are needed.** `seed.ts` only ever inserts: the linking
> loop skips any agent that already has at least one link, and nothing deletes a
> skill that left `SEED_SKILLS`. So the old monolithic `api-contract-compat` row
> survives, still linked, and the three new skills arrive unattached.
>
> 1. On **API Contract Reviewer → Skills**, untick `api-contract-compat` and tick
>    `breaking-change`, `response-schema`, `semver-discipline`. Leaving both sets
>    attached puts the same checklist in the prompt twice.
> 2. Delete or disable `api-contract-compat` on `/skills` so it cannot be
>    re-attached by accident.
>
> Doing this on camera is worth more than a clean seed anyway. The alternative is a
> fresh volume — but do **not** reach for `docker compose down -v` to get one: it
> deletes `devdigest_pgdata` along with every imported repository and review.

Configure a provider key in Settings → API Keys first, or every run fails at
"Resolving provider".

## Experiment 1 — Test Quality Reviewer, PR #483

**The diff.** `dispatchWebhook` gains a retry loop: it retries up to
`sub.maxRetries`, honours a `Retry-After` header, and dead-letters the payload once
the budget is exhausted. The PR also adds a test — which asserts only that a
first-attempt success returns `delivered`, with the whole transport stubbed.

**What a skilled reviewer should notice**

- the dead-letter path (`deadLetter.push`) is never executed by any test;
- `Number(res.headers['retry-after'] ?? 0)` is attacker-controlled: a negative
  value produces a negative sleep, a huge one stalls the worker — no test covers
  either;
- `retryAfter * 1000 || BACKOFF_MS * 2 ** attempt` silently falls back for `0`;
- `vi.mock` replaces the entire transport, so nothing about status codes, headers
  or retry behaviour can be observed at all.

**Procedure**

1. Open `/agents` → **Test Quality Reviewer** → **Skills**.
2. Untick every skill, **Save skills**.
3. Open PR #483 → **Run review → Test Quality Reviewer**. Note the findings.
4. Back to the Skills tab: tick `test-coverage-rubric` and `flaky-test-smells`,
   **Save skills**.
5. Run the review again on PR #483 and compare.

## Experiment 2 — API Contract Reviewer, PR #484

**The diff.** Presented as security hygiene: tighten the subscription payload and
stop echoing the signing secret. Every change reads like an improvement.

**What a skilled reviewer should notice** — five separate breaks, and which skill
carries the checklist that catches each:

| The break in PR #484 | Caught by |
|---|---|
| `events: z.array(z.string())` → `z.array(EventName)` narrows an open string to a four-member enum, so any other event name a caller already sends now 422s | `breaking-change` § 1 (request side — "a type narrows: `string` → enum") |
| `secret: z.string().optional()` → `z.string().min(32)` makes an optional field required, so every existing caller that omits it now fails | `breaking-change` § 1 (optional becomes required, new `min` constraint) |
| the response drops `secret`, which callers were reading | `response-schema` § 1 (a field disappeared) — and `deprecation-policy`, which says the security motive changes the urgency, not the mechanics: blank or rotate it in place, remove it on a window |
| `200` → `201` breaks any client comparing the status exactly, and the diff carries no version signal at all | `semver-discipline` (major required, nothing in the diff says so) — `response-schema` § 4 also lists the status-code change itself |
| in the shared contract, `Subscription.secret` is replaced by `delivery_attempts` in only one of the two `vendor/shared` copies | `breaking-change` § 4 (the two-copy trap) |

The overlaps are deliberate: `response-schema` classifies the status change,
`semver-discipline` asks what the version says about it. A finding that both
produce is still ONE finding — the agent's prompt forbids duplicates.

**Procedure** — identical to experiment 1, with `breaking-change`,
`response-schema`, `semver-discipline` and the imported `deprecation-policy`.
Detaching all four is the "without" arm; the `no-then-chains` link can stay
attached in both arms, since PR #484 has no promise chains for it to fire on.

### Recorded result — 2026-08-07, PR #484

Both arms: **API Contract Reviewer**, `openrouter / deepseek/deepseek-v4-flash`,
same commit `c4e8a1b`, same verdict (`request changes`, PR score 0).

| | without skills | with the four skills |
|---|---|---|
| Prompt | no `## Skills / rules` section, `prompt_assembly.skills` is `null`; user message 2 511 chars | Skills block present, 10 958 chars / 2 644 tokens; user message 13 489 chars |
| Log | no `skills:` line at all | `skills: 4 skill(s), 2644 token(s) attached (breaking-change, response-schema, semver-discipline, deprecation-policy)` |
| Cost | 5 777 tok · $0.0008 | 8 083 tok · $0.0010 |
| Findings | 6 (5 critical, 1 warning) | 6 (5 critical, 1 warning) |

**The count is the same; the content is not.** Unarmed, the agent found the five
obvious shape changes — `secret` optional → required, `events` narrowed to an
enum, `secret` dropped from the response, `EventName` narrowed, `Subscription`
reshaped — plus the `200` → `201` status change. That is the expected outcome
(§ "If the unskilled run finds it anyway"): they are changes of commission,
visible in the diff text itself.

What only the skilled arm produced:

- **the two-copy `vendor/shared` trap** — "server and client will disagree",
  a finding with no counterpart in the unarmed run. It is a defect of *omission*:
  the diff shows one edited copy and says nothing about the other, so it is
  invisible unless the reviewer has been told to look. `breaking-change` § 4 is
  where that instruction lives;
- **the stored-data axis** — "old rows may lose data" — rather than reading the
  schema change as an API-shape change only (`breaking-change` § 3);
- **remedies in deprecation and semver terms**: every finding now asks for a
  major bump, a deprecation window, or a compatibility layer, and the summary
  names all three. Unarmed, the same finding ended at "communicate this change to
  consumers".

The unarmed run also spent one finding on the status code alone; armed, that
merged into the response-shape finding and the freed slot went to the two-copy
trap. So the demonstration is not "more findings" — it is **which** findings, and
the one that needed a checklist is the one the checklist produced.

Provenance is visible in the trace: the Skills block carries exactly one
`<untrusted source="skill:…">` wrapper, around `deprecation-policy` — the
imported skill. The three seeded ones speak directly. Nothing in either agent's
system prompt was changed between the arms.

## Reading the result

For each run: **View trace → Prompt assembly**.

- With skills detached there is no **Skills** block at all.
- With skills attached the block is there, carrying a token estimate; expand it and
  the bodies appear in exactly the order the Skills tab showed.
- The **log** tab has one line: `skills: 2 skill(s), 812 token(s) attached (…)`.

Then switch one skill off globally on `/skills` and re-run: the block shrinks by
one, and the log says how many linked skills were skipped. The links are untouched
— the master switch alone did it.

## If the unskilled run finds it anyway

Expected often enough to plan for. Fix the **diff**, not the agent:

- make the omission subtler (a rarer branch, a less conspicuous boundary);
- shorten the diff so there is less for the model to trip over by accident;
- prefer a defect of omission (a missing test, a silent narrowing) over one of
  commission (an obviously wrong line).

Do **not** respond by moving checks out of the skill into the system prompt, or by
weakening the system prompt below the standard in
`docs/agent-prompts/README.md`. Either would win the demonstration by rigging it.
