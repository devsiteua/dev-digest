/**
 * L07-A — Multi-Agent Review end to end, against real Postgres.
 *
 * What can only be proven here: that a fan-out really writes ONE parent row and
 * stamps every child with it (AC-04) while the legacy single-agent path stays
 * unparented (AC-05); that an id from another workspace runs NOTHING (AC-03);
 * that the new column is nullable enough for a `source: 'ci'` row to keep
 * inserting (AC-06); that the read endpoint costs zero model calls (AC-08) and
 * tells its two 404s apart by CODE (AC-09); that "the latest run" survives two
 * rows sharing a transaction timestamp (AC-10); that one agent's failure does not
 * take the others' results with it (AC-12, AC-13); and that reading twice writes
 * nothing and answers the same (AC-14).
 *
 * The 16th Postgres container in this lane. Every case builds its own repo, pull
 * request and agents, except AC-36's, which reads what `seed.ts` wrote.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import type { LLMProvider, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[multi-agent] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A provider that fails on every verb — the shape `brief.it.test.ts:40` uses,
 * copied rather than promoted to `test/helpers/`: promoting it would edit three
 * shipped test files for no criterion of this work.
 */
function throwingLLM(id: LLMProvider['id']): LLMProvider {
  const boom = (): never => {
    throw new Error(`the multi-agent read path must not call a model (${id})`);
  };
  return { id, listModels: boom, complete: boom, completeStructured: boom, embed: boom };
}

/**
 * A mock provider that throws for ONE model and answers normally for the rest.
 *
 * `MockLLMProvider` has no per-agent failure option and `src/adapters/mocks.ts`
 * is not on this work's file list, so the per-agent failure of AC-13 is produced
 * by this test-local subclass. The model is the discriminator because that is
 * what the executor passes down from the agent row.
 */
class ModelFailingLLM extends MockLLMProvider {
  constructor(
    private failingModel: string,
    structured: unknown,
  ) {
    super('openai', { structured });
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (req.model === this.failingModel) {
      throw new Error(`provider refused the request for ${this.failingModel}`);
    }
    return super.completeStructured(req);
  }
}

/** A unified diff touching src/config.ts (line 11 added), as `reviews.it.test.ts` uses. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** One grounded finding on line 11 — the line the diff really adds. */
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
  ],
};

