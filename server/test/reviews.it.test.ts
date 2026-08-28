import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        // The seeded PR body says "Closes #471", which the L03 intent pre-work
        // resolves through the GitHub port. Without this the suite reaches the
        // real github.com for a repo that does not exist — slowly, and only on
        // a machine that happens to have a token configured.
        github: new MockGitHubClient(),
        // L03: a review derives the PR's intent first, on the `review_intent`
        // feature model — `openrouter` by default, a DIFFERENT provider from the
        // agent's. An unmocked entry here is not a mock gap, it is a real,
        // billable call to a live provider from the test suite.
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
          openrouter: new MockLLMProvider('openai', { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    // ---- cost round-trips DB → run list → trace → PR list -------------------
    // MockLLMProvider reports costUsd on every structured call and the engine
    // sums them, so a completed run must land with a real (non-null) cost.
    expect(run!.costUsd).toBeGreaterThan(0);
    expect(trace.stats.cost_usd).toBe(run!.costUsd);

    const runs = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runs[0].cost_usd).toBe(run!.costUsd);

    // The PR list sums every done run of the PR; with exactly one run so far,
    // that total is this run's cost.
    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listed = pulls.find((p: { number: number }) => p.number === pr.number);
    expect(listed.cost_usd).toBe(run!.costUsd);

    await app.close();
  });

  it('PR list sums the cost of every done run; a never-reviewed PR reports null', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Before any review, cost is unknown — null, so the UI renders "—" not "$0.00".
    const before = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(before.find((p: { number: number }) => p.number === pr.number).cost_usd).toBeNull();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'CostAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const after = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listed = after.find((p: { number: number }) => p.number === pr.number);
    expect(listed.cost_usd).toBeGreaterThan(0);

    // A second done run — a second agent on the same review, or a re-review —
    // ADDS to the column. Money is additive: two runs, two real bills.
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agent.id,
      prId: pr.id,
      status: 'done',
      provider: 'openai',
      model: 'gpt-4.1',
      costUsd: 0.25,
    });
    const withSecond = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const summed = withSecond.find((p: { number: number }) => p.number === pr.number).cost_usd;
    expect(summed).toBeCloseTo(listed.cost_usd + 0.25, 10);

    // A newer run that is still `running` has no cost yet and must NOT change
    // the total (and must not blank it).
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: agent.id,
      prId: pr.id,
      status: 'running',
      provider: 'openai',
      model: 'gpt-4.1',
    });
    const withRunning = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(withRunning.find((p: { number: number }) => p.number === pr.number).cost_usd).toBe(
      summed,
    );

    await app.close();
  });

  it('PR list reports null when any done run of the PR is unpriced', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // One priced run and one unpriced one. Null means UNKNOWN, so the total is
    // unknown too — reporting $0.04 here would present a partial sum as exact.
    for (const costUsd of [0.04, null]) {
      await pg.handle.db.insert(t.agentRuns).values({
        workspaceId,
        agentId: null,
        prId: pr.id,
        status: 'done',
        provider: 'openai',
        model: 'gpt-4.1',
        costUsd,
      });
    }

    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(pulls.find((p: { number: number }) => p.number === pr.number).cost_usd).toBeNull();

    await app.close();
  });

  it('PR list reports the latest review severity tally, counting only grounded findings', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Never reviewed → null, not zeros. The UI renders "—" for one and "0" for
    // the other, and they mean different things.
    const before = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(
      before.find((p: { number: number }) => p.number === pr.number).findings_by_severity,
    ).toBeNull();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SevAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // REVIEW_FIXTURE returns one CRITICAL on a real diff line and one WARNING on
    // line 999, which the citation gate drops. The tally therefore follows the
    // findings that were persisted, not what the model claimed to have found.
    const after = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listed = after.find((p: { number: number }) => p.number === pr.number);
    expect(listed.findings_by_severity).toEqual({ critical: 1, warning: 0, suggestion: 0 });

    // And it agrees with the findings the detail page shows.
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    expect(reviews[0].findings).toHaveLength(1);

    await app.close();
  });

  it('a review that kept no findings reports zeros on the PR list, not null', async () => {
    // Everything the model returned was ungrounded, so the review exists but has
    // no findings. "Reviewed and clean" must not read as "never reviewed".
    const allHallucinated: Review = {
      verdict: 'approve',
      summary: 'Nothing real found.',
      score: 100,
      findings: [
        {
          id: 'f-ghost',
          severity: 'CRITICAL',
          category: 'bug',
          title: 'Phantom finding on a line not in the diff',
          file: 'src/config.ts',
          start_line: 999,
          end_line: 999,
          rationale: 'Not in the diff.',
          suggestion: null,
          confidence: 0.5,
          kind: 'finding',
        },
      ],
    };
    const app = await appWith(allHallucinated);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'GhostAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const after = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(
      after.find((p: { number: number }) => p.number === pr.number).findings_by_severity,
    ).toEqual({ critical: 0, warning: 0, suggestion: 0 });

    await app.close();
  });

  it('PR list counts only the newest review, and never a summary row', async () => {
    // The rule the whole column rests on. Summing every review would triple-count
    // one defect three agents each found; counting a `summary` row would count
    // findings no reviewer produced. Both are seeded directly — no model call is
    // needed to exercise a read-time aggregate.
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const seedReview = async (
      kind: 'review' | 'summary',
      createdAt: Date,
      severities: string[],
    ) => {
      const [row] = await pg.handle.db
        .insert(t.reviews)
        .values({ workspaceId, prId: pr.id, kind, verdict: 'comment', summary: kind, score: 50, model: 'm', createdAt })
        .returning({ id: t.reviews.id });
      if (severities.length > 0) {
        await pg.handle.db.insert(t.findings).values(
          severities.map((severity, i) => ({
            reviewId: row!.id,
            file: 'src/config.ts',
            startLine: i + 1,
            endLine: i + 1,
            severity,
            category: 'bug',
            title: `${kind} ${severity} ${i}`,
            rationale: 'r',
            confidence: 0.9,
          })),
        );
      }
      return row!.id;
    };

    await seedReview('review', new Date('2026-06-11T10:00:00Z'), ['CRITICAL', 'CRITICAL', 'WARNING']);
    await seedReview('review', new Date('2026-06-12T10:00:00Z'), ['WARNING', 'SUGGESTION']);
    // Newest row of all, and deliberately fat — if summaries counted, it would win.
    await seedReview('summary', new Date('2026-06-13T10:00:00Z'), ['CRITICAL', 'CRITICAL', 'CRITICAL']);

    const listed = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` }))
      .json()
      .find((p: { number: number }) => p.number === pr.number);
    expect(listed.findings_by_severity).toEqual({ critical: 0, warning: 1, suggestion: 1 });

    await app.close();
  });

  it('PR list picks the same review twice when two reviews share a timestamp', async () => {
    // `created_at` defaults to now(), which is transaction start time, so agents
    // reviewing in one transaction tie exactly. Nothing can say which is newer,
    // but the answer must at least not change between two identical requests.
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const sameInstant = new Date('2026-06-12T10:00:00Z');

    for (const severity of ['CRITICAL', 'SUGGESTION']) {
      const [row] = await pg.handle.db
        .insert(t.reviews)
        .values({ workspaceId, prId: pr.id, kind: 'review', verdict: 'comment', summary: severity, score: 50, model: 'm', createdAt: sameInstant })
        .returning({ id: t.reviews.id });
      await pg.handle.db.insert(t.findings).values({
        reviewId: row!.id,
        file: 'src/config.ts',
        startLine: 1,
        endLine: 1,
        severity,
        category: 'bug',
        title: severity,
        rationale: 'r',
        confidence: 0.9,
      });
    }

    const tally = async () =>
      (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` }))
        .json()
        .find((p: { number: number }) => p.number === pr.number).findings_by_severity;

    expect(await tally()).toEqual(await tally());

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  // ---- POST /reviews/working — a review with no pull request behind it ----

  /**
   * The extra task's server side.
   *
   * What is asserted here is the pair of properties that make it worth having:
   * it reaches the SAME engine through the SAME input builders as a PR review
   * (so it is not a second reviewer wearing the first one's name), and it
   * persists nothing (so it is safe to run on a working tree on every save).
   */
  it('reviews a working diff synchronously, and writes no row anywhere', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const before = await pg.handle.db.select().from(t.reviews);
    const runsBefore = await pg.handle.db.select().from(t.agentRuns);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Working Reviewer',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'You are a reviewer.',
        },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/working',
      // By SLUG, which DevDigest does not own — the MCP server mints it from the
      // name and a caller who read it there will type it back.
      payload: { agent: 'working-reviewer', diff: DIFF },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Synchronous, unlike `POST /pulls/:id/review`: the findings are IN the
    // response, because a CLI has nothing to subscribe to afterwards.
    expect(body.agent_name).toBe('Working Reviewer');
    expect(body.model).toBe('gpt-4.1');
    expect(body.files_reviewed).toBe(1);
    expect(body.verdict).toBe('request_changes');
    // The same grounding gate: the line-11 finding survives, the line-999 one
    // and the phantom file do not.
    expect(body.findings.map((f: { id: string }) => f.id)).toEqual(['f-valid']);
    expect(body.grounding).toBeTruthy();
    expect(body.blocking).toBeGreaterThanOrEqual(1);

    // Nothing was written. This is the property, not a side note.
    expect(await pg.handle.db.select().from(t.reviews)).toHaveLength(before.length);
    expect(await pg.handle.db.select().from(t.agentRuns)).toHaveLength(runsBefore.length);
    expect(await pg.handle.db.select().from(t.findings)).toBeDefined();
    expect(body.id).toBeUndefined();

    await app.close();
  });

  it('names the agents that exist when the one asked for does not', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/reviews/working',
      payload: { agent: 'no-such-reviewer', diff: DIFF },
    });
    expect(res.statusCode).toBe(404);
    // A caller at a terminal cannot see the list, so the error carries it.
    expect(res.json().error.message).toContain('Available:');
    await app.close();
  });

  it('refuses text that is not a diff rather than reviewing an empty change', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/reviews/working',
      payload: { agent: 'general-reviewer', diff: 'this is not a diff at all' },
    });
    // Otherwise it would come back approving a change nobody made.
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('empty_diff');
    await app.close();
  });

  it('rejects an empty diff at the edge, before any handler runs', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/reviews/working',
      payload: { agent: 'general-reviewer', diff: '' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});
