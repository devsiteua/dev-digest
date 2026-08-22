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

  /** The id AND the full name, for the cases that put a blob URL in a body. */
  async function makeRepoRef(): Promise<{ repoId: string; fullName: string }> {
    const name = `intent-${seq++}`;
    const fullName = `acme/${name}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName,
        defaultBranch: 'main',
        createdBy: userId,
      })
      .returning();
    return { repoId: repo!.id, fullName };
  }

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
    opts: {
      body?: string | null;
      headSha?: string;
      commits?: string[];
      /** A bare path stores a row with a null `patch`, as GitHub's own sync can. */
      files?: (string | { path: string; patch: string; additions?: number; deletions?: number })[];
    } = {},
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
    for (const file of opts.files ?? []) {
      const row = typeof file === 'string' ? { path: file, patch: null } : file;
      await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, ...row });
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
    // Discarded, but not forgotten — the card has to be able to say why.
    expect(intent.missing_context).toEqual(
      expect.arrayContaining([expect.stringContaining('other/repo#12')]),
    );
  });

  it('follows a ticket-word reference, not only a closing keyword', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), { body: 'Ticket: #471' });

    const intent = (await derive(app, prId)).json();
    expect(intent.sources).toContain('linked_issue');
    expect(intent.confidence_tier).toBe('high');
    // The issue was READ, so nothing about it is missing. The short description
    // still is, and saying both is the honest answer.
    expect(intent.missing_context.join(' ')).not.toContain('#471');
  });

  it('reads a plan linked as this repo’s own blob URL, from the clone', async () => {
    const { repoId, fullName } = await makeRepoRef();
    const app = await makeApp();
    const prId = await makePr(repoId, {
      body: `Plan: https://github.com/${fullName}/blob/main/specs/rate-limit.md`,
    });

    const intent = (await derive(app, prId)).json();
    expect(intent.sources).toContain('plan_file');
    expect(intent.confidence_tier).toBe('high');
  });

  it('neither reads nor fetches another repo’s blob URL, and says so', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), {
      body: 'Plan: https://github.com/other/repo/blob/main/specs/rate-limit.md',
    });

    const intent = (await derive(app, prId)).json();
    expect(intent.sources).not.toContain('plan_file');
    expect(intent.missing_context).toEqual(
      expect.arrayContaining([expect.stringContaining('other/repo/specs/rate-limit.md')]),
    );
  });

  it('does not let a root README buy a confidence tier', async () => {
    const app = await makeApp({ git: new MockGitClient({ files: { 'README.md': '# Project' } }) });
    const prId = await makePr(await makeRepo(), { body: 'Also updated README.md.' });

    const intent = (await derive(app, prId)).json();
    expect(intent.sources).not.toContain('plan_file');
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
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { PrIntent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
    });
    const app = await makeApp({ llm, git: new MockGitClient({ files: {} }) });
    const prId = await makePr(await makeRepo(), { body: 'See specs/missing.md for the plan.' });

    const intent = (await derive(app, prId)).json();
    expect(intent.sources).not.toContain('plan_file');
    expect(intent.confidence_tier).toBe('low');

    // The brief's "an unreachable link must not be silently replaced with
    // invention" — the absence is not enough, the document has to be NAMED.
    expect(intent.missing_context).toEqual(
      expect.arrayContaining([expect.stringContaining('specs/missing.md')]),
    );

    // And the classifier is told, in our own voice, not to reconstruct it.
    const req = llm.calls.find((c) => c.method === 'completeStructured')!.req as {
      messages: { role: string; content: string }[];
    };
    const user = req.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('## Context that is missing');
    expect(user).toContain('specs/missing.md');
  });

  it('records an issue it was told about and could not read', async () => {
    const github = new MockGitHubClient();
    github.getIssue = async () => {
      throw new Error('Not Found');
    };
    const app = await makeApp({ github });
    const prId = await makePr(await makeRepo(), { body: 'Closes #471' });

    const intent = (await derive(app, prId)).json();
    expect(intent.sources).not.toContain('linked_issue');
    expect(intent.missing_context).toEqual(
      expect.arrayContaining([expect.stringContaining('#471')]),
    );
  });

  it('survives a round trip through the row and the GET route', async () => {
    const app = await makeApp({ git: new MockGitClient({ files: {} }) });
    const prId = await makePr(await makeRepo(), { body: 'See specs/missing.md for the plan.' });

    const derived = (await derive(app, prId)).json();
    const fetched = (
      await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` })
    ).json();
    expect(fetched.missing_context).toEqual(derived.missing_context);
    expect(fetched.missing_context.length).toBeGreaterThan(0);
  });

  it('says nothing is missing when nothing was', async () => {
    const app = await makeApp();
    const prId = await makePr(await makeRepo(), { body: 'x'.repeat(400) });

    const intent = (await derive(app, prId)).json();
    expect(intent.missing_context).toEqual([]);
  });

  // ---- What the classifier is shown ---------------------------------------

  it('shows the classifier each file\'s hunk headers, and no line of the change', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { PrIntent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
    });
    const app = await makeApp({ llm });
    const prId = await makePr(await makeRepo(), {
      body: null,
      files: [
        {
          path: 'src/middleware/limit.ts',
          additions: 2,
          deletions: 1,
          patch: [
            '@@ -1,3 +1,4 @@',
            ' import { rateLimit } from "./rate-limit.js";',
            '-const WINDOW = 60;',
            '+const WINDOW = 30;',
            '+const BURST = 5;',
            '@@ -40,2 +41,2 @@ export function limit() {',
            '-  return old();',
            '+  return next();',
          ].join('\n'),
        },
        // A row GitHub synced without a patch still contributes its path.
        'docs/rate-limits.md',
      ],
    });

    await derive(app, prId);

    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const req = call!.req as { messages: { role: string; content: string }[] };
    const user = req.messages.find((m) => m.role === 'user')!.content;

    expect(user).toContain('src/middleware/limit.ts (+2/-1)');
    expect(user).toContain('@@ -1,3 +1,4 @@');
    expect(user).toContain('@@ -40,2 +41,2 @@ export function limit() {');
    expect(user).toContain('docs/rate-limits.md (+0/-0)');

    // The mechanical form of "change bodies are not sent", scoped to the block
    // that carries the change. Whole-prompt would be a weaker claim dressed as a
    // stronger one: a PR body written in markdown legitimately opens lines with
    // `-`, and so does our own missing-context list.
    const block = user.slice(user.indexOf('## Changed files'), user.indexOf('</untrusted>', user.indexOf('## Changed files')));
    for (const line of block.split('\n')) {
      expect(line.startsWith('+')).toBe(false);
      expect(line.startsWith('-')).toBe(false);
    }
    expect(user).not.toContain('const BURST = 5');
    expect(user).not.toContain('import { rateLimit }');
  });

  it('logs what the prompt was built from, and none of what it said', async () => {
    const lines: Record<string, unknown>[] = [];
    const app = await makeApp();
    app.log.info = ((obj: Record<string, unknown>) => {
      if (obj && typeof obj === 'object') lines.push(obj);
    }) as typeof app.log.info;

    const prId = await makePr(await makeRepo(), {
      body: 'Implements the plan in specs/rate-limit.md.',
      commits: ['add limiter middleware'],
      files: ['src/middleware/limit.ts'],
    });
    await derive(app, prId);

    const line = lines.find((l) => typeof l.blocks === 'string');
    expect(line).toBeDefined();
    expect(line!.tokensIn).toBeGreaterThan(0);
    expect(line!.tokensOut).toBeGreaterThan(0);
    expect(line!.model).toBe('deepseek/deepseek-v4-flash');
    expect(line!.blocks).toContain('plan_file×1');
    expect(line!.blocks).toContain('commits×1');
    // Kinds and sizes only — no character of the plan, the body or a commit.
    expect(line!.blocks).not.toContain('stop unauthenticated abuse');
    expect(line!.blocks).not.toContain('add limiter middleware');
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

  it('drops out-of-scope noise end to end, and keeps one signal', async () => {
    // The unit suite proves the gate's arithmetic. This proves the WIRING:
    // contract → structured reply → grounding → gate → persisted findings →
    // the trace stat the drawer reads. The mock diff touches src/config.ts
    // around line 11, so every finding here grounds.
    const at = (over: Record<string, unknown>) => ({
      id: `f-${Math.random().toString(36).slice(2, 8)}`,
      severity: 'WARNING',
      category: 'bug',
      title: 'finding',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'because',
      confidence: 0.8,
      ...over,
    });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        PrIntent: INTENT_FIXTURE,
        Review: {
          verdict: 'request_changes',
          summary: 'mixed',
          score: 40,
          findings: [
            at({ scope: 'in', title: 'in-scope bug' }),
            at({ scope: 'out', severity: 'CRITICAL', confidence: 0.95, title: 'the signal' }),
            at({ scope: 'out', severity: 'CRITICAL', confidence: 0.5, title: 'quieter crit' }),
            at({ scope: 'out', title: 'out-of-scope warning' }),
          ],
        },
      },
    });
    const app = await makeApp({ llm });
    const prId = await makePr(await makeRepo(), { body: 'Closes #471' });

    await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { all: true } });
    const runs = await waitForPrRuns(pg.handle.db, prId);
    expect(runs.every((r) => r.status === 'done')).toBe(true);

    const reviews = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.prId, prId));
    const rows = await pg.handle.db
      .select()
      .from(t.findings)
      .where(eq(t.findings.reviewId, reviews[0]!.id));
    expect(rows.map((r) => r.title).sort()).toEqual(['in-scope bug', 'the signal']);

    // The gate is not allowed to be silent: the drops are in the run log and the
    // summary is in the trace the drawer reads.
    const [trace] = await pg.handle.db
      .select()
      .from(t.runTraces)
      .where(eq(t.runTraces.runId, runs[0]!.id));
    const doc = trace!.trace as { stats: { scope_gate?: string }; log: { msg: string }[] };
    expect(doc.stats.scope_gate).toContain('2/4 in scope');
    expect(doc.stats.scope_gate).toContain('kept as the signal');
    expect(doc.log.some((l) => l.msg.includes('scope gate dropped "quieter crit"'))).toBe(true);
    expect(doc.log.some((l) => l.msg.includes('scope gate dropped "out-of-scope warning"'))).toBe(
      true,
    );
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
