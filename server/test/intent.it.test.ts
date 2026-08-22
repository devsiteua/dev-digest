/**
 * L03 — the intent layer end to end: the evidence ladder, the cache keyed on the
 * PR's head, the two routes, and the promise that a failed derivation still
 * leaves a completed review.
 *
 * The ladder is the reason this suite exists. Which tier a PR earns is decided by
 * WHICH sources were found, and "found" means a real read through a real port —
 * a plan file that is in the clone, an issue the GitHub client answers for. Unit
 * tests can prove the ladder's arithmetic; only this one proves the wiring feeds
 * it the right facts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[intent] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** The clone the derivation reads plan files out of. */
const CLONE: Record<string, string> = {
  'specs/rate-limit.md': '# Rate limit the public API\n\nGoal: stop unauthenticated abuse.',
};

const INTENT_FIXTURE = {
  kind: 'feature',
  intent: 'Rate-limit the public API endpoints.',
  in_scope: ['middleware', '429 + Retry-After'],
  out_of_scope: ['authentication changes'],
  evidence: [{ source: 'pr_title', ref: '#1', quote: 'Add rate limiting' }],
  suggested_confidence: 'high',
};

/** A minimal Review the seeded agents' own call can parse. */
const REVIEW_FIXTURE = {
  verdict: 'comment',
  summary: 'nothing to report',
  score: 90,
  findings: [],
};

