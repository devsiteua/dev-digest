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

export const BREAKING_CHANGE: SeedSkill = {
  name: 'breaking-change',
  description:
    'Apply when a diff touches a request schema, an exported signature or a schema over persisted data: reconstruct the old shape from the removed lines and report every difference that makes a working caller fail.',
  type: 'rubric',
  body: `# Breaking-change taxonomy

Reconstruct the OLD shape from the removed (\`-\`) lines and the NEW shape from the
added (\`+\`) lines, then classify every difference. Report only the breaking ones.

The response body has its own checklist — this one covers what goes IN (requests),
what other code IMPORTS (signatures), and what is already WRITTEN DOWN (stored data).

## 1. Request side — a call that was valid is now rejected
- A field is renamed, moved, or removed.
- An optional field becomes required, or loses its default so an omitted value no
  longer resolves.
- A type narrows: \`string\` → enum, \`number\` → integer, a union with a member
  removed, a new \`min\`/\`max\`/\`length\`/\`regex\`/\`url\` constraint on an existing field.
- The object stops accepting unknown keys (\`.passthrough()\` → \`.strict()\`).
- A path, method, or required header changes.

Narrowing what a service ACCEPTS is always breaking, even when every value the
service itself PRODUCES is inside the new, narrower set. The callers are the
population that matters, and you cannot see them.

## 2. Signature and export side — an importer no longer compiles
- An exported function gains a required parameter, or its parameters reorder.
- An exported type, interface member, enum member, or const is removed or renamed.
- A return type narrows, or a returned union loses a member.
- A default export becomes named, or a module's path changes.

## 3. Stored-data side — historical rows stop parsing
A schema over persisted JSON is also a READER of documents written months ago.
Breaking here fails at read time, on data nobody is currently sending:
- a required key is added, so old rows without it throw on parse;
- \`.nullish()\` is tightened to \`.nullable()\` or to a plain required field;
- a stored enum loses a member that existing rows still hold;
- a field's type changes under data already committed to the column.

## 4. The two-copy trap
A contract that exists in more than one file is broken when only one copy changes,
even though the edited copy is internally consistent. In this repository the Zod
contracts under \`vendor/shared\` are duplicated between the server and the web
client. If the diff edits one copy, check whether its counterpart is in the diff
too; if it is not, that is a breaking change that produces no error at all — the
two halves simply disagree about the shape until something explodes at runtime.

The same trap fires inside one tree: a shape re-declared inline in a second
contract file does not move when the exported one does.

### Breaking
\`\`\`ts
// vendor/shared/contracts/webhooks.ts — edited
export const EventName = z.enum(['invoice.paid', 'invoice.failed']);
// the client's copy of the same file still has:
// export const EventName = z.string();
\`\`\`

### Additive
\`\`\`ts
// both copies edited in the same diff, and the change only widens
export const EventName = z.union([z.enum(['invoice.paid']), z.string()]);
\`\`\`

## Additive — not a finding
A new optional field. A new endpoint. A widened accepted range. A relaxed
constraint. A new enum member on data the service PRODUCES.

## For every finding, state
1. the old shape and the new shape;
2. the concrete caller that breaks (a request body, an import, a stored row);
3. how it fails — 422, a type error, a parse failure on historical data.`,
};

export const RESPONSE_SCHEMA: SeedSkill = {
  name: 'response-schema',
  description:
    'Apply when a diff changes what an endpoint returns: check the response body, its field types, its success status code and its error shape against what callers were already reading.',
  type: 'rubric',
  body: `# Response schema compatibility

A response is a promise. Once a field has been returned, somebody is reading it,
and you cannot see who. Walk this list against every changed handler, return
statement, and response schema in the diff.

## 1. A field disappeared or was renamed
The most common break, and the one most often shipped as a cleanup. A caller
reading it gets \`undefined\` — no exception, no 4xx, just a blank in their UI or a
crash three call-frames later. Removing a field for a good reason (it leaked a
secret, it was redundant) does not make the removal compatible; it makes it a
removal that needs a deprecation window.

## 2. A field's type changed
\`string\` → \`number\`, an object → an array, a scalar → a wrapper object, an id that
was numeric now a uuid string. Anything a caller passes to \`.toFixed()\`,
\`.length\`, or a \`===\` comparison.

## 3. A non-nullable field became nullable
\`z.string()\` → \`z.string().nullable()\` is breaking even though the field still
exists, because every caller that dereferenced it without a guard now can. Same
for a required field becoming optional.

## 4. The success status code changed
\`200\` → \`201\`, \`200\` → \`204\`, or a redirect where a body used to be. Clients
that check \`res.status === 200\` treat the new code as a failure, and a \`204\` also
removes the body they were parsing.

## 5. The error shape or an error code changed
The error path is part of the contract too: the field names inside the error
object, the status a given failure maps to, the machine-readable \`code\`. A caller
switching on \`err.code\` breaks silently when a code is renamed.

## 6. Ordering and pagination
A list that changes its sort, its default page size, or its envelope
(\`items[]\` → \`{ data, cursor }\`) breaks readers even though every field survives.

### Good
\`\`\`ts
// The field is kept and marked, and the new one is added beside it.
return {
  id: sub.id,
  secret: sub.secret, // @deprecated — removed after 2026-12-01, use /secrets
  delivery_attempts: sub.deliveryAttempts,
};
\`\`\`

### Avoid
\`\`\`ts
// The field is dropped and the status changes in the same commit.
reply.status(201);
return { id: sub.id, events: sub.events, created_at: sub.createdAt };
\`\`\`

## For every finding, state
the field or code that changed, what a caller reading it now receives, and whether
the failure is loud (a rejected status check) or silent (an \`undefined\`).`,
};

