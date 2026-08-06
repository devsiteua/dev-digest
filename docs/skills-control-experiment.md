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
| "You review contract changes" | The breaking-change taxonomy, and the two-copy `vendor/shared` trap |

Detached, the agent knows *which way to look*. Attached, it knows *what to look
for*. That difference is the demonstration.

## Setup

```sh
./scripts/dev.sh
cd server && pnpm db:migrate && pnpm db:seed
```

The seed creates both agents **disabled** — `Run all enabled agents` deliberately
does not pick them up — plus the two demo PRs and the four skills. Run each agent
by name from the Run review dropdown; a named agent runs regardless of its flag.

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

**What a skilled reviewer should notice** — four separate breaks:

- `events: z.array(z.string())` → `z.array(EventName)` narrows an open string to a
  four-member enum, so any other event name a caller already sends now 422s;
- `secret: z.string().optional()` → `z.string().min(32)` makes an optional field
  required, so every existing caller that omits it now fails;
- the response drops `secret`, which callers were reading;
- `200` → `201` breaks any client comparing the status exactly;
- and in the shared contract, `Subscription.secret` is replaced by
  `delivery_attempts` in only one of the two `vendor/shared` copies.

**Procedure** — identical to experiment 1, with `api-contract-compat`.

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