d('L07 multi-agent review (Testcontainers pg)', () => {
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

  const db = () => pg.handle.db;

  // ---- fixtures ------------------------------------------------------------

  /** A repo with one pull request whose single file matches `DIFF`. */
  async function makeRepoPr(): Promise<{ repoId: string; prId: string; prNumber: number }> {
    const name = `multi-agent-${seq++}`;
    const [repo] = await db()
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
    const number = 900 + seq;
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: `head-${seq}`,
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db().insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repoId: repo!.id, prId: pr!.id, prNumber: number };
  }

  async function makeAgent(
    opts: { name?: string; model?: string; enabled?: boolean; workspace?: string } = {},
  ): Promise<string> {
    const [agent] = await db()
      .insert(t.agents)
      .values({
        workspaceId: opts.workspace ?? workspaceId,
        name: opts.name ?? `Agent ${seq++}`,
        provider: 'openai',
        model: opts.model ?? 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
        enabled: opts.enabled ?? true,
        createdBy: userId,
      })
      .returning({ id: t.agents.id });
    return agent!.id;
  }

  function appWith(opts: { llm?: LLMProvider; feature?: LLMProvider } = {}) {
    const agentLlm = opts.llm ?? new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const featureLlm = opts.feature ?? agentLlm;
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openai: agentLlm,
          anthropic: agentLlm,
          // The intent pre-work runs on the `openrouter` feature model, a
          // different provider from the agent's. Unmocked, it is a real bill.
          openrouter: featureLlm,
        },
      },
    });
  }

  type App = Awaited<ReturnType<typeof appWith>>;
  const startRun = (app: App, prId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload });
  const readRun = (app: App, prId: string) =>
    app.inject({ method: 'GET', url: `/pulls/${prId}/multi-agent` });
  const readEstimate = (app: App, prId: string) =>
    app.inject({ method: 'GET', url: `/pulls/${prId}/multi-agent/estimate` });

  const parentRowsFor = (prId: string) =>
    db().select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, prId));
  const runRowsFor = (prId: string) =>
    db().select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));

  const totalAgentRuns = async (): Promise<number> => {
    const [row] = await db().select({ n: count() }).from(t.agentRuns);
    return row!.n;
  };

  /**
   * Write a whole multi-agent run by hand — a parent row and one `agent_runs`
   * row per column, optionally with a review and findings.
   *
   * The read-path criteria are about rows, not about how they were produced, and
   * a hand-written row is the only way to reach `cancelled` and `running`
   * deterministically.
   */
  async function seedMultiAgentRun(
    prId: string,
    columns: {
      agentId?: string | null;
      status: string;
      error?: string | null;
      durationMs?: number | null;
      costUsd?: number | null;
      findings?: { file: string; line: number; severity: string; title: string }[];
    }[],
    opts: { ranAt?: Date } = {},
  ): Promise<string> {
    const ranAt = opts.ranAt ?? new Date();
    const [parent] = await db()
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId, ranAt })
      .returning();

    for (const [index, col] of columns.entries()) {
      const [run] = await db()
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: col.agentId ?? null,
          prId,
          multiAgentRunId: parent!.id,
          ranAt: new Date(ranAt.getTime() + index * 1000),
          provider: 'openai',
          model: 'gpt-4.1',
          status: col.status,
          source: 'local',
          error: col.error ?? null,
          durationMs: col.durationMs ?? null,
          costUsd: col.costUsd ?? null,
          findingsCount: col.findings?.length ?? 0,
        })
        .returning();

      if (!col.findings || col.findings.length === 0) continue;
      const [review] = await db()
        .insert(t.reviews)
        .values({
          workspaceId,
          prId,
          agentId: col.agentId ?? null,
          runId: run!.id,
          kind: 'review',
          verdict: 'comment',
          summary: 'seeded by the test',
          score: 60,
          model: 'gpt-4.1',
        })
        .returning({ id: t.reviews.id });
      await db()
        .insert(t.findings)
        .values(
          col.findings.map((f) => ({
            reviewId: review!.id,
            file: f.file,
            startLine: f.line,
            endLine: f.line,
            severity: f.severity,
            category: 'bug',
            title: f.title,
            rationale: 'written by the test',
            confidence: 0.9,
          })),
        );
    }
    return parent!.id;
  }

  // =========================================================================
  // The write side: who gets a parent row
  // =========================================================================

  it('a named set of three agents creates ONE parent row and stamps all three runs with it (AC-04)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    const agentIds = [
      await makeAgent({ name: 'Fanout Sec' }),
      await makeAgent({ name: 'Fanout Gen' }),
      await makeAgent({ name: 'Fanout Perf' }),
    ];

    const res = await startRun(app, prId, { agentIds });
    expect(res.statusCode).toBe(200);
    expect(res.json().runs).toHaveLength(3);

    const parents = await parentRowsFor(prId);
    expect(parents).toHaveLength(1);

    const runs = await runRowsFor(prId);
    expect(runs).toHaveLength(3);
    // One non-null parent id, shared by all three — the linkage AC-04 names.
    expect(new Set(runs.map((r) => r.multiAgentRunId))).toEqual(new Set([parents[0]!.id]));
    // And the response hands the caller that same id (AC-07).
    expect(res.json().multi_agent_run_id).toBe(parents[0]!.id);

    await waitForPrRuns(db(), prId, { expected: 3 });
    await app.close();
  });

  it('`all: true` is a fan-out too, so it also creates a parent row (AC-04)', async () => {
    // AC-04 names both fan-out forms. The handle a fan-out gets is what "return
    // to the last multi-agent run" needs, and `all` produces a set exactly as a
    // named list does.
    const app = await appWith();
    const { prId } = await makeRepoPr();

    const res = await startRun(app, prId, { all: true });
    expect(res.statusCode).toBe(200);

    const parents = await parentRowsFor(prId);
    expect(parents).toHaveLength(1);
    const runs = await runRowsFor(prId);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.every((r) => r.multiAgentRunId === parents[0]!.id)).toBe(true);
    expect(res.json().multi_agent_run_id).toBe(parents[0]!.id);

    await waitForPrRuns(db(), prId, { expected: runs.length });
    await app.close();
  });

  it('the legacy single `{ agentId }` form creates no parent row and leaves the column null (AC-05)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    const agentId = await makeAgent({ name: 'Solo' });

    const res = await startRun(app, prId, { agentId });
    expect(res.statusCode).toBe(200);
    expect(res.json().multi_agent_run_id).toBeNull();

    expect(await parentRowsFor(prId)).toHaveLength(0);
    const runs = await runRowsFor(prId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.multiAgentRunId).toBeNull();

    await waitForPrRuns(db(), prId, { expected: 1 });
    await app.close();
  });

  it('one agent id from another workspace runs NONE of the set (AC-03)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    const [otherWorkspace] = await db()
      .insert(t.workspaces)
      .values({ name: `Other workspace ${seq++}` })
      .returning({ id: t.workspaces.id });
    const agentIds = [
      await makeAgent({ name: 'Mine A' }),
      await makeAgent({ name: 'Mine B' }),
      await makeAgent({ name: 'Theirs', workspace: otherWorkspace!.id }),
    ];

    const before = await totalAgentRuns();
    const res = await startRun(app, prId, { agentIds });

    expect(res.statusCode).toBe(404);
    // Resolution happens BEFORE the creation loop, so the two valid agents did
    // not start either — a partly-run set is the failure this criterion forbids.
    expect(await runRowsFor(prId)).toHaveLength(0);
    expect(await parentRowsFor(prId)).toHaveLength(0);
    expect(await totalAgentRuns()).toBe(before);

    await app.close();
  });

  it('an unknown agent id is the same answer, and still writes nothing (AC-03)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    const agentIds = [await makeAgent({ name: 'Real one' }), '00000000-0000-0000-0000-000000000000'];

    expect((await startRun(app, prId, { agentIds })).statusCode).toBe(404);
    expect(await runRowsFor(prId)).toHaveLength(0);

    await app.close();
  });

  it('a `source: ci` run still inserts with no multi-agent parent (AC-06)', async () => {
    // The column is nullable precisely so the CI ingest of the other stream can
    // keep writing rows that were never part of a fan-out.
    const { prId } = await makeRepoPr();
    const agentId = await makeAgent({ name: 'CI agent' });

    const [row] = await db()
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId,
        prId,
        provider: 'openai',
        model: 'gpt-4.1',
        status: 'done',
        source: 'ci',
        durationMs: 1_000,
        costUsd: 0.001,
      })
      .returning();

    expect(row!.source).toBe('ci');
    expect(row!.multiAgentRunId).toBeNull();
  });

  // =========================================================================
  // The read side
  // =========================================================================

  it('404s with code `no_multi_agent_run` on a clean PR, and 200s forever after one run (AC-09)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();

    const before = await readRun(app, prId);
    expect(before.statusCode).toBe(404);
    // The code, not just the status: a PR that does not exist 404s too, and the
    // client turns exactly one of the two into a screen state.
    expect(before.json().error.code).toBe('no_multi_agent_run');

    const missing = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/multi-agent',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('not_found');

    await seedMultiAgentRun(prId, [{ agentId: await makeAgent({ name: 'Reader' }), status: 'done' }]);

    for (let i = 0; i < 3; i++) {
      expect((await readRun(app, prId)).statusCode).toBe(200);
    }
    await app.close();
  });

  it('serves the whole read path against a provider that throws on every method, and logs `llmCalls: 0` (AC-08, AC-17, AC-23)', async () => {
    const writer = await appWith();
    const { prId } = await makeRepoPr();
    const agentId = await makeAgent({ name: 'Zero calls' });
    await seedMultiAgentRun(prId, [
      {
        agentId,
        status: 'done',
        durationMs: 4_000,
        costUsd: 0.002,
        findings: [
          { file: 'src/config.ts', line: 12, severity: 'CRITICAL', title: 'Hardcoded Stripe secret key' },
        ],
      },
    ]);
    await writer.close();

    const reader = await appWith({
      llm: throwingLLM('openai'),
      feature: throwingLLM('openrouter'),
    });
    const lines: Record<string, unknown>[] = [];
    reader.log.info = ((obj: Record<string, unknown>) => {
      if (obj && typeof obj === 'object') lines.push(obj);
    }) as typeof reader.log.info;

    expect((await readRun(reader, prId)).statusCode).toBe(200);
    // The estimate is the second read this criterion covers: it averages
    // persisted rows and must not reach a model either.
    expect((await readEstimate(reader, prId)).statusCode).toBe(200);

    const served = lines.find((l) => 'llmCalls' in l);
    expect(served).toBeDefined();
    expect(served!.llmCalls).toBe(0);
    expect(served!.groups).toBe(1);

    await reader.close();
  });

  it('picks the same "latest" run twice when two parents share a transaction timestamp (AC-10)', async () => {
    // `ran_at` defaults to now(), which is the TRANSACTION's timestamp, so two
    // rows written in one transaction tie to the microsecond. Without a second
    // ordering key the answer is planner order and can differ between reads.
    const app = await appWith();
    const { prId } = await makeRepoPr();
    const agentId = await makeAgent({ name: 'Tie break' });

    const ids = await db().transaction(async (tx) => {
      const [a] = await tx.insert(t.multiAgentRuns).values({ workspaceId, prId }).returning();
      const [b] = await tx.insert(t.multiAgentRuns).values({ workspaceId, prId }).returning();
      for (const parent of [a!, b!]) {
        await tx.insert(t.agentRuns).values({
          workspaceId,
          agentId,
          prId,
          multiAgentRunId: parent.id,
          provider: 'openai',
          model: 'gpt-4.1',
          status: 'done',
        });
      }
      return [a!.id, b!.id];
    });

    const rows = await parentRowsFor(prId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.ranAt.getTime()).toBe(rows[1]!.ranAt.getTime());

    const first = (await readRun(app, prId)).json();
    const second = (await readRun(app, prId)).json();
    expect(first.id).toBe(second.id);
    // And the tie-break is the documented one — `id DESC`, not chance.
    expect(first.id).toBe([...ids].sort().at(-1));

    await app.close();
  });

  it('returns one column per run of the multi-agent run, in the same order on a second GET (AC-11)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    const agentIds = [
      await makeAgent({ name: 'Column One' }),
      await makeAgent({ name: 'Column Two' }),
      await makeAgent({ name: 'Column Three' }),
    ];

    const started = await startRun(app, prId, { agentIds });
    await waitForPrRuns(db(), prId, { expected: 3 });

    const first = (await readRun(app, prId)).json();
    expect(first.agent_count).toBe(3);
    expect(first.columns).toHaveLength(3);
    expect(first.columns.map((c: { agent_name: string }) => c.agent_name)).toEqual([
      'Column One',
      'Column Two',
      'Column Three',
    ]);
    for (const column of first.columns) {
      expect(column.run_id).toBeTruthy();
      expect(column.provider).toBe('openai');
      expect(column.model).toBe('gpt-4.1');
      expect(column.status).toBe('done');
      expect(column.duration_ms).toBeGreaterThanOrEqual(0);
    }
    // The ids the POST handed back are the ids the columns carry.
    expect(new Set(first.columns.map((c: { run_id: string }) => c.run_id))).toEqual(
      new Set(started.json().runs.map((r: { run_id: string }) => r.run_id)),
    );

    const second = (await readRun(app, prId)).json();
    expect(second.columns.map((c: { run_id: string }) => c.run_id)).toEqual(
      first.columns.map((c: { run_id: string }) => c.run_id),
    );

    await app.close();
  });

  it('renders all four statuses, and a failed column carries the reason from agent_runs.error (AC-12)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    const [aDone, aFailed, aCancelled, aRunning] = [
      await makeAgent({ name: 'Status done' }),
      await makeAgent({ name: 'Status failed' }),
      await makeAgent({ name: 'Status cancelled' }),
      await makeAgent({ name: 'Status running' }),
    ];
    await seedMultiAgentRun(prId, [
      { agentId: aDone, status: 'done', durationMs: 3_000, costUsd: 0.001 },
      { agentId: aFailed, status: 'failed', error: 'provider refused the request' },
      { agentId: aCancelled, status: 'cancelled', error: 'Cancelled by user' },
      { agentId: aRunning, status: 'running' },
    ]);

    const body = (await readRun(app, prId)).json();
    const byName = new Map<string, { status: string; error: string | null }>(
      body.columns.map((c: { agent_name: string; status: string; error: string | null }) => [
        c.agent_name,
        c,
      ]),
    );

    expect(byName.get('Status done')!.status).toBe('done');
    expect(byName.get('Status failed')!.status).toBe('failed');
    expect(byName.get('Status cancelled')!.status).toBe('cancelled');
    expect(byName.get('Status running')!.status).toBe('running');
    expect(byName.get('Status failed')!.error).toBe('provider refused the request');
    // Only the finished runs count as considered — three of the four did not.
    expect(body.agent_count).toBe(4);
    expect(body.agents_considered).toBe(1);
    // A run still in flight has no price, so the total is unknown, not partial.
    expect(body.total_cost_usd).toBe(0.001);

    await app.close();
  });

  it('one failed agent of three: 200, the failure named, and the other two keep their findings (AC-13, AC-19, AC-37)', async () => {
    const app = await appWith({
      llm: new ModelFailingLLM('boom-model', REVIEW_FIXTURE),
      feature: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
    });
    const { prId } = await makeRepoPr();
    const agentIds = [
      await makeAgent({ name: 'Survivor A' }),
      await makeAgent({ name: 'Doomed', model: 'boom-model' }),
      await makeAgent({ name: 'Survivor B' }),
    ];

    expect((await startRun(app, prId, { agentIds })).statusCode).toBe(200);
    await waitForPrRuns(db(), prId, { expected: 3 });

    const res = await readRun(app, prId);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const failed = body.columns.filter((c: { status: string }) => c.status === 'failed');
    const done = body.columns.filter((c: { status: string }) => c.status === 'done');
    expect(failed).toHaveLength(1);
    expect(failed[0].agent_name).toBe('Doomed');
    expect(failed[0].error).toContain('boom-model');
    expect(done).toHaveLength(2);
    for (const column of done) {
      expect(column.findings).toHaveLength(1);
      expect(column.findings[0].title).toBe('Hardcoded Stripe secret key');
    }

    // The disagreement block speaks for the two that finished, and the failed
    // agent gets no `ignored` take anywhere.
    expect(body.agent_count).toBe(3);
    expect(body.agents_considered).toBe(2);
    const takes = body.conflicts.flatMap((c: { takes: { agent_id: string }[] }) => c.takes);
    expect(takes.some((tk: { agent_id: string }) => tk.agent_id === agentIds[1])).toBe(false);

    await app.close();
  });

  it('reading twice writes nothing and answers identically (AC-14)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    await seedMultiAgentRun(prId, [
      {
        agentId: await makeAgent({ name: 'Idempotent A' }),
        status: 'done',
        findings: [
          { file: 'src/config.ts', line: 12, severity: 'CRITICAL', title: 'Hardcoded Stripe secret key' },
        ],
      },
      {
        agentId: await makeAgent({ name: 'Idempotent B' }),
        status: 'done',
        findings: [
          { file: 'src/api/users.ts', line: 45, severity: 'WARNING', title: 'N+1 query in the user list' },
        ],
      },
    ]);

    const tally = async () => {
      const [runs] = await db().select({ n: count() }).from(t.agentRuns);
      const [parents] = await db().select({ n: count() }).from(t.multiAgentRuns);
      const [reviews] = await db().select({ n: count() }).from(t.reviews);
      const [findings] = await db().select({ n: count() }).from(t.findings);
      return { runs: runs!.n, parents: parents!.n, reviews: reviews!.n, findings: findings!.n };
    };

    const before = await tally();
    const first = (await readRun(app, prId)).json();
    const second = (await readRun(app, prId)).json();

    // Groups and conflicts are derived on every read — the criterion is that
    // deriving them persists nothing at all.
    expect(second).toEqual(first);
    expect(await tally()).toEqual(before);

    await app.close();
  });

  it('every persisted finding of the run appears in exactly one group (AC-15, AC-16)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    await seedMultiAgentRun(prId, [
      {
        agentId: await makeAgent({ name: 'Group Sec' }),
        status: 'done',
        findings: [
          { file: 'src/config.ts', line: 12, severity: 'CRITICAL', title: 'Hardcoded Stripe secret key committed to the repository' },
          { file: 'src/api/users.ts', line: 45, severity: 'WARNING', title: 'N+1 query in the user list endpoint' },
        ],
      },
      {
        agentId: await makeAgent({ name: 'Group Gen' }),
        status: 'done',
        findings: [
          { file: 'src/config.ts', line: 12, severity: 'CRITICAL', title: 'Hardcoded Stripe secret key committed to config' },
        ],
      },
    ]);

    const body = (await readRun(app, prId)).json();

    const runIds = body.columns.map((c: { run_id: string }) => c.run_id);
    const persisted = await db()
      .select({ n: count() })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(eq(t.reviews.prId, prId));
    expect(runIds).toHaveLength(2);

    const memberIds: string[] = body.groups.flatMap(
      (g: { members: { finding_id: string }[] }) => g.members.map((m) => m.finding_id),
    );
    expect(memberIds).toHaveLength(persisted[0]!.n);
    expect(new Set(memberIds).size).toBe(memberIds.length);
    // The two phrasings of the committed key are one group; the N+1 is its own.
    expect(body.groups).toHaveLength(2);

    await app.close();
  });

  // =========================================================================
  // The estimate
  // =========================================================================

  it('reports "no data" per agent on a PR nothing has ever run on (AC-22, AC-23)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    const freshAgent = await makeAgent({ name: 'Never run' });

    const res = await readEstimate(app, prId);
    expect(res.statusCode).toBe(200);

    const mine = res
      .json()
      .find((e: { agent_id: string }) => e.agent_id === freshAgent);
    expect(mine).toBeDefined();
    expect(mine.runs_sampled).toBe(0);
    // Null, never 0 — "nothing to average" and "it is free" are different facts.
    expect(mine.avg_duration_ms).toBeNull();
    expect(mine.avg_cost_usd).toBeNull();
    expect(mine.enabled).toBe(true);

    await app.close();
  });

  it('a seeded demo PR with no runs of its own still reports "no data" for an agent that never ran (AC-22)', async () => {
    // Not #482: the seed gives that PR a completed run, so its estimate is never
    // empty. One of `SEED_DEMO_PRS` has files and commits and no runs at all.
    const app = await appWith();
    const [demo] = await db()
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.number, 483)));
    expect(demo).toBeDefined();

    const neverRan = await makeAgent({ name: 'Demo never run' });
    const rows = await readEstimate(app, demo!.id).then((r) => r.json());
    const mine = rows.find((e: { agent_id: string }) => e.agent_id === neverRan);

    expect(mine.runs_sampled).toBe(0);
    expect(mine.avg_duration_ms).toBeNull();
    expect(mine.avg_cost_usd).toBeNull();

    await app.close();
  });

  it('averages an agent\'s own completed runs, and ignores the ones that failed (AC-23)', async () => {
    const app = await appWith();
    const { prId } = await makeRepoPr();
    const agentId = await makeAgent({ name: 'Has history' });

    for (const row of [
      { status: 'done', durationMs: 8_000, costUsd: 0.004 },
      { status: 'done', durationMs: 6_000, costUsd: 0.002 },
      { status: 'failed', durationMs: 50, costUsd: null },
    ]) {
      await db().insert(t.agentRuns).values({
        workspaceId,
        agentId,
        prId,
        provider: 'openai',
        model: 'gpt-4.1',
        source: 'local',
        ...row,
      });
    }

    const rows = await readEstimate(app, prId).then((r) => r.json());
    const mine = rows.find((e: { agent_id: string }) => e.agent_id === agentId);

    expect(mine.runs_sampled).toBe(2);
    expect(mine.avg_duration_ms).toBe(7_000);
    expect(mine.avg_cost_usd).toBeCloseTo(0.003, 10);

    await app.close();
  });

  // =========================================================================
  // The seeded run (AC-36)
  // =========================================================================

  it('the seed\'s three-agent run on PR #482 is readable through the endpoint (AC-36)', async () => {
    // Depends on Step 10. This is what lets the screen — and the e2e flow — be
    // looked at without spending a model call.
    const app = await appWith();
    const [demo] = await db()
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.number, 482)));
    expect(demo).toBeDefined();

    const res = await readRun(app, demo!.id);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.pr_number).toBe(482);
    expect(body.agent_count).toBe(3);
    expect(body.agents_considered).toBe(3);
    expect(body.columns.map((c: { agent_name: string }) => c.agent_name)).toEqual([
      'Security Reviewer',
      'General Reviewer',
      'Performance Reviewer',
    ]);
    expect(body.columns.every((c: { status: string }) => c.status === 'done')).toBe(true);
    expect(body.total_cost_usd).toBeGreaterThan(0);

    // The committed key is the place all three named, and agreement is NOT a
    // conflict — that is the group `Show only conflicts` has to hide.
    const keyGroup = body.groups.find((g: { file: string }) => g.file === 'src/config.ts');
    expect(keyGroup.members).toHaveLength(3);
    expect(
      body.conflicts.some((c: { file: string }) => c.file === 'src/config.ts'),
    ).toBe(false);

    // And a place only one agent flagged is contended, with `ignored` takes for
    // the two that finished and stayed silent.
    const alone = body.conflicts.find((c: { file: string }) => c.file === 'src/api/users.ts');
    expect(alone).toBeDefined();
    expect(
      alone.takes.filter((tk: { verdict: string }) => tk.verdict === 'ignored'),
    ).toHaveLength(2);

    await app.close();
  });
});
