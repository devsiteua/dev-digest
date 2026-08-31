/**
 * The two reads the screens are built on: the workspace dashboard and the
 * side-by-side comparison of two batches.
 *
 * The interesting cases here are the ones about incompleteness — a `partial`
 * batch, and a case that exists in one run's set and not the other. Both are
 * states a real workspace reaches within a week, and both are where a naive
 * aggregate silently reports a number that is not true.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForBatch } from './helpers/evals.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockGitClient,
  MockGitHubClient,
  MockEmbedder,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import {
  EvalDashboard,
  EvalRunComparison,
  type EvalRunBatch,
  type Review,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'one grounded finding',
  score: 70,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key in commit',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      rationale: 'r',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

d('L06 eval reads (Testcontainers pg)', () => {
  let pg: PgFixture;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'General Reviewer'));
    agentId = agent!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const app = (llm?: MockLLMProvider) =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
        llm: { openrouter: llm ?? new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });

  it('the dashboard of a workspace where nothing has run yet is empty, not zeroed', async () => {
    const a = await app();
    const body = EvalDashboard.parse(
      (await a.inject({ method: 'GET', url: '/evals/dashboard' })).json(),
    );

    // Eight seeded cases exist; no run has ever happened. The three metrics are
    // the vacuous 1 the contract forces, and it is the DENOMINATOR that lets the
    // screen render `—` instead of a triumphant 100%.
    expect(body.cases_total).toBe(8);
    expect(body.current.traces_total).toBe(0);
    expect(body.recent_runs).toEqual([]);
    expect(body.delta).toEqual({ recall: 0, precision: 0, citation_accuracy: 0 });

    // The two fields this spec puts out of scope, kept on the wire on purpose.
    expect(body.trend).toEqual([]);
    expect(body.alert).toBeNull();

    await a.close();
  });

  it('the dashboard reports the newest terminal batch, and the delta against the one before it', async () => {
    const a = await app();
    const { db } = pg.handle;

    const first = (
      await a.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })
    ).json() as EvalRunBatch;
    await waitForBatch(db, first.id);

    // A second run that finds NOTHING — recall drops from 1/5 to 0/5.
    const b = await app(
      new MockLLMProvider('openai', {
        structured: { verdict: 'comment', summary: 'nothing', score: 90, findings: [] },
      }),
    );
    const second = (
      await b.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })
    ).json() as EvalRunBatch;
    await waitForBatch(db, second.id);

    const body = EvalDashboard.parse(
      (await a.inject({ method: 'GET', url: '/evals/dashboard' })).json(),
    );

    expect(body.current.recall).toBeCloseTo(0, 6);
    // …and the delta is signed against the PREVIOUS batch, not against zero.
    expect(body.delta.recall).toBeCloseTo(-1 / 5, 6);
    expect(body.current.traces_total).toBe(8);
    expect(body.recent_runs.length).toBeGreaterThan(0);
    expect(body.recent_runs.every((r) => r.batch_id === second.id)).toBe(true);

    await a.close();
    await b.close();
  });

  it('AC-24 / AC-25: the comparison carries both denominators, the per-case change, and the incompleteness', async () => {
    const a = await app();
    const { db } = pg.handle;

    const batches = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.agentId, agentId))
      .orderBy(t.evalRunBatches.startedAt);
    const [older, newer] = batches;

    const cmp = EvalRunComparison.parse(
      (
        await a.inject({
          method: 'GET',
          url: `/eval-runs/compare?a=${older!.id}&b=${newer!.id}`,
        })
      ).json(),
    );

    // Both sides ship their denominators. Two runs of different set sizes
    // reduced to one percentage difference is exactly what this avoids.
    expect(cmp.a.recall_denominator).toBe(5);
    expect(cmp.b.recall_denominator).toBe(5);
    expect(cmp.a.cases_total).toBe(8);

    // The case that changed state, named.
    const changed = cmp.cases.filter((c) => c.before !== c.after);
    expect(changed).toHaveLength(1);
    expect(changed[0]!.before).toBe('pass');
    expect(changed[0]!.after).toBe('fail');
    expect(changed[0]!.name).toBe('Hardcoded Stripe secret key in commit');
    // …and it sorts FIRST, so the row the experiment was run to see is not
    // buried under seven that did not move.
    expect(cmp.cases[0]!.case_id).toBe(changed[0]!.case_id);

    await a.close();
  });

  it('a case present in one run’s set and not the other reads as absent, not as a failure', async () => {
    const a = await app();
    const { db } = pg.handle;

    // A ninth case, created between the two runs. It cannot have a row in either
    // of the batches above, which is precisely the state `absent` exists for.
    const [extra] = await db
      .insert(t.evalCases)
      .values({
        workspaceId: (await db.select().from(t.workspaces).limit(1))[0]!.id,
        ownerKind: 'agent',
        ownerId: agentId,
        name: 'added after both runs',
        inputDiff: '',
        inputMeta: null,
        expectedOutput: { kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 1 },
      })
      .returning();

    const third = (
      await a.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })
    ).json() as EvalRunBatch;
    expect(third.cases_total).toBe(9);
    await waitForBatch(db, third.id);

    const batches = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.agentId, agentId))
      .orderBy(t.evalRunBatches.startedAt);
    const earlier = batches[0]!;

    const cmp = EvalRunComparison.parse(
      (
        await a.inject({ method: 'GET', url: `/eval-runs/compare?a=${earlier.id}&b=${third.id}` })
      ).json(),
    );

    const row = cmp.cases.find((c) => c.case_id === extra!.id)!;
    expect(row.before).toBe('absent');
    expect(row.after).not.toBe('absent');
    // and the two set sizes are visible rather than reconciled
    expect(cmp.a.cases_total).toBe(8);
    expect(cmp.b.cases_total).toBe(9);

    await db.delete(t.evalCases).where(eq(t.evalCases.id, extra!.id));
    await a.close();
  });

  it('AC-25: an errored case reads as skipped, and its batch is labelled partial', async () => {
    const a = await app(
      new MockLLMProvider('openai', { structured: REVIEW_FIXTURE, failStructuredOnCall: [2] }),
    );
    const { db } = pg.handle;

    const partial = (
      await a.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })
    ).json() as EvalRunBatch;
    const settled = await waitForBatch(db, partial.id);
    expect(settled.status).toBe('partial');

    const batches = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.agentId, agentId))
      .orderBy(t.evalRunBatches.startedAt);

    const cmp = EvalRunComparison.parse(
      (
        await a.inject({
          method: 'GET',
          url: `/eval-runs/compare?a=${batches[0]!.id}&b=${partial.id}`,
        })
      ).json(),
    );

    // The incompleteness is on the BATCH, next to its metrics — `cases_ran <
    // cases_total` — and the case that did not run is `skipped`, never `fail`.
    expect(cmp.b.status).toBe('partial');
    expect(cmp.b.cases_ran).toBeLessThan(cmp.b.cases_total);
    expect(cmp.cases.filter((c) => c.after === 'skipped')).toHaveLength(1);

    await a.close();
  });

  it('comparing a batch from another workspace is a 404', async () => {
    const a = await app();
    const { db } = pg.handle;
    const [other] = await db.insert(t.workspaces).values({ name: 'elsewhere' }).returning();
    const [foreign] = await db
      .insert(t.evalRunBatches)
      .values({
        workspaceId: other!.id,
        agentId,
        agentVersion: 1,
        systemPromptSnapshot: 'p',
        modelSnapshot: 'm',
        providerSnapshot: 'openrouter',
        status: 'done',
      })
      .returning();
    const [mine] = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.agentId, agentId))
      .limit(1);

    const res = await a.inject({
      method: 'GET',
      url: `/eval-runs/compare?a=${mine!.id}&b=${foreign!.id}`,
    });
    expect(res.statusCode).toBe(404);
    await a.close();
  });
});
