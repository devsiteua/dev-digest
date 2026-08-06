/**
 * Built-in skills, the agents that use them, and the two demo PRs they are meant
 * to be demonstrated on (L02).
 *
 * A skill carries the CHECKLIST; the agent's system prompt carries the role, the
 * severity rubric and the output discipline. That split is the whole point of the
 * feature — see `docs/agent-prompts/README.md` § "Skills / rules". It is also what
 * makes the control experiment meaningful: detach the skills and the agent still
 * knows what it is for, but no longer knows what specifically to look for.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: 'rubric' | 'convention' | 'security' | 'custom';
  body: string;
}

export const TEST_COVERAGE_RUBRIC: SeedSkill = {
  name: 'test-coverage-rubric',
  description:
    'Apply when a diff adds or changes tests: enumerate the branches and boundary inputs of the changed production code and check each one against an assertion.',
  type: 'rubric',
  body: `# Test coverage rubric

Work through this list against the production code changed in the diff. It is a
checklist, not a suggestion: name the specific item that fails.

## 1. Enumerate the branches
List every decision point the diff adds or changes — \`if\`, \`else\`, \`switch\` case,
ternary, \`??\`, \`||\`, early \`return\`, \`catch\`, loop-exhausted path. For each, find
the test that drives it.

A branch with no test is a finding. Cite the production line of the branch.
Pay particular attention to the paths that only run when something goes wrong:
the retry that runs out, the lookup that misses, the timeout, the rollback. These
are both the least likely to be tested and the most expensive when they break.

## 2. Enumerate the boundaries
For every new input, check the test suite for these values specifically:

- empty: \`[]\`, \`''\`, \`{}\`, a collection with zero rows
- absent: \`null\`, \`undefined\`, a missing optional field
- numeric edges: \`0\`, \`-1\`, \`1\`, the limit itself, the limit plus one
- large: a value big enough to change behaviour (pagination, truncation, timeout)
- duplicate / repeated calls, where the operation claims to be idempotent

A boundary that changes behaviour and has no test is a finding.

## 3. Check the assertion actually constrains
For each new test, ask: what single-character change to the production code would
still leave this test green? If the answer is "the behaviour under test", the
assertion is too weak. Specifically:

- calling the function and asserting only that it did not throw
- asserting on a mock's arguments instead of the code's output
- \`expect(result).toBeDefined()\` where the value matters
- snapshot assertions over data the test itself constructed

## 4. Check the test tests the code
An assertion that can only ever pass — because the value it checks was hard-coded
by a stub earlier in the same test — proves nothing. Trace each asserted value
back to where it came from.`,
};

export const FLAKY_TEST_SMELLS: SeedSkill = {
  name: 'flaky-test-smells',
  description:
    'Apply to test code to find non-determinism and over-mocking: real time, ordering assumptions, shared state, and doubles that replace the code under test.',
  type: 'custom',
  body: `# Flaky test smells

A test that fails once a fortnight teaches the team to re-run CI instead of
reading it. Flag these patterns in test code.

## Time and timing
- \`setTimeout\` / \`sleep\` used to "wait for" async work instead of awaiting it.
- Assertions on a duration, or on \`Date.now()\` without a frozen clock.
- A timeout tuned so the test passes on a fast laptop.

## Ordering and shared state
- A test that depends on a value another test in the file created.
- Module-level mutable state (a counter, a cache, a client) that is not reset.
- Reliance on object key order, array order from a query without \`ORDER BY\`, or
  the order of \`Promise.all\` side effects.
- A fixture written to a fixed path or a fixed database row id.

## Concurrency
- Parallel work asserted as if it were sequential.
- Missing \`await\` on the operation under test — the assertion then races it.

## Environment
- Reading an env var, the network, the real filesystem, or the system locale
  without controlling it.
- Randomness (\`Math.random\`, \`crypto.randomUUID\`) feeding an assertion.

## Over-mocking — the doubles that hollow out a test
Mocking is a tool for isolating I/O, not for making a test pass. Flag a double when:

- it replaces the module under test, or the function the test claims to verify;
- it returns exactly the value the test then asserts on (the assertion is circular);
- the whole transport is stubbed, so the test cannot observe protocol behaviour —
  status codes, headers, retries, error bodies;
- it is so detailed that changing the implementation's internal call order breaks
  the test without any behaviour changing.

State the consequence: which real regression would slip past this double?`,
};

export const API_CONTRACT_COMPAT: SeedSkill = {
  name: 'api-contract-compat',
  description:
    'Apply when a diff touches a route, an exported signature or a shared schema: compare the old and new shapes and classify each difference as additive or breaking.',
  type: 'rubric',
  body: `# API contract compatibility

Reconstruct the OLD shape from the removed (\`-\`) lines and the NEW shape from the
added (\`+\`) lines, then classify every difference. Report only the breaking ones.

## Breaking — a caller that worked now fails

### Request side
- A field is renamed, moved, or removed.
- An optional field becomes required.
- A type narrows: \`string\` → enum, \`number\` → integer, a widened union reduced,
  a new \`min\`/\`max\`/\`length\`/\`regex\` constraint on an existing field.
- A default is removed, so an omitted value no longer resolves.
- A path or method changes.

### Response side
- A field is removed or renamed.
- A field's type changes, or a non-nullable field becomes nullable.
- A success status code changes (200 → 201 breaks a client that checks \`=== 200\`).
- An error shape or code changes.

### Signature side
- An exported function gains a required parameter, or its parameters reorder.
- An exported type, enum member, or const is removed or renamed.
- A return type narrows.

### Stored-data side
- A schema over persisted JSON gains a required key, or a \`.nullish()\` field is
  tightened to \`.nullable()\` or made required. Rows written before the change do
  not carry the key and will now fail to parse.

## Additive — not a finding
A new optional field. A new endpoint. A widened accepted range. A new enum member
on data the service PRODUCES (but narrowing what it ACCEPTS is breaking).

## The two-copy trap
A contract that exists in more than one file is broken when only one copy changes,
even though the edited copy is internally consistent. In this repository the Zod
contracts under \`vendor/shared\` are duplicated between the server and the web
client. If the diff edits one copy, check whether its counterpart is also in the
diff; if it is not, that is a breaking change with no visible error.

## For every finding, state
1. the old shape and the new shape;
2. the concrete caller that breaks (a request body, an import, a stored row);
3. how it fails — 422, undefined at runtime, a type error, a parse failure on
   historical data.`,
};

export const NO_THEN_CHAINS: SeedSkill = {
  name: 'no-then-chains',
  description:
    'Apply to any changed application code: require async/await instead of .then()/.catch() promise chains, so errors propagate and control flow stays readable.',
  type: 'convention',
  body: `# No .then() chains

House convention. Application code uses \`async\`/\`await\`; \`.then()\` chains are not
accepted in new or modified code.

## Rule
Flag a new or modified \`.then(\` / \`.catch(\` / \`.finally(\` chain in application
code. Report it once per chain, not once per link.

## Why it is a defect and not a style preference
- A rejection in a chain that lacks \`.catch()\` becomes an unhandled rejection
  rather than a caught error.
- A value returned from inside \`.then()\` is easy to drop, producing a silent
  \`undefined\` instead of the result.
- Mixing \`await\` and \`.then()\` in one function makes the execution order genuinely
  ambiguous to a reader.

## Good
\`\`\`ts
const user = await db.users.find(id);
const posts = await db.posts.findMany({ userId: user.id });
\`\`\`

## Avoid
\`\`\`ts
db.users.find(id).then((user) => db.posts.findMany({ userId: user.id }));
\`\`\`

## Exceptions — do not flag these
- \`.catch(() => undefined)\` attached to a deliberately fire-and-forget call.
- A top-level bootstrap promise in an entry point.
- \`.finally()\` used purely for cleanup alongside \`await\`.`,
};

export const SEED_SKILLS: SeedSkill[] = [
  TEST_COVERAGE_RUBRIC,
  FLAKY_TEST_SMELLS,
  API_CONTRACT_COMPAT,
  NO_THEN_CHAINS,
];

/**
 * Which skills each seeded agent gets, in prompt order. `no-then-chains` is on
 * BOTH agents on purpose: one skill, two agents, edited in one place — the reuse
 * that the whole feature exists for.
 */
