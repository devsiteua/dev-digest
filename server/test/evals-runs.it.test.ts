/**
 * A run is a batch over the frozen set, and a failed case is not a failed run.
 *
 * Everything here runs against `MockLLMProvider`, which is the point: the
 * numbers are produced by arithmetic over a fixture, so what is being asserted
 * is the PIPELINE — what gets snapshotted, what gets refused, what a partial
 * batch reports — and never the model's judgement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForBatch } from './helpers/evals.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient, MockGitHubClient, MockEmbedder } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { MAX_CASES_PER_RUN } from '../src/modules/evals/constants.js';
import type { EvalRunBatch, EvalRunBatchDetail, Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * One finding, on `src/config.ts:12`.
 *
 * That line is inside a real hunk of the seeded PR, so it survives grounding —
 * and it is the expectation of exactly ONE of the eight seeded cases. So the
 * batch comes back mixed on purpose: some cases pass, some miss, and the
 * denominators are visible rather than saturated at 0 or 1.
 */
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

d('L06 eval runs (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    const r = await seed(pg.handle.db);
    workspaceId = r.workspaceId;
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'General Reviewer'));
    agentId = agent!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** The seeded agents run on `openrouter`, so that is the slot to stand in. */
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

  const start = async (a: Awaited<ReturnType<typeof app>>) =>
    a.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });

  it('AC-15: the POST returns before the batch is finished, and the state is readable', async () => {
    const a = await app();

    const res = await start(a);
    expect(res.statusCode).toBe(202);
    const batch = res.json() as EvalRunBatch;

    // The answer is the OPEN batch, not the results. Holding the request until
    // every case has run is what this shape exists to avoid.
    expect(batch.status).toBe('running');
    expect(batch.cases_total).toBe(8);
    expect(batch.finished_at).toBeNull();

    // …and the state is readable from the second endpoint, which is what makes
    // the fire-and-forget survivable across a page reload.
    const settled = await waitForBatch(pg.handle.db, batch.id);
    expect(settled.status).toBe('done');

    const detail = (
      await a.inject({ method: 'GET', url: `/eval-runs/${batch.id}` })
    ).json() as EvalRunBatchDetail;
    expect(detail.batch.id).toBe(batch.id);
    expect(detail.runs).toHaveLength(8);
    expect(detail.runs.every((r) => r.case_name !== null)).toBe(true);

    await a.close();
  });

  it('AC-20: the three ratios are persisted WITH their denominators', async () => {
    const a = await app();
    const batch = (await start(a)).json() as EvalRunBatch;
    const settled = await waitForBatch(pg.handle.db, batch.id);

    // Five of the eight seeded cases are `must_find`; the fixture lands on
    // exactly one of them. The denominators are what make that legible — a bare
    // "0.2" says nothing about the size of the set it came from.
    expect(settled.recallDenominator).toBe(5);
    expect(settled.recall).toBeCloseTo(1 / 5, 6);

    // Precision counts only what the SET has an opinion about: the one finding
    // that landed on a `must_find` range, plus any that landed on a
    // `must_not_flag` one. The fixture reports eight findings in total — one per
    // case — but seven of them sit on lines nobody ever accepted or dismissed,
    // and an unjudged finding is not a false positive. Were they charged here,
    // precision would read 1/8 and would move whenever the model got chattier,
    // which is the opposite of a regression signal.
    expect(settled.precisionDenominator).toBe(1);
    expect(settled.precision).toBeCloseTo(1, 6);

    // Every finding grounded, none dropped.
    expect(settled.citationDenominator).toBe(8);
    expect(settled.citationAccuracy).toBe(1);

    expect(settled.casesRan).toBe(8);
    expect(settled.casesTotal).toBe(8);

    const runs = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batch.id));
    expect(runs.filter((r) => r.status === 'passed')).toHaveLength(4);
    expect(runs.filter((r) => r.status === 'failed')).toHaveLength(4);
    // the per-case numerator/denominator behind recall, so a row reads alone
    expect(runs.every((r) => r.expectedCount !== null)).toBe(true);

    await a.close();
  });

  it('AC-10: two sequential runs snapshot the prompt each one actually ran under', async () => {
    const a = await app();
    const { db } = pg.handle;

    const [before] = await db.select().from(t.agents).where(eq(t.agents.id, agentId));
    const first = (await start(a)).json() as EvalRunBatch;
    await waitForBatch(db, first.id);

    const editedPrompt = `${before!.systemPrompt}\n\nAlso: never report style nits.`;
    await db
      .update(t.agents)
      .set({ systemPrompt: editedPrompt, version: before!.version + 1 })
      .where(eq(t.agents.id, agentId));

    const second = (await start(a)).json() as EvalRunBatch;
    await waitForBatch(db, second.id);

    // The two snapshots DIFFER, and each matches the prompt as it was at that
    // run's start — which is the whole basis for "which edit moved recall".
    expect(first.system_prompt_snapshot).toBe(before!.systemPrompt);
    expect(second.system_prompt_snapshot).toBe(editedPrompt);
    expect(first.system_prompt_snapshot).not.toBe(second.system_prompt_snapshot);
    expect(second.agent_version).toBe(first.agent_version + 1);

    // restore, so later cases in this file read the seeded prompt
    await db
      .update(t.agents)
      .set({ systemPrompt: before!.systemPrompt, version: before!.version })
      .where(eq(t.agents.id, agentId));
    await a.close();
  });

  it('AC-14: a case that throws is errored, and the batch finishes partial', async () => {
    // Fail the THIRD structured call. Per-call rather than per-schema, because
    // every case in a batch uses the same schema — the existing per-schemaName
    // throw could only fail all eight or none.
    const a = await app(
      new MockLLMProvider('openai', {
        structured: REVIEW_FIXTURE,
        failStructuredOnCall: [3],
      }),
    );

    const batch = (await start(a)).json() as EvalRunBatch;
    const settled = await waitForBatch(pg.handle.db, batch.id);

    expect(settled.status).toBe('partial');
    // The honest denominator: seven cases produced a measurement, one did not.
    expect(settled.casesRan).toBe(7);
    expect(settled.casesTotal).toBe(8);

    const runs = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batch.id));
    const errored = runs.filter((r) => r.status === 'errored');
    expect(errored).toHaveLength(1);
    expect(errored[0]!.error).toContain('failing completeStructured call #3');
    // A case that threw produced nothing, so it is in no denominator: counting
    // it as a miss would report the provider's outage as the agent's recall.
    expect(errored[0]!.pass).toBeNull();
    expect(settled.recallDenominator).toBeLessThan(5);

    await a.close();
  });

  it('AC-13: a second run while one is in flight is refused, never queued', async () => {
    const a = await app();
    const { db } = pg.handle;

    // A batch left `running` — the state a real in-flight run is in. Inserted
    // directly so the assertion is about the INDEX rather than about winning a
    // race against a mock that finishes in milliseconds.
    const [running] = await db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        agentId,
        agentVersion: 1,
        systemPromptSnapshot: 'p',
        modelSnapshot: 'm',
        providerSnapshot: 'openrouter',
        casesTotal: 8,
      })
      .returning();
    expect(running!.status).toBe('running');

    const before = (await db.select().from(t.evalRunBatches)).length;
    const res = await start(a);
    const after = (await db.select().from(t.evalRunBatches)).length;

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('eval_run_already_running');
    expect(res.json().error.message).toMatch(/in flight/i);
    // refused, not queued — no row was created for the second request
    expect(after).toBe(before);

    await db.delete(t.evalRunBatches).where(eq(t.evalRunBatches.id, running!.id));
    await a.close();
  });

  it('AC-16: an agent with more than 50 cases is refused, with the limit named', async () => {
    const a = await app();
    const { db } = pg.handle;

    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Overloaded',
        provider: 'openrouter',
        model: 'm',
        systemPrompt: 'p',
      })
      .returning();
    await db.insert(t.evalCases).values(
      Array.from({ length: MAX_CASES_PER_RUN + 1 }, (_, i) => ({
        workspaceId,
        ownerKind: 'agent' as const,
        ownerId: agent!.id,
        name: `case ${i}`,
        inputDiff: '',
        inputMeta: null,
        expectedOutput: { kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 1 },
      })),
    );

    const res = await a.inject({ method: 'POST', url: `/agents/${agent!.id}/eval-runs` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('eval_run_too_many_cases');
    expect(res.json().error.message).toContain(String(MAX_CASES_PER_RUN));
    // refused before anything was opened
    const batches = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.agentId, agent!.id));
    expect(batches).toHaveLength(0);

    await a.close();
  });

  it('AC-28: a skill-owned case is never folded into an agent’s run', async () => {
    const a = await app();
    const { db } = pg.handle;

    const [skillCase] = await db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'skill',
        // deliberately the AGENT's id under a `skill` owner_kind: the filter has
        // to read `owner_kind`, not merely match the id
        ownerId: agentId,
        name: 'owned by a skill',
        inputDiff: '',
        inputMeta: null,
        expectedOutput: { kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 1 },
      })
      .returning();

    const batch = (await start(a)).json() as EvalRunBatch;
    expect(batch.cases_total).toBe(8);
    const settled = await waitForBatch(db, batch.id);
    expect(settled.casesRan).toBe(8);

    const runs = await db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batch.id));
    expect(runs.map((r) => r.caseId)).not.toContain(skillCase!.id);

    await db.delete(t.evalCases).where(eq(t.evalCases.id, skillCase!.id));
    await a.close();
  });

  it('a run over an agent from another workspace is a 404', async () => {
    const a = await app();
    const { db } = pg.handle;
    const [other] = await db.insert(t.workspaces).values({ name: 'elsewhere' }).returning();
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId: other!.id,
        name: 'Outsider',
        provider: 'openrouter',
        model: 'm',
        systemPrompt: 'p',
      })
      .returning();

    const res = await a.inject({ method: 'POST', url: `/agents/${agent!.id}/eval-runs` });
    expect(res.statusCode).toBe(404);
    await a.close();
  });
});
