/**
 * A decided finding becomes a frozen case.
 *
 * The lane runs on the SEEDED workspace, because the seed is what leaves exactly
 * two decided-but-un-cased findings — one accepted, one dismissed — and those are
 * the fixtures "create a case" and "do not create a second" need. Two cases here
 * bring their own fixtures instead: AC-06 fabricates an oversized pull request,
 * and AC-30 inserts a review with no agent, because the seed's own backfill
 * removes the last agent-less review in the workspace.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockEmbedder } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { EvalExpectation, type EvalCase } from '@devdigest/shared';
import { MAX_INPUT_DIFF_CHARS } from '../src/modules/evals/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('L06 eval cases (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const r = await seed(pg.handle.db);
    workspaceId = r.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * `diff: ''` is deliberate and load-bearing. `loadDiff` prefers a real
   * `git diff` and only falls back to the persisted `pr_files` patches when the
   * git result has no files — and the pr_files path is the one the SEED used, so
   * an empty mock diff is what makes a created case and a seeded case comparable
   * at all (AC-11). The mock's DEFAULT diff would silently freeze a
   * three-line `src/config.ts` instead of the whole pull request.
   */
  const app = () =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
      },
    });

  const demoReview = async () => {
    const [row] = await pg.handle.db
      .select()
      .from(t.reviews)
      .where(eq(t.reviews.model, 'seed'));
    return row!;
  };

  /** The seeded findings that carry a decision but no case — one of each kind. */
  const uncased = async () => {
    const review = await demoReview();
    const findings = await pg.handle.db
      .select()
      .from(t.findings)
      .where(eq(t.findings.reviewId, review.id));
    const cases = await pg.handle.db.select().from(t.evalCases);
    const cased = new Set(
      cases.map((c) => (c.inputMeta as { source_finding_id: string }).source_finding_id),
    );
    const rest = findings.filter((f) => !cased.has(f.id));
    return {
      accepted: rest.find((f) => f.acceptedAt !== null)!,
      dismissed: rest.find((f) => f.dismissedAt !== null)!,
      review,
    };
  };

  const countCases = async () => (await pg.handle.db.select().from(t.evalCases)).length;

  /**
   * Every test that CREATES a case removes it again.
   *
   * The whole file shares one database and one seed, and the two un-cased
   * findings are a fixture of exactly size one per kind — the first test to keep
   * its case would leave every later test with `undefined` where it expected an
   * accepted finding. Restoring is cheaper and more honest than re-seeding.
   */
  const dropCase = async (id: string) =>
    pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.id, id));

  it('AC-02: an accepted finding becomes a must_find case owned by the review’s agent', async () => {
    const a = await app();
    const { accepted, review } = await uncased();

    const res = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: accepted.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as EvalCase;

    expect(body.owner_kind).toBe('agent');
    expect(body.owner_id).toBe(review.agentId);
    expect(EvalExpectation.parse(body.expected_output)).toEqual({
      kind: 'must_find',
      file: accepted.file,
      start_line: accepted.startLine,
      end_line: accepted.endLine,
    });
    await dropCase(body.id);
    await a.close();
  });

  it('AC-02: a dismissed finding becomes a must_not_flag case', async () => {
    const a = await app();
    const { dismissed } = await uncased();

    const res = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: dismissed.id },
    });
    expect(res.statusCode).toBe(201);
    expect(EvalExpectation.parse((res.json() as EvalCase).expected_output).kind).toBe(
      'must_not_flag',
    );
    await dropCase((res.json() as EvalCase).id);
    await a.close();
  });

  it('AC-04: a second call returns the same case instead of creating another', async () => {
    const a = await app();
    const { accepted } = await uncased();

    const before = await countCases();
    const first = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: accepted.id },
    });
    const second = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: accepted.id },
    });

    expect((first.json() as EvalCase).id).toBe((second.json() as EvalCase).id);
    expect(await countCases()).toBe(before + 1);
    await dropCase((first.json() as EvalCase).id);
    await a.close();
  });

  it('AC-05 / AC-11: the frozen diff is the WHOLE pull request, and the same bytes the seed wrote', async () => {
    const a = await app();
    const { accepted } = await uncased();

    const created = (
      await a.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: accepted.id } })
    ).json() as EvalCase;

    // provenance, and no foreign key anywhere near it
    const meta = created.input_meta as { source_finding_id: string; created_from: string };
    expect(meta.source_finding_id).toBe(accepted.id);
    expect(meta.created_from).toBe('finding');

    // The whole PR: every file the seed gave a patch shows up in the snapshot,
    // not just the one the finding points at.
    expect(created.input_diff).toContain('src/middleware/ratelimit.ts');
    expect(created.input_diff).toContain('src/api/users.ts');
    expect(created.input_diff).toContain('package.json');

    // AC-11 — the seed and the service assemble through ONE serialiser, so a
    // seeded case and a created case over the same PR are byte-identical.
    const [seeded] = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(isNotNull(t.evalCases.inputDiff));
    expect(created.input_diff).toBe(seeded!.inputDiff);
    await dropCase(created.id);
    await a.close();
  });

  it('AC-06: an oversized pull request is refused, and nothing is written', async () => {
    const a = await app();
    const { db } = pg.handle;

    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'big', name: 'diff', fullName: 'big/diff' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'huge',
        author: 'x',
        branch: 'b',
        base: 'main',
        headSha: 'deadbeef',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/huge.ts',
      additions: 1,
      deletions: 0,
      patch: `@@ -1,1 +1,2 @@\n context\n+${'x'.repeat(MAX_INPUT_DIFF_CHARS + 1000)}`,
    });
    const [agent] = await db.select().from(t.agents).limit(1);
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: agent!.id,
        kind: 'review',
        verdict: 'comment',
        summary: 's',
        score: 1,
        model: 'm',
      })
      .returning();
    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/huge.ts',
        startLine: 2,
        endLine: 2,
        severity: 'WARNING',
        category: 'bug',
        title: 'huge',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();

    const before = await countCases();
    const res = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: finding!.id },
    });

    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('eval_case_diff_too_large');
    // the limit is NAMED, so the user can act on it rather than guess
    expect(res.json().error.message).toContain(String(MAX_INPUT_DIFF_CHARS));
    expect(await countCases()).toBe(before);
    await a.close();
  });

  it('AC-07: deleting the pull request leaves the case standing', async () => {
    const a = await app();
    const { db } = pg.handle;

    // Its OWN pull request, because the assertion is destructive: deleting the
    // seeded PR would cascade through its review and take the ten decided
    // findings — and therefore every other test in this file — with it.
    const review = await demoReview();
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'gone', name: 'soon', fullName: 'gone/soon' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'about to be deleted',
        author: 'x',
        branch: 'b',
        base: 'main',
        headSha: 'cafe',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/gone.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -1,1 +1,2 @@\n context\n+added',
    });
    const [ownReview] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: review.agentId,
        kind: 'review',
        verdict: 'comment',
        summary: 's',
        score: 1,
        model: 'm',
      })
      .returning();
    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: ownReview!.id,
        file: 'src/gone.ts',
        startLine: 2,
        endLine: 2,
        severity: 'WARNING',
        category: 'bug',
        title: 'on a PR that will not survive this test',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();

    const created = (
      await a.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: finding!.id } })
    ).json() as EvalCase;

    // Cascades through reviews → findings. The case has no FK to any of them.
    await db.delete(t.pullRequests).where(eq(t.pullRequests.id, pr!.id));
    expect(
      await db.select().from(t.findings).where(eq(t.findings.id, finding!.id)),
    ).toHaveLength(0);

    const listed = (
      await a.inject({ method: 'GET', url: `/agents/${review.agentId}/eval-cases` })
    ).json() as EvalCase[];
    expect(listed.map((c) => c.id)).toContain(created.id);
    // and it still carries the frozen input, which is the whole point
    expect(listed.find((c) => c.id === created.id)!.input_diff.length).toBeGreaterThan(0);

    await dropCase(created.id);
    await a.close();
  });

  it('AC-08: deleting a case takes its eval_runs rows with it', async () => {
    const a = await app();
    const { db } = pg.handle;

    const [aCase] = await db.select().from(t.evalCases).limit(1);
    const [batch] = await db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        agentId: aCase!.ownerId,
        systemPromptSnapshot: 'p',
        modelSnapshot: 'm',
        providerSnapshot: 'openrouter',
        agentVersion: 1,
        status: 'done',
      })
      .returning();
    await db.insert(t.evalRuns).values({
      caseId: aCase!.id,
      batchId: batch!.id,
      status: 'passed',
    });

    const res = await a.inject({ method: 'DELETE', url: `/eval-cases/${aCase!.id}` });
    expect(res.statusCode).toBe(204);

    const runs = await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, aCase!.id));
    expect(runs).toHaveLength(0);
    await a.close();
  });

  it('AC-30: a finding whose review names no agent is refused, and nothing is written', async () => {
    const a = await app();
    const { db } = pg.handle;

    // The lane brings its OWN fixture. The seed backfills `agent_id` on every
    // agent-less review it can see, so reading one out of seeded data would be
    // reading a row the step this lane depends on has just removed.
    const [pull] = await db.select().from(t.pullRequests).limit(1);
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pull!.id,
        // agentId deliberately omitted — the column is nullable
        kind: 'review',
        verdict: 'comment',
        summary: 'written before any agent existed',
        score: 50,
        model: 'legacy',
      })
      .returning();
    expect(review!.agentId).toBeNull();

    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'ownerless',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();

    // Counted on BOTH sides of the request, not merely "no new row for this one".
    const before = await countCases();
    const res = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: finding!.id },
    });
    const after = await countCases();

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('eval_case_no_owner');
    expect(res.json().error.message).toMatch(/agent/i);
    expect(after).toBe(before);

    await db.delete(t.reviews).where(eq(t.reviews.id, review!.id));
    await a.close();
  });

  it('AC-03’s server half: an undecided finding has nothing to assert', async () => {
    const a = await app();
    const { db } = pg.handle;
    const review = await demoReview();

    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review.id,
        file: 'src/config.ts',
        startLine: 13,
        endLine: 13,
        severity: 'WARNING',
        category: 'bug',
        title: 'nobody has decided this yet',
        rationale: 'r',
        confidence: 0.9,
      })
      .returning();

    const before = await countCases();
    const res = await a.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { finding_id: finding!.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('eval_case_not_decided');
    expect(await countCases()).toBe(before);

    await db.delete(t.findings).where(eq(t.findings.id, finding!.id));
    await a.close();
  });

  it('scopes every read by workspace: an agent from another workspace is a 404', async () => {
    const a = await app();
    const { db } = pg.handle;
    const [other] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
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

    const res = await a.inject({ method: 'GET', url: `/agents/${agent!.id}/eval-cases` });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it('sanity: the seed left no agent-less review for AC-30 to have borrowed', async () => {
    const rows = await pg.handle.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(eq(t.reviews.model, 'seed'), isNull(t.reviews.agentId)));
    expect(rows).toHaveLength(0);
  });
});
