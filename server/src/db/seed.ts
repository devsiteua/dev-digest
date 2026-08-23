import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_AGENT_SKILLS, SEED_DEMO_PRS, SEED_SKILLS } from './seed-skills.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with four findings (2 CRITICAL / 1 WARNING / 1 SUGGESTION — one per severity,
 * so the findings counters have something to show), a settled agent_run for that
 * review, and the three built-in agents (General + Security + Performance), all
 * on the default openrouter/deepseek-v4-flash provider+model.
 *
 * L03 adds: PR #482's full nine-file diff with real `patch` text, so the Smart
 * Diff has a PR whose files can be grouped and whose findings can be jumped to.
 *
 * L02 adds: four built-in skills, the two agents that use them (Test Quality and
 * API Contract, seeded DISABLED — see below), and PRs #483/#484 as the fixtures
 * for the with-skills / without-skills comparison.
 *
 * Course lessons populate the remaining tables (conventions, memory, eval, …)
 * once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

/**
 * The nine changed files of demo PR #482 — the `pr-files` artboard of the
 * product design, seeded so the Smart Diff (L03) has a PR worth ordering: three
 * files of real logic, four of wiring, two a reviewer should skim.
 *
 * The `patch` text is what makes the demo more than a file list. Its hunk
 * headers are chosen so that every seeded finding line — `src/config.ts:12`,
 * `webhooks.ts:61`, `users.ts:45`, `ratelimit.ts:28` — falls inside a RENDERED
 * line, which is what lets a findings badge scroll the reader to the offending
 * code. Move a hunk header and the badge silently lands on the file header
 * instead.
 *
 * Two things are deliberate rather than sloppy:
 *  - `additions`/`deletions` are the design's numbers and are NOT recomputed
 *    from the patch; a real GitHub patch is often an excerpt of a larger change
 *    and nothing in this codebase derives one from the other.
 *  - the lock file carries no patch at all. That is the case the design draws as
 *    "Mechanical changes — diff collapsed by default", and 92 lines of resolved
 *    dependency ranges would teach a reader of the demo nothing.
 *
 * The Stripe key on `config.ts:12` is a REDACTED placeholder, not a key-shaped
 * string. The design mock uses a realistic-looking live-key literal, and this
 * repository's own pre-PR gate (`scripts/pr-self-review-checks.sh`,
 * `check:secret-literal`) rejects that prefix wherever it appears — demo data
 * and comments included, which is the correct behaviour and not something to
 * sneak past with a lookalike. The finding above the line reads the same either
 * way: what makes it a defect is that the value is IN the file.
 */