d('L03 intent layer (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let userId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    userId = seeded.userId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeRepo(): Promise<string> {
    const name = `intent-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        defaultBranch: 'main',
        createdBy: userId,
      })
      .returning();
    return repo!.id;
  }

  async function makePr(
    repoId: string,
    opts: { body?: string | null; headSha?: string; commits?: string[]; files?: string[] } = {},
  ): Promise<string> {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 100 + seq++,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: opts.headSha ?? 'head-1',
        body: opts.body ?? null,
      })
      .returning();
    for (const message of opts.commits ?? []) {
      await pg.handle.db
        .insert(t.prCommits)
        .values({ prId: pr!.id, sha: `sha-${seq++}`, message, author: 'marisa.koch' });
    }
    for (const path of opts.files ?? []) {
      await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, path, patch: null });
    }
    return pr!.id;
  }

  function makeApp(opts: { llm?: MockLLMProvider; git?: MockGitClient; github?: MockGitHubClient } = {}) {
    const llm =
      opts.llm ??
      new MockLLMProvider('openai', {
        structuredBySchema: { PrIntent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
      });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: opts.git ?? new MockGitClient({ files: CLONE }),
        github: opts.github ?? new MockGitHubClient(),
        llm: { openai: llm, anthropic: llm, openrouter: llm },
      },
    });
  }

  const derive = async (app: Awaited<ReturnType<typeof makeApp>>, prId: string) =>
    app.inject({ method: 'POST', url: `/pulls/${prId}/intent` });

  const structuredCalls = (llm: MockLLMProvider, schemaName: string) =>
    llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === schemaName,
    );

  // ---- The evidence ladder -------------------------------------------------

  it('rates a PR that points at a plan file in the clone as high confidence', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), {
      body: 'Implements the plan in specs/rate-limit.md.',
    });

    const res = await derive(app, prId);
    expect(res.statusCode).toBe(200);
    const intent = res.json();
    expect(intent.confidence_tier).toBe('high');
    expect(intent.sources).toContain('plan_file');
    expect(intent.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('rates a PR that closes an issue as high confidence, and reads the issue', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), { body: 'Closes #471' });

    const intent = (await derive(app, prId)).json();
    expect(intent.confidence_tier).toBe('high');
    expect(intent.sources).toContain('linked_issue');
  });

  it('does not follow a cross-repo reference, and falls back down the ladder', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), { body: 'Closes other/repo#12' });

    const intent = (await derive(app, prId)).json();
    expect(intent.sources).not.toContain('linked_issue');
    expect(intent.confidence_tier).toBe('low');
  });

  it('caps a body-only PR at medium — the model cannot argue itself up', async () => {
    // The fixture suggests `high` on every call. With only prose as evidence the
    // ladder says `medium`, and the persisted tier is the lower of the two.
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), { body: 'x'.repeat(400) });

    const intent = (await derive(app, prId)).json();
    expect(intent.confidence_tier).toBe('medium');
    expect(intent.confidence).toBeLessThan(0.85);
  });

  it('still derives an intent for a PR with no documentation at all, at low confidence', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), {
      body: null,
      commits: ['add limiter middleware'],
      files: ['src/middleware/limit.ts'],
    });

    const intent = (await derive(app, prId)).json();
    expect(intent.confidence_tier).toBe('low');
    expect(intent.intent).toBe(INTENT_FIXTURE.intent);
    expect(intent.sources).toEqual(expect.arrayContaining(['pr_title', 'commits', 'branch']));
    expect(intent.sources).not.toContain('pr_body');
  });

  it('names a plan file it cannot read instead of pretending it read one', async () => {
    const app = await makeApp({ git: new MockGitClient({ files: {} }) });
    const prId = await makePr(await makeRepo(), { body: 'See specs/missing.md for the plan.' });

    const intent = (await derive(app, prId)).json();
    expect(intent.sources).not.toContain('plan_file');
    expect(intent.confidence_tier).toBe('low');
  });

  // ---- Persistence and the routes -----------------------------------------

  it('persists the model, the cost and the head it was derived at', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), { body: 'Closes #471' });

    const intent = (await derive(app, prId)).json();
    expect(intent.head_sha).toBe('head-1');
    expect(intent.provider).toBe('openrouter');
    expect(intent.model).toBe('deepseek/deepseek-v4-flash');
    expect(intent.tokens_in).toBeGreaterThan(0);
    expect(intent.cost_usd).toBeGreaterThan(0);
    expect(intent.kind).toBe('feature');
  });

  it('GET is 404 before a derivation and 200 after', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), { body: 'Closes #471' });

    expect((await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` })).statusCode).toBe(404);
    await derive(app, prId);
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(res.statusCode).toBe(200);
    expect(res.json().intent).toBe(INTENT_FIXTURE.intent);
  });

  it('re-deriving replaces the row rather than adding one', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), { body: 'Closes #471' });

    await derive(app, prId);
    await derive(app, prId);

    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    expect(rows).toHaveLength(1);
  });

  // ---- The review path ------------------------------------------------------

  it('derives once for a review, reuses it while the head has not moved, and re-derives when it has', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { PrIntent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
    });
    const app = await makeApp({ llm });
    const repoId = await makeRepo();
    const prId = await makePr(repoId, { body: 'Closes #471' });

    await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { all: true } });
    await waitForPrRuns(pg.handle.db, prId);
    expect(structuredCalls(llm, 'PrIntent')).toHaveLength(1);

    // Second review, same head: the persisted row is reused and no model is asked.
    await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { all: true } });
    await waitForPrRuns(pg.handle.db, prId);
    expect(structuredCalls(llm, 'PrIntent')).toHaveLength(1);

    // The head moves — the claim was made about different code, so it is remade.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'head-2' })
      .where(eq(t.pullRequests.id, prId));
    await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { all: true } });
    await waitForPrRuns(pg.handle.db, prId);
    expect(structuredCalls(llm, 'PrIntent')).toHaveLength(2);

    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    expect(row!.headSha).toBe('head-2');
  });

  it('completes every agent run even when the derivation throws', async () => {
    // No PrIntent fixture: the mock rejects the reply against the schema, which
    // is how a real provider failure reaches the executor.
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { Review: REVIEW_FIXTURE },
    });
    const app = await makeApp({ llm });
    const prId = await makePr(await makeRepo(), { body: 'Closes #471' });

    await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { all: true } });
    const runs = await waitForPrRuns(pg.handle.db, prId);

    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.status === 'done')).toBe(true);
    // And no intent was persisted, rather than a half-written one.
    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    expect(rows).toHaveLength(0);
  });

  it('feeds the reviewing prompt an intent section only when there is one', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { PrIntent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
    });
    const app = await makeApp({ llm });
    const prId = await makePr(await makeRepo(), { body: 'Closes #471' });

    await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { all: true } });
    await waitForPrRuns(pg.handle.db, prId);

    const reviewCall = structuredCalls(llm, 'Review')[0]!.req as {
      messages: { role: string; content: string }[];
    };
    const user = reviewCall.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('## PR intent (derived)');
    expect(user).toContain(INTENT_FIXTURE.intent);
    // The distillation, not the sources it came from.
    expect(user).not.toContain('mock issue');
  });

  it('uses the loaded diff for changed paths, not pr_files', async () => {
    // pr_files is empty; the diff still names a file, and file_paths is still a
    // source. loadDiff prefers `git diff` and only falls back to that table.
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { PrIntent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
    });
    const app = await makeApp({ llm });
    const prId = await makePr(await makeRepo(), { body: null, files: [] });

    await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { all: true } });
    await waitForPrRuns(pg.handle.db, prId);

    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    expect(row!.sources).toContain('file_paths');
  });
});