export const SEED_AGENT_SKILLS: Record<string, string[]> = {
  'Test Quality Reviewer': ['test-coverage-rubric', 'flaky-test-smells', 'no-then-chains'],
  'API Contract Reviewer': ['api-contract-compat', 'no-then-chains'],
};

// ---- Demo pull requests for the control experiment -------------------------
// Both carry real `pr_files.patch` text: `loadDiff` falls back to
// `diffFromPrFiles`, which SKIPS any file with a null patch, so a demo PR without
// patches would reach the model as an empty diff.
//
// Each diff is written so that a reviewer WITHOUT the skills can plausibly pass
// it — the production change looks reasonable, and the problems are of omission
// rather than of obvious wrongness.

export interface SeedPr {
  number: number;
  title: string;
  author: string;
  branch: string;
  headSha: string;
  body: string;
  files: { path: string; additions: number; deletions: number; patch: string }[];
}

/** Control experiment #1 — Test Quality. A retry path with a happy-path-only test. */
export const DEMO_PR_TEST_QUALITY: SeedPr = {
  number: 483,
  title: 'Retry webhook delivery with backoff before dead-lettering',
  author: 'tomek.w',
  branch: 'feat/webhook-retry-budget',
  headSha: 'b7c1d9e3f012',
  body: 'Webhook deliveries now retry with exponential backoff, honour Retry-After, and park the payload in the dead-letter queue once the budget is exhausted. Adds a test for the delivery path.',
  files: [
    {
      path: 'src/dispatch/webhook-dispatcher.ts',
      additions: 21,
      deletions: 2,
      patch: `@@ -14,8 +14,27 @@ export async function dispatchWebhook(
   const target = await loadTarget(sub.targetId);
   if (!target) return { status: 'skipped' as const, attempts: 0 };

-  const res = await post(target.url, payload);
-  return { status: res.ok ? ('delivered' as const) : ('failed' as const), attempts: 1 };
+  let attempt = 0;
+  let lastStatus = 0;
+
+  while (attempt <= sub.maxRetries) {
+    const res = await post(target.url, payload);
+    if (res.ok) return { status: 'delivered' as const, attempts: attempt + 1 };
+
+    lastStatus = res.status;
+    const retryAfter = Number(res.headers['retry-after'] ?? 0);
+    await sleep(retryAfter * 1000 || BACKOFF_MS * 2 ** attempt);
+    attempt++;
+  }
+
+  await deadLetter.push({
+    subscriptionId: sub.id,
+    payload,
+    lastStatus,
+    parkedAt: new Date().toISOString(),
+  });
+  return { status: 'dead_lettered' as const, attempts: attempt };
 }`,
    },
    {
      path: 'test/webhook-dispatcher.test.ts',
      additions: 16,
      deletions: 0,
      patch: `@@ -0,0 +1,16 @@
+import { describe, it, expect, vi } from 'vitest';
+import { dispatchWebhook } from '../src/dispatch/webhook-dispatcher';
+
+vi.mock('../src/dispatch/http', () => ({
+  post: async () => ({ ok: true, status: 200, headers: {} }),
+}));
+
+describe('dispatchWebhook', () => {
+  it('delivers the payload', async () => {
+    const result = await dispatchWebhook(
+      { id: 'sub_1', targetId: 'tgt_1', maxRetries: 3 },
+      { event: 'invoice.paid' },
+    );
+    expect(result.status).toBe('delivered');
+  });
+});`,
    },
  ],
};