const PR_482_FILES: Array<{
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}> = [
  {
    path: 'src/middleware/ratelimit.ts',
    additions: 84,
    deletions: 0,
    patch: `@@ -0,0 +1,84 @@
+import type { Request, Response, NextFunction } from 'express';
+import { redis } from '../lib/redis';
+import { logger } from '../lib/logger';
+import { metrics } from '../lib/metrics';
+
+/**
+ * Token-bucket rate limiter for the public API.
+ * Anonymous callers are bucketed by IP and authenticated ones by account id,
+ * so one office behind a NAT cannot exhaust a customer's whole budget.
+ */
+
+type Req = Request & { accountId?: string };
+type Res = Response;
+type Next = NextFunction;
+
+const ANON_LIMIT = 60;
+const ACCOUNT_LIMIT = 600;
+
+function bucketKey(req: Req): string {
+  const who = req.accountId ?? req.ip;
+  const window = Math.floor(Date.now() / 1000 / 3600);
+  return \`rl:\${who}:\${window}\`;
+}
+
+export async function rateLimit(req: Req, res: Res, next: Next) {
+  const key = bucketKey(req);
+  const count = await redis.incr(key);
+  if (count === 1) await redis.expire(key, 3600);
+
+  if (count > limitFor(req)) {
+    const retryAfter = await redis.ttl(key);
+    res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
+    res.setHeader('X-RateLimit-Limit', String(limitFor(req)));
+    res.setHeader('X-RateLimit-Remaining', '0');
+
+    // A blocked request is still a request the operator wants to see:
+    // without this line the only symptom of a limit set too low is a
+    // support ticket three days later.
+    logger.warn(
+      {
+        key,
+        count,
+        limit: limitFor(req),
+        accountId: req.accountId ?? null,
+        path: req.path,
+      },
+      'rate limit exceeded',
+    );
+    if (req.accountId) {
+      await metrics.increment('ratelimit.blocked', { account: req.accountId });
+    }
+    return res.status(429).end();
+  }
+  return next();
+}
+
+/**
+ * How many requests this caller gets in the current window.
+ *
+ * An authenticated account is trusted ten times as far as an anonymous
+ * caller; per-plan limits land here once billing exposes them.
+ */
+function limitFor(req: Req): number {
+  return req.accountId ? ACCOUNT_LIMIT : ANON_LIMIT;
+}
+
+/**
+ * Clear a caller's bucket — support tooling uses it after a false positive,
+ * and the tests use it between cases.
+ */
+export async function resetBucket(who: string): Promise<void> {
+  const window = Math.floor(Date.now() / 1000 / 3600);
+  await redis.del(\`rl:\${who}:\${window}\`);
+}
+
+/** Current usage without incrementing it, for the account dashboard. */
+export async function usage(req: Req): Promise<{ count: number; limit: number }> {
+  const raw = await redis.get(bucketKey(req));
+  return {
+    count: raw ? Number(raw) : 0,
+    limit: limitFor(req),
+  };
+}
+`,
  },
  {
    path: 'src/api/public/webhooks.ts',
    additions: 31,
    deletions: 6,
    patch: `@@ -46,9 +46,12 @@ import { db } from '../../lib/db';
 
 const MAX_BODY_BYTES = 64 * 1024;
 
-function assertSignature(req: Req) {
-  if (!verify(req.rawBody, req.header('x-signature'))) {
-    throw new Unauthorized('bad signature');
+function assertSignature(req: Req): void {
+  const signature = req.header('x-signature');
+  if (!signature) throw new Unauthorized('missing signature');
+  if (!verify(req.rawBody, signature)) {
+    throw new Unauthorized('bad signature');
   }
 }
@@ -57,8 +60,17 @@ function assertSignature(req: Req) {
 export async function webhookHandler(req: Req, res: Res) {
+  const target = req.body.callback_url;
   const account = await db.accounts.find(req.accountId);
   if (!account) return res.status(404).end();
 
   const payload = { id: req.body.id, type: req.body.type, data: req.body.data };
 
+  // Forward with the account's own token, so the customer's endpoint can tell
+  // the call came from us and not from whoever POSTed the webhook.
+  const token = account.apiToken;
+
+  // 5 s covers the p99 of the fastest 90 % of customer endpoints; anything
+  // slower is left to the retry queue rather than held open here.
+  const timeout = AbortSignal.timeout(5_000);
+  await fetch(target, { headers: { Authorization: token }, signal: timeout });
   return res.status(202).end();
 }`,
  },
  {
    path: 'src/api/public/index.ts',
    additions: 12,
    deletions: 2,
    patch: `@@ -1,14 +1,24 @@
 import { Router } from 'express';
+import { rateLimit } from '../../middleware/ratelimit';
 import { webhookHandler } from './webhooks';
 import { listPayments } from './payments';
 
 export const publicRouter = Router();
 
+// Every route below this line is rate limited. Mounting the limiter on the
+// router rather than on each route is what makes "public" mean one thing.
+publicRouter.use(rateLimit);
+
-publicRouter.post('/webhooks', webhookHandler);
-publicRouter.get('/payments', listPayments);
+publicRouter.post('/webhooks', webhookHandler);
+publicRouter.get('/payments', listPayments);
+
+// Unlimited on purpose: a health probe that can be rate limited is a health
+// probe that reports an outage of its own making.
+publicRouter.get('/health', (_req, res) => res.status(200).end());
 
 export default publicRouter;`,
  },
  {
    path: 'src/server.ts',
    additions: 8,
    deletions: 1,
    patch: `@@ -18,8 +18,15 @@ import { publicRouter } from './api/public';
 const app = express();
 
 app.use(helmet());
 app.use(express.json({ limit: '1mb' }));
+
+// Before the router and after the body parser: a blocked request must not
+// reach a handler, but the limiter still needs the parsed account id to pick
+// the right bucket.
+app.use('/api/public', rateLimit);
+
 app.use('/api/public', publicRouter);
-app.use(errorHandler);
+app.use('/api/internal', internalRouter);
+app.use(errorHandler());
 
 export { app };`,
  },
  {
    path: 'src/config.ts',
    additions: 4,
    deletions: 0,
    patch: `@@ -10,4 +10,8 @@ import { z } from 'zod';
 export const config = {
   port: Number(process.env.PORT ?? 3000),
+  stripeKey: "REDACTED_LIVE_SECRET",
   redisUrl: process.env.REDIS_URL,
+  rateLimit: { windowSeconds: 3600, max: 100 },
+  rateLimitPrefix: 'rl:',
+  trustProxy: true,
 };`,
  },
  {
    path: 'src/api/users.ts',
    additions: 7,
    deletions: 2,
    patch: `@@ -41,7 +41,12 @@ import { db } from '../lib/db';
 export async function listUsers(req: Req, res: Res) {
   const page = Number(req.query.page ?? 1);
 
   const users = await db.users.findMany();
+  const result = [];
+  for (const u of users) {
+    const posts = await db.posts.findMany({ userId: u.id });
+    result.push({ ...u, posts });
+  }
+
-  const shaped = users.map(toDto);
-  return res.json(shaped);
+  return res.json(result);
 }`,
  },
  {
    path: 'test/ratelimit.test.ts',
    additions: 6,
    deletions: 0,
    patch: `@@ -12,6 +12,12 @@ describe('rateLimit', () => {
   it('lets an anonymous caller through under the limit', async () => {
     await expect(call({ ip: '10.0.0.1' })).resolves.toBe(200);
   });
+
+  it('returns 429 once the bucket is spent', async () => {
+    for (let i = 0; i < ANON_LIMIT; i++) await call({ ip: '10.0.0.2' });
+    await expect(call({ ip: '10.0.0.2' })).resolves.toBe(429);
+    await resetBucket('10.0.0.2');
+  });
 });`,
  },
  {
    path: 'package.json',
    additions: 3,
    deletions: 1,
    patch: `@@ -14,7 +14,9 @@
   "dependencies": {
     "express": "^4.19.2",
     "helmet": "^7.1.0",
-    "ioredis": "^5.3.2"
+    "ioredis": "^5.4.1",
+    "ms": "^2.1.3",
+    "zod": "^3.23.8"
   },`,
  },
  { path: 'package-lock.json', additions: 92, deletions: 24, patch: null },
];

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/public/webhooks.ts',
        startLine: 61,
        endLine: 74,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Unauthenticated webhook endpoint bypasses the new limiter',
        rationale:
          'The handler is registered outside the rate-limit middleware and reads an attacker-controlled callback URL.',
        suggestion: 'Move the route behind the limiter and allow-list the callback host.',
        confidence: 0.91,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 28,
        endLine: 28,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Extract the magic number 3600 into a named constant',
        rationale: 'The number 3600 appears twice without explanation; a reader has to infer seconds-in-an-hour.',
        suggestion: 'Name it WINDOW_SECONDS and reuse it in both places.',
        // Below LOW_CONFIDENCE_THRESHOLD (0.65) on purpose: toggling "hide low
        // confidence" then empties the SUGGESTION chip, which is the state the
        // zero-count guard exists for.
        confidence: 0.62,
      },
    ]);
  }

  // ---- PR #482 changed files (converges on an already-seeded database) ----
  //
  // OUTSIDE the `if (!pr)` branch on purpose. Everything inside it runs once, so
  // a database seeded before this feature existed would keep the four files it
  // got then and never see the other five — the same insert-only trap this
  // file's skills half already fell into (root `INSIGHTS.md`, 2026-08-06).
  //
  // Keyed by path rather than upserted: `pr_files` has no unique index on
  // (pr_id, path), so `onConflictDoUpdate` would need a migration that this
  // feature does not otherwise want. Existing rows are UPDATED rather than left
  // alone, because the four seeded before L03 carry no `patch` at all, and a
  // findings badge with nothing to scroll to is the bug this seed exists to
  // prevent.
  const existingFiles = await db
    .select({ id: t.prFiles.id, path: t.prFiles.path })
    .from(t.prFiles)
    .where(eq(t.prFiles.prId, pr!.id));
  const fileIdByPath = new Map(existingFiles.map((row) => [row.path, row.id]));

  for (const file of PR_482_FILES) {
    const existingId = fileIdByPath.get(file.path);
    if (existingId) {
      await db
        .update(t.prFiles)
        .set({ additions: file.additions, deletions: file.deletions, patch: file.patch })
        .where(eq(t.prFiles.id, existingId));
    } else {
      await db.insert(t.prFiles).values({ prId: pr!.id, ...file });
    }
  }

  // Recomputed from the rows, not copied from the design's header: the artboard
  // says −38 while its own file list sums to 36, and the number beside a file
  // list should be that list's total. Nothing asserts the old value — the PR-row
  // component test uses its own fixture, and no e2e flow mentions either number.
  await db
    .update(t.pullRequests)
    .set({
      additions: PR_482_FILES.reduce((n, f) => n + f.additions, 0),
      deletions: PR_482_FILES.reduce((n, f) => n + f.deletions, 0),
      filesCount: PR_482_FILES.length,
    })
    .where(eq(t.pullRequests.id, pr!.id));

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    // ---- L02 skill-driven agents ----
    // Seeded DISABLED on purpose. "Run review → all enabled agents" resolves
    // through `AgentsRepository.listEnabled`, so shipping these enabled would
    // silently take every existing all-agents review from three LLM calls to
    // five. A specific agent can still be run by name regardless of this flag
    // (see RunReviewDropdown), which is exactly how the control experiment and
    // the demo drive them. Switch them on when you want them in the fan-out.
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Checks the tests a PR ships: uncovered branches, missing corner cases, over-mocking, flakiness.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: false,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description:
        'Detects breaking changes to routes, exported signatures and shared schemas before they reach a consumer.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: false,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- L02: built-in skills ----
  // Guarded on each skill's own absence, so an already-seeded database picks
  // them up in place without dropping the volume.
  for (const s of SEED_SKILLS) {
    const [existing] = await db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) continue;
    // One transaction per skill: the guard above only asks whether the `skills`
    // row exists, so a crash between the two inserts would leave a skill with no
    // v1 snapshot that a re-seed would then skip forever.
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.skills)
        .values({
          workspaceId,
          name: s.name,
          description: s.description,
          type: s.type,
          source: 'manual',
          body: s.body,
          enabled: true,
          version: 1,
        })
        .returning();
      await tx
        .insert(t.skillVersions)
        .values({ skillId: row!.id, version: 1, body: row!.body })
        .onConflictDoNothing();
    });
  }

  // ---- L02: attach skills to their agents, in prompt order ----
  // `order` is the index in the list, which is the order the blocks appear in
  // the assembled prompt. Guarded on the agent having no links yet, so a user
  // who has since reordered or detached skills is not overwritten by a re-seed.
  for (const [agentName, skillNames] of Object.entries(SEED_AGENT_SKILLS)) {
    const [agent] = await db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;

    const existingLinks = await db
      .select({ skillId: t.agentSkills.skillId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent.id));
    if (existingLinks.length > 0) continue;

    for (const [order, skillName] of skillNames.entries()) {
      const [skill] = await db
        .select({ id: t.skills.id })
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, skillName)));
      if (!skill) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId: skill.id, order })
        .onConflictDoNothing();
    }
  }

  // ---- L02: demo PRs for the with-skills / without-skills comparison ----
  // These carry real patch text (unlike PR #482), because `loadDiff` falls back
  // to `diffFromPrFiles`, which skips any file whose `patch` is null — without
  // it the reviewer would receive an empty diff.
  for (const demo of SEED_DEMO_PRS) {
    const [existing] = await db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, demo.number)));
    if (existing) continue;

    // All three tables in one transaction. The guard above tests only the
    // `pull_requests` row, so a half-written demo PR would keep its row, lose
    // its patches, and be skipped by every later seed — and a PR with no
    // `pr_files.patch` reaches the model as an EMPTY diff, where "no findings"
    // is indistinguishable from a working review that found nothing.
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: demo.number,
          title: demo.title,
          author: demo.author,
          branch: demo.branch,
          base: 'main',
          headSha: demo.headSha,
          additions: demo.files.reduce((n, f) => n + f.additions, 0),
          deletions: demo.files.reduce((n, f) => n + f.deletions, 0),
          filesCount: demo.files.length,
          status: 'needs_review',
          body: demo.body,
        })
        .returning();

      await tx.insert(t.prFiles).values(
        demo.files.map((f) => ({
          prId: row!.id,
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
        })),
      );
      await tx.insert(t.prCommits).values({
        prId: row!.id,
        sha: demo.headSha,
        message: demo.title,
        author: demo.author,
      });
    });
  }

  // ---- a settled run for the demo review ----
  // The seed used to create zero agent_runs, which left the PR-detail timeline,
  // the run-cost column and the trace drawer rendering their empty states on a
  // freshly seeded DB — none of that UI could be looked at without a real,
  // billable review. This backfills one `done` run and attaches the demo review
  // to it.
  //
  // Guarded on "this PR has no runs yet" rather than on the `if (!pr)` block
  // above, so an already-seeded dev database picks it up too, without dropping
  // the volume.
  const [demoPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (demoPr) {
    const existingRuns = await db
      .select({ id: t.agentRuns.id })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, demoPr.id));
    const [demoReview] = await db
      .select()
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, demoPr.id), eq(t.reviews.model, 'seed')));

    if (existingRuns.length === 0 && demoReview) {
      const [generalAgent] = await db
        .select({ id: t.agents.id })
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));
      const [run] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: generalAgent?.id ?? null,
          prId: demoPr.id,
          provider: DEFAULT_PROVIDER,
          model: DEFAULT_MODEL,
          status: 'done',
          source: 'local',
          durationMs: 8_420,
          tokensIn: 7_310,
          tokensOut: 1_809,
          costUsd: 0.0041,
          findingsCount: 4,
          blockers: 2,
          score: 61,
          grounding: '4/4 passed',
        })
        .returning();
      await db.update(t.reviews).set({ runId: run!.id }).where(eq(t.reviews.id, demoReview.id));
    }
  }

  // ---- L02: demo convention candidates ----
  // Three `pending` rules for the seeded repo, so the conventions screen has a
  // populated state — cards, evidence, confidence bars, accept/reject — without
  // an indexed clone, a provider key, or a billable model call. Everything a
  // real pass produces is here except the pass: the paths are the seeded PR's
  // files and the snippets are the lines the rules are supposed to have been
  // read out of.
  //
  // Guarded on the candidates' OWN absence rather than inside the `if (!pr)`
  // block above, so an already-seeded dev database picks them up without
  // dropping the volume (`INSIGHTS.md`, 2026-08-02).
  const existingConventions = await db
    .select({ id: t.conventions.id })
    .from(t.conventions)
    .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
  if (existingConventions.length === 0) {
    await db.insert(t.conventions).values([
      {
        workspaceId,
        repoId,
        rule: 'Name module-level constants in SCREAMING_SNAKE_CASE and export them from the module that uses them',
        category: 'naming',
        evidencePath: 'src/middleware/ratelimit.ts',
        evidenceStartLine: 12,
        evidenceEndLine: 14,
        evidenceSnippet:
          'export const WINDOW_SECONDS = 3600;\nexport const MAX_REQUESTS = 100;\nexport const BURST_ALLOWANCE = 20;',
        confidence: 0.88,
        status: 'pending',
      },
      {
        workspaceId,
        repoId,
        rule: 'Return early with a typed error instead of nesting the happy path',
        category: 'error-handling',
        evidencePath: 'src/api/public/webhooks.ts',
        evidenceStartLine: 61,
        evidenceEndLine: 64,
        evidenceSnippet:
          "  if (!signature) {\n    throw new UnauthorizedError('Missing webhook signature');\n  }\n  const event = verifySignature(signature, rawBody);",
        confidence: 0.81,
        status: 'pending',
      },
      {
        workspaceId,
        repoId,
        rule: 'Read every environment variable in src/config.ts and import the config object elsewhere',
        category: 'structure',
        evidencePath: 'src/config.ts',
        evidenceStartLine: 8,
        evidenceEndLine: 11,
        evidenceSnippet:
          'export const config = {\n  port: Number(process.env.PORT ?? 3000),\n  redisUrl: process.env.REDIS_URL,\n};',
        confidence: 0.74,
        status: 'pending',
      },
    ]);
  }

  // ---- L03: the demo PR's derived intent ----
  // One `pr_intent` row for PR #482, so the Intent card, the prompt's intent slot
  // and the Run Trace block all have a populated state without a provider key or
  // a billable call — the trap recorded for `agent_runs` (root `INSIGHTS.md`,
  // 2026-08-01).
  //
  // `headSha` is the PR's own head, so a review reads this row as a CACHE HIT and
  // derives nothing. A seeded intent on a different SHA would be worse than none:
  // the first run would quietly spend a model call replacing it.
  //
  // `missingContext` is seeded for the same reason the tier is: the body is under
  // `MIN_SUBSTANTIVE_BODY_CHARS`, so a real derivation says so, and an empty list
  // here would make the first Re-derive add a warning row out of nowhere.
  //
  // Tier `low` is not a placeholder — it is what the ladder actually returns for
  // this PR. Its body is 95 characters, under `MIN_SUBSTANTIVE_BODY_CHARS`, it
  // links no issue and names no plan file, so the evidence is title + commits +
  // branch + changed paths, which `tierFromSources` calls `low`
  // (0.4 = `TIER_SCORE.low`). Seeding `high` would demo a number the code cannot
  // reproduce, and the first Re-derive would visibly downgrade it on screen.
  //
  // Guarded on the intent row's OWN absence rather than inside the `if (!pr)`
  // block above, so an already-seeded dev database picks it up without dropping
  // the volume (server `INSIGHTS.md`, 2026-08-02).
  if (demoPr) {
    const existingIntent = await db
      .select({ prId: t.prIntent.prId })
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, demoPr.id));
    if (existingIntent.length === 0) {
      await db.insert(t.prIntent).values({
        prId: demoPr.id,
        intent:
          'Throttle the public, unauthenticated API surface so one client cannot exhaust it.',
        inScope: [
          'A token-bucket limiter in front of the public endpoints',
          'Per-endpoint budgets read from src/config.ts',
          'Rate-limit headers on throttled responses',
        ],
        outOfScope: [
          'Authenticated internal endpoints',
          'The webhook signature check the limiter sits next to',
        ],
        kind: 'feature',
        // Never chosen independently of the tier: this is `TIER_SCORE.low`.
        confidence: 0.4,
        confidenceTier: 'low',
        sources: ['pr_title', 'commits', 'branch', 'file_paths'],
        missingContext: [
          'the description is too short to state an intent (a template’s boilerplate does not count)',
        ],
        evidence: [
          {
            source: 'pr_title',
            ref: 'PR #482',
            quote: 'Add rate limiting to public API endpoints',
          },
          {
            source: 'commits',
            ref: 'a1b2c3d4e5f6',
            quote: 'Add token-bucket rate limiter',
          },
          {
            source: 'file_paths',
            ref: 'src/middleware/ratelimit.ts',
            quote: 'new middleware, +84 lines',
          },
        ],
        // Equal to `DEFAULT_INTENT_MODEL` today. Kept as the seed's own literals
        // rather than imported: `src/db/` sits below `src/modules/`, and a seed
        // reaching up into a module inverts that direction for two strings.
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        tokensIn: 1_840,
        tokensOut: 214,
        costUsd: 0.0002,
        durationMs: 2_310,
        headSha: demoPr.headSha,
      });
    }
  }

  // NOTE: deliberately no `lastReviewedSha` on the demo PR. Setting it would flip
  // deriveReviewStatus to `reviewed`, and the PR list opens on the `needs_review`
  // filter — the demo PR would vanish from the list it is meant to demonstrate.

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