export const SEMVER_DISCIPLINE: SeedSkill = {
  name: 'semver-discipline',
  description:
    'Apply when a diff changes a published shape: decide whether it requires a major bump, a minor, or a patch, and flag an incompatible change that ships with no version signal at all.',
  type: 'convention',
  body: `# Semver discipline

House convention. A shape that callers depend on carries a version, and the
version has to move when the shape does. Once you have classified a change, ask
the second question: **does the version say so?**

## MAJOR — required
Anything a caller must change code to survive:
- a field removed or renamed, in a request or a response;
- an optional request field made required, or a type narrowed;
- a success status code or an error code changed;
- an exported signature, type, or enum member removed or narrowed;
- a stored format tightened against rows already written.

## MINOR — enough
Strictly additive, and old callers keep working untouched:
- a new optional request field;
- a new field in a response (callers ignore unknown keys);
- a new endpoint, a new enum member on PRODUCED data, a widened accepted range;
- a new optional parameter with a default, appended last.

## PATCH — enough
No shape change at all: a bug fix, a performance change, a doc or comment edit,
an internal rename that no export can observe.

## When there is no bump in the diff at all
This is the common case here, and it is a finding, not an omission you can
overlook. A breaking change with no version signal reaches consumers as a routine
update — nothing in a lockfile, a changelog, or a CI gate distinguishes it from a
patch. Report it as the break it is, and say plainly which of the three it needed.

If the project has no version to bump (an internal service, a shared workspace
package), the equivalent signal is a versioned route (\`/v2/…\`), a feature flag, or
an accept-both transition period — say which one the change needs.

## Do not
- accept "it is a small change" or "nobody uses that field" as a reason to skip a
  major bump — neither is checkable from the diff;
- accept a major bump as a licence to break things without a migration note;
- flag a version bump that is LARGER than the change needs. That is safe.

### Good
\`\`\`
# 1.4.2 → 2.0.0
BREAKING: POST /webhooks/subscriptions returns 201 instead of 200 and no longer
returns \`secret\`. Callers reading it must call GET /subscriptions/:id/secret.
\`\`\`

### Avoid
\`\`\`
# 1.4.2 → 1.4.3
chore: harden subscription validation      # narrows an enum, drops a response field
\`\`\`

## For every finding, state
the classification (major / minor / patch), the specific change that forces it,
and what the diff currently signals instead.`,
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
  BREAKING_CHANGE,
  RESPONSE_SCHEMA,
  SEMVER_DISCIPLINE,
  NO_THEN_CHAINS,
];

/**
 * Which skills each seeded agent gets, in prompt order. `no-then-chains` is on
 * BOTH agents on purpose: one skill, two agents, edited in one place — the reuse
 * that the whole feature exists for.
 *
 * `deprecation-policy` is deliberately ABSENT: it ships as a markdown file in
 * `test/fixtures/skills/`, so the demo can walk the import path (Add skill →
 * Import file) and link it by hand. An imported skill arrives `enabled: false`
 * with `source: 'imported_file'`, which is also the only way to see the
 * untrusted-wrapping in a real prompt.
 *
 * NOTE: the linking loop in `seed.ts` skips an agent that already has ANY link,
 * so re-seeding a database that was seeded before this change will NOT attach the
 * three new contract skills. Attach them on the agent's Skills tab, or seed a
 * fresh volume.
 */
export const SEED_AGENT_SKILLS: Record<string, string[]> = {
  'Test Quality Reviewer': ['test-coverage-rubric', 'flaky-test-smells', 'no-then-chains'],
  'API Contract Reviewer': [
    'breaking-change',
    'response-schema',
    'semver-discipline',
    'no-then-chains',
  ],
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
