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