/** Control experiment #2 — API Contract. Validation "hardening" that breaks callers. */
export const DEMO_PR_API_CONTRACT: SeedPr = {
  number: 484,
  title: 'Harden webhook subscription validation and stop echoing the secret',
  author: 'deepak.r',
  branch: 'chore/subscription-validation',
  headSha: 'c4e8a1b60d73',
  body: 'Tightens the subscription payload schema and removes the signing secret from the create response so it is never logged. Security hygiene follow-up.',
  files: [
    {
      path: 'src/api/webhooks/subscriptions.ts',
      additions: 9,
      deletions: 7,
      patch: `@@ -8,18 +8,20 @@ import { z } from 'zod';
 import { EventName } from '../../vendor/shared/contracts/webhooks.js';

 const CreateSubscriptionBody = z.object({
-  events: z.array(z.string()).min(1),
+  events: z.array(EventName).min(1),
   target_url: z.string().url(),
-  secret: z.string().optional(),
+  secret: z.string().min(32),
   description: z.string().optional(),
 });

 export default async function subscriptionRoutes(app: FastifyInstance) {
   app.post(
     '/webhooks/subscriptions',
     { schema: { body: CreateSubscriptionBody } },
-    async (req) => {
+    async (req, reply) => {
       const sub = await service.create(req.body);
-      return { id: sub.id, events: sub.events, secret: sub.secret, created_at: sub.createdAt };
+      reply.status(201);
+      return { id: sub.id, events: sub.events, created_at: sub.createdAt };
     },
   );
 }`,
    },
    {
      path: 'src/vendor/shared/contracts/webhooks.ts',
      additions: 8,
      deletions: 2,
      patch: `@@ -1,10 +1,16 @@
 import { z } from 'zod';

-export const EventName = z.string();
+export const EventName = z.enum([
+  'invoice.paid',
+  'invoice.failed',
+  'subscription.created',
+  'subscription.cancelled',
+]);
 export type EventName = z.infer<typeof EventName>;

 export const Subscription = z.object({
   id: z.string(),
   events: z.array(EventName),
-  secret: z.string().nullish(),
+  delivery_attempts: z.number().int(),
   created_at: z.string(),
 });`,
    },
  ],
};

export const SEED_DEMO_PRS: SeedPr[] = [DEMO_PR_TEST_QUALITY, DEMO_PR_API_CONTRACT];
