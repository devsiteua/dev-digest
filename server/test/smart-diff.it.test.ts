/**
 * L03 — the Smart Diff end to end, against real Postgres and the seeded demo PR.
 *
 * Two things can only be proven here. The first is the JOIN: the classifier is
 * unit-tested, but nothing in a pure test says the route reaches the right nine
 * rows, or that "latest review" means what three other surfaces mean by it. The
 * second is the promise the feature is built on — that serving this endpoint
 * costs nothing — which is checked the only honest way: by making every model
 * provider throw and asking for a 200 anyway.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, notInArray } from 'drizzle-orm';
import type { LLMProvider } from '@devdigest/shared';
import { SmartDiff } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A provider that fails on every verb.
 *
 * Belt and braces, and deliberately so: `container.llm(id)` resolves a secret
 * before it builds anything, so an accidental model call in a key-free test
 * would already fail. That failure would be incidental — it would prove the test
 * environment has no keys, not that the endpoint makes no call. This override
 * makes the claim explicit.
 */
function throwingLLM(id: LLMProvider['id']): LLMProvider {
  const boom = (): never => {
    throw new Error(`smart-diff must not call a model (${id})`);
  };
  return {
    id,
    listModels: boom,
    complete: boom,
    completeStructured: boom,
    embed: boom,
  };
}

d('L03 smart diff (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    prId = pr!.id;

    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: {
          openai: throwingLLM('openai'),
          anthropic: throwingLLM('anthropic'),
          openrouter: throwingLLM('openrouter'),
        },
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const get = async (id: string) =>
    app.inject({ method: 'GET', url: `/pulls/${id}/smart-diff` });

  it('serves a body the contract accepts, with no model reachable', async () => {
    const res = await get(prId);
    expect(res.statusCode).toBe(200);
    expect(() => SmartDiff.parse(res.json())).not.toThrow();
  });

  it('groups the seeded nine files as core, wiring, boilerplate — in that order', async () => {
    const body = SmartDiff.parse((await get(prId)).json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);

    const byRole = Object.fromEntries(
      body.groups.map((g) => [g.role, g.files.map((f) => f.path)]),
    );
    expect(byRole.core).toContain('src/middleware/ratelimit.ts');
    expect(byRole.core).toContain('src/api/users.ts');
    expect(byRole.wiring).toContain('src/config.ts');
    expect(byRole.wiring).toContain('package.json');
    // The rule the assignment names, on the file it names it for.
    expect(byRole.boilerplate).toContain('package-lock.json');
    expect(byRole.boilerplate).toContain('test/ratelimit.test.ts');

    // Nothing is dropped and nothing is counted twice.
    const seen = body.groups.flatMap((g) => g.files.map((f) => f.path));
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
  });

  it('puts the file with the most findings first inside its group', async () => {
    const body = SmartDiff.parse((await get(prId)).json());
    const core = body.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.path).toBe('src/middleware/ratelimit.ts');
  });

  it('carries the seeded finding lines, and only for the files that have them', async () => {
    const body = SmartDiff.parse((await get(prId)).json());
    const lines = Object.fromEntries(
      body.groups.flatMap((g) => g.files.map((f) => [f.path, f.finding_lines])),
    );
    expect(lines['src/config.ts']).toEqual([12]);
    expect(lines['src/api/public/webhooks.ts']).toEqual([61]);
    expect(lines['src/api/users.ts']).toEqual([45]);
    expect(lines['src/middleware/ratelimit.ts']).toEqual([28]);
    expect(lines['package-lock.json']).toEqual([]);
    expect(lines['src/server.ts']).toEqual([]);
  });

  it('reports the PR size without proposing a split for it', async () => {
    const body = SmartDiff.parse((await get(prId)).json());
    // 247 additions + 36 deletions across the nine seeded files.
    expect(body.split_suggestion.total_lines).toBe(283);
    expect(body.split_suggestion.too_big).toBe(false);
    expect(body.split_suggestion.proposed_splits).toEqual([]);
  });

  it('reads the LATEST review only — an older one does not leak its findings', async () => {
    // Older by an hour AND inserted second, so nothing but the timestamp rule can
    // be what excludes it.
    const [older] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId: (
          await pg.handle.db.select().from(t.workspaces).limit(1)
        )[0]!.id,
        prId,
        kind: 'review',
        verdict: 'comment',
        summary: 'an earlier pass',
        score: 80,
        model: 'seed-older',
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      })
      .returning();
    await pg.handle.db.insert(t.findings).values({
      reviewId: older!.id,
      file: 'src/server.ts',
      startLine: 22,
      endLine: 22,
      severity: 'WARNING',
      category: 'style',
      title: 'from a superseded review',
      rationale: 'It must not appear in the smart diff.',
      confidence: 0.7,
    });

    const body = SmartDiff.parse((await get(prId)).json());
    const lines = Object.fromEntries(
      body.groups.flatMap((g) => g.files.map((f) => [f.path, f.finding_lines])),
    );
    expect(lines['src/server.ts']).toEqual([]);
    expect(lines['src/config.ts']).toEqual([12]);

    await pg.handle.db.delete(t.reviews).where(eq(t.reviews.id, older!.id));
  });

  it('groups and orders a PR nobody has reviewed, with every finding_lines empty', async () => {
    // The degraded path is the NORMAL path on a fresh PR: files but no review.
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    const [ws] = await pg.handle.db.select().from(t.workspaces).limit(1);
    const [fresh] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws!.id,
        repoId: repo!.id,
        number: 998,
        title: 'Never reviewed',
        author: 'nobody',
        branch: 'feat/fresh',
        base: 'main',
        headSha: 'cafebabe',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values([
      { prId: fresh!.id, path: 'src/pay/charge.ts', additions: 40, deletions: 2, patch: null },
      { prId: fresh!.id, path: 'pnpm-lock.yaml', additions: 300, deletions: 12, patch: null },
    ]);

    const body = SmartDiff.parse((await get(fresh!.id)).json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
    expect(body.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(
      true,
    );

    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, fresh!.id));
  });

  it('answers 404 for a PR that does not exist', async () => {
    const res = await get('00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBeDefined();
  });

  it('answers 422 for an id that is not a uuid, before any query runs', async () => {
    const res = await get('not-a-uuid');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('groups nothing, and does not fail, for a PR whose files were never fetched', async () => {
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    const [ws] = await pg.handle.db.select().from(t.workspaces).limit(1);
    const [bare] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws!.id,
        repoId: repo!.id,
        number: 999,
        title: 'Imported, never opened',
        author: 'nobody',
        branch: 'chore/imported',
        base: 'main',
        headSha: 'deadbeef',
      })
      .returning();

    const body = SmartDiff.parse((await get(bare!.id)).json());
    expect(body.groups).toEqual([]);
    expect(body.split_suggestion).toEqual({
      too_big: false,
      total_lines: 0,
      proposed_splits: [],
    });

    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, bare!.id));
  });

  it('converges a database still in the PRE-L03 state, columns included', async () => {
    // Re-seeding a database this same test just seeded proves almost nothing:
    // every row is already correct, so an insert-only backfill — or one that
    // forgets `patch` — passes. The state the backfill exists for is the old
    // one, so the test builds it: the four files the seed shipped before L03,
    // with no patch, and the PR row carrying the design's original numbers.
    const keep = [
      'src/middleware/ratelimit.ts',
      'src/api/public/webhooks.ts',
      'src/config.ts',
      'src/api/users.ts',
    ];
    await pg.handle.db
      .delete(t.prFiles)
      .where(and(eq(t.prFiles.prId, prId), notInArray(t.prFiles.path, keep)));
    await pg.handle.db
      .update(t.prFiles)
      .set({ patch: null })
      .where(eq(t.prFiles.prId, prId));
    await pg.handle.db
      .update(t.pullRequests)
      .set({ additions: 247, deletions: 38, filesCount: 9 })
      .where(eq(t.pullRequests.id, prId));

    await seed(pg.handle.db);

    const rows = await pg.handle.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
    // Nine rows, not four and not eighteen: the five missing ones were inserted
    // and the four that were already there were not duplicated.
    expect(rows).toHaveLength(9);
    // And the COLUMNS converged, which the row count cannot tell you: the four
    // pre-L03 rows had no patch, and a findings badge with nothing to scroll to
    // is the bug this backfill exists to prevent.
    const config = rows.find((r) => r.path === 'src/config.ts')!;
    expect(config.patch).toContain('@@ -10,4 +10,8 @@');
    expect(rows.filter((r) => r.patch !== null)).toHaveLength(8);

    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.id, prId)));
    expect(pr!.filesCount).toBe(9);
    expect(pr!.additions).toBe(247);
    // 38 was the design header's number and 36 is what its file list sums to;
    // this assertion is the one that fails if the recompute stops running.
    expect(pr!.deletions).toBe(36);
  });
});
