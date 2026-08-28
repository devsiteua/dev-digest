/**
 * L04 — the Blast Radius end to end, against real Postgres.
 *
 * Three things can only be proven here. The JOIN: the helpers are unit-tested,
 * but nothing pure says the route reaches the right symbols, the right resolved
 * callers and the right `file_facts`. The DEPTH: that an endpoint TWO import
 * hops from the changed file arrives, which is the whole difference between a
 * reverse traversal and a one-hop lookup dressed up as one. And the promise the
 * feature is built on — that serving this costs nothing — checked the only
 * honest way, by making every model provider throw and asking for a 200 anyway.
 *
 * The graph below is seeded by hand rather than indexed from a clone: the route
 * must answer from the tables whatever wrote them, and a test that ran the
 * indexer would be testing the indexer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProvider } from '@devdigest/shared';
import { BlastRadiusResponse } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[blast] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INDEXED_SHA = 'b1a57ffe0000000000000000000000000000cafe';

/** A provider that fails on every verb — see `smart-diff.it.test.ts` for why. */
function throwingLLM(id: LLMProvider['id']): LLMProvider {
  const boom = (): never => {
    throw new Error(`blast must not call a model (${id})`);
  };
  return { id, listModels: boom, complete: boom, completeStructured: boom, embed: boom };
}

d('L04 blast radius (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let repoId: string;
  let workspaceId: string;
  let prId: string;
  /** A pull request whose one file declares nothing the index knows. */
  let unknownFilePrId: string;
  /** A pull request with no `pr_files` rows at all. */
  let emptyPrId: string;
  /** A pull request on a repository that was never indexed. */
  let unindexedPrId: string;

  const changed = 'src/middleware/ratelimit.ts';

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    const [ws] = await pg.handle.db.select().from(t.workspaces).limit(1);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    repoId = repo!.id;
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    prId = pr!.id;

    await pg.handle.db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: INDEXED_SHA,
      indexerVersion: 2,
      status: 'full',
      filesIndexed: 6,
      filesSkipped: 0,
    });

    // The changed file declares two symbols; `src/api/users.ts` is also in the
    // PR and declares one that nothing calls.
    await pg.handle.db.insert(t.symbols).values([
      { repoId, path: changed, name: 'rateLimit', kind: 'function', line: 12, endLine: 40, exported: true },
      { repoId, path: changed, name: 'bucketKey', kind: 'function', line: 44, endLine: 52, exported: true },
      { repoId, path: 'src/api/users.ts', name: 'listUsers', kind: 'function', line: 8, endLine: 20, exported: true },
      // Enclosing symbols of the caller files, so a caller is named by the
      // function it sits in rather than by its file's basename.
      { repoId, path: 'src/api/public/index.ts', name: 'publicRouter', kind: 'function', line: 18, endLine: 40, exported: true },
      { repoId, path: 'src/jobs/reset-buckets.ts', name: 'resetBuckets', kind: 'function', line: 4, endLine: 14, exported: true },
    ]);

    // Resolved references. `decl_file` is set directly: resolving it is the
    // indexer's job and is covered by its own suite.
    await pg.handle.db.insert(t.references).values([
      { repoId, fromPath: 'src/api/public/index.ts', toSymbol: 'rateLimit', line: 23, declFile: changed },
      { repoId, fromPath: 'test/ratelimit.test.ts', toSymbol: 'rateLimit', line: 9, declFile: changed },
      { repoId, fromPath: 'src/jobs/reset-buckets.ts', toSymbol: 'bucketKey', line: 8, declFile: changed },
      // Unresolved (decl_file NULL) — precision over recall: never a caller.
      { repoId, fromPath: 'src/api/users.ts', toSymbol: 'rateLimit', line: 3, declFile: null },
    ]);

    // `src/server.ts` imports the caller file — that is the second hop.
    await pg.handle.db.insert(t.fileEdges).values([
      { repoId, fromFile: 'src/api/public/index.ts', toFile: changed },
      { repoId, fromFile: 'test/ratelimit.test.ts', toFile: changed },
      { repoId, fromFile: 'src/jobs/reset-buckets.ts', toFile: changed },
      { repoId, fromFile: 'src/server.ts', toFile: 'src/api/public/index.ts' },
      { repoId, fromFile: 'test/public.test.ts', toFile: 'src/api/public/index.ts' },
      // THE DIRECTION CONTROL: the changed file DEPENDS ON this one. It is a
      // dependency, not a dependent, and it registers a route — so if the walk
      // is ever inverted, that route shows up in the map and the bug is visible
      // in one assertion instead of in a code review.
      { repoId, fromFile: changed, toFile: 'src/domain/models.ts' },
    ]);

    // `getResolvedCallers` INNER JOINs this table: a caller file with no rank
    // row is invisible, so every one of them needs one.
    await pg.handle.db.insert(t.fileRank).values(
      [
        [changed, 0.9],
        ['src/api/public/index.ts', 0.6],
        ['src/jobs/reset-buckets.ts', 0.4],
        ['test/ratelimit.test.ts', 0.2],
        ['src/server.ts', 0.5],
        ['test/public.test.ts', 0.2],
        ['src/domain/models.ts', 0.3],
      ].map(([filePath, rank]) => ({
        repoId,
        filePath: filePath as string,
        pagerank: rank as number,
        hotness: 0,
        rank: rank as number,
        percentile: 50,
      })),
    );

    await pg.handle.db.insert(t.fileFacts).values([
      { repoId, filePath: 'src/api/public/index.ts', endpoints: ['GET /api/public/items'], crons: [] },
      { repoId, filePath: 'src/server.ts', endpoints: ['GET /health'], crons: [] },
      { repoId, filePath: 'src/jobs/reset-buckets.ts', endpoints: [], crons: ['0 * * * *'] },
      // A test file that registers a route which exists nowhere in production
      // code. It must never enter the map.
      { repoId, filePath: 'test/ratelimit.test.ts', endpoints: ['POST /not-a-real-route'], crons: [] },
      { repoId, filePath: 'test/public.test.ts', endpoints: ['DELETE /not-a-real-route'], crons: [] },
      { repoId, filePath: 'src/domain/models.ts', endpoints: ['GET /a-dependency-not-a-dependent'], crons: [] },
    ]);

    // A PR whose one file the index has never heard of.
    unknownFilePrId = await insertPr(996, [{ path: 'docs/README.md', additions: 3, deletions: 0 }]);
    // A PR nobody has opened, so `GET /pulls/:id` never wrote its files.
    emptyPrId = await insertPr(997, []);

    // A second repository with no `repo_index_state` row at all.
    const [unindexed] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'no-index',
        fullName: 'acme/no-index',
        defaultBranch: 'main',
      })
      .returning();
    unindexedPrId = await insertPr(995, [{ path: 'src/a.ts', additions: 1, deletions: 0 }], unindexed!.id);

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
  }, 120_000);

  async function insertPr(
    number: number,
    files: { path: string; additions: number; deletions: number }[],
    onRepo?: string,
  ): Promise<string> {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: onRepo ?? repoId,
        number,
        title: `fixture #${number}`,
        author: 'nobody',
        branch: `feat/f${number}`,
        base: 'main',
        headSha: `head${number}`,
        status: 'open',
      })
      .returning();
    if (files.length > 0) {
      await pg.handle.db
        .insert(t.prFiles)
        .values(files.map((f) => ({ prId: pr!.id, ...f, patch: null })));
    }
    return pr!.id;
  }

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const get = async (id: string) => app.inject({ method: 'GET', url: `/pulls/${id}/blast` });
  const body = async (id: string) => {
    const res = await get(id);
    expect(res.statusCode).toBe(200);
    return BlastRadiusResponse.parse(res.json());
  };
  const impact = (map: Awaited<ReturnType<typeof body>>, symbol: string) =>
    map.downstream.find((d) => d.symbol === symbol)!;

  it('serves a body the contract accepts, with no model reachable', async () => {
    const map = await body(prId);
    expect(map.status).toBe('ok');
    expect(map.reason).toBeNull();
    expect(map.indexed_sha).toBe(INDEXED_SHA);
  });

  it('reports the symbols the changed files declare, and only those', async () => {
    const map = await body(prId);
    // Ordered by file then name, so two identical requests cannot disagree.
    // `publicRouter` and `listUsers` are here because `src/api/public/index.ts`
    // and `src/api/users.ts` are also files of the seeded pull request.
    expect(map.changed_symbols.map((s) => `${s.file}:${s.name}`)).toEqual([
      'src/api/public/index.ts:publicRouter',
      'src/api/users.ts:listUsers',
      'src/middleware/ratelimit.ts:bucketKey',
      'src/middleware/ratelimit.ts:rateLimit',
    ]);
  });

  it('attributes each caller to the symbol it actually reaches', async () => {
    const map = await body(prId);
    expect(impact(map, 'rateLimit').callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/api/public/index.ts:23',
      'test/ratelimit.test.ts:9',
    ]);
    expect(impact(map, 'bucketKey').callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/jobs/reset-buckets.ts:8',
    ]);
    expect(impact(map, 'listUsers').callers).toEqual([]);
  });

  it('names a caller by its enclosing function', async () => {
    const map = await body(prId);
    expect(impact(map, 'rateLimit').callers[0]!.name).toBe('publicRouter');
  });

  it('never asserts an unresolved reference as a caller', async () => {
    const map = await body(prId);
    const files = map.downstream.flatMap((d) => d.callers.map((c) => c.file));
    expect(files).not.toContain('src/api/users.ts');
  });

  it('reaches an endpoint TWO import hops away — the traversal is real', async () => {
    const map = await body(prId);
    const endpoints = impact(map, 'rateLimit').endpoints_affected;
    // One hop: the caller file's own route.
    expect(endpoints).toContain('GET /api/public/items');
    // Two hops: `src/server.ts` imports that caller file. A one-hop lookup
    // dressed up as a traversal would stop before this line.
    expect(endpoints).toContain('GET /health');
  });

  it('reads no endpoint off a test file, at either level', async () => {
    const map = await body(prId);
    const everything = JSON.stringify(map);
    expect(everything).not.toContain('/not-a-real-route');
  });

  it("carries a cron only for the symbol whose caller schedules it", async () => {
    const map = await body(prId);
    expect(impact(map, 'bucketKey').crons_affected).toEqual(['0 * * * *']);
    expect(impact(map, 'rateLimit').crons_affected).toEqual([]);
  });

  it('walks OUTWARD to dependents, never inward to dependencies', async () => {
    const map = await body(prId);
    // `src/domain/models.ts` is what the changed file IMPORTS, and it registers
    // a route. It is reachable in exactly one direction, and that direction is
    // the wrong one.
    expect(JSON.stringify(map)).not.toContain('/a-dependency-not-a-dependent');
  });

  it('answers a PR whose files declare no indexed symbol with a reason, not an empty map', async () => {
    const map = await body(unknownFilePrId);
    expect(map).toMatchObject({ status: 'ok', reason: 'no_indexed_symbols', indexed_sha: INDEXED_SHA });
    expect(map.changed_symbols).toEqual([]);
    expect(map.summary).toContain('1 changed file');
  });

  it('answers a PR with no recorded files with its own reason', async () => {
    const map = await body(emptyPrId);
    expect(map).toMatchObject({ status: 'ok', reason: 'no_changed_files' });
    expect(map.summary).toContain('Files tab');
  });

  it('answers an unindexed repository as degraded, and says so out loud', async () => {
    const map = await body(unindexedPrId);
    expect(map).toMatchObject({ status: 'degraded', reason: 'index_missing', indexed_sha: null });
    expect(map.summary).toContain('not a claim that the pull request affects nothing');
  });

  it("reports a partial index as partial, with the map it does have", async () => {
    await pg.handle.db
      .update(t.repoIndexState)
      .set({ status: 'partial' })
      .where(eq(t.repoIndexState.repoId, repoId));
    try {
      const map = await body(prId);
      expect(map.status).toBe('partial');
      expect(map.reason).toBe('index_partial');
      // The point of `partial` rather than `degraded`: the map is still served.
      expect(impact(map, 'rateLimit').callers.length).toBeGreaterThan(0);
      expect(map.summary).toContain('some callers may be missing');
    } finally {
      await pg.handle.db
        .update(t.repoIndexState)
        .set({ status: 'full' })
        .where(eq(t.repoIndexState.repoId, repoId));
    }
  });

  describe('the optional explanation', () => {
    let explainApp: Awaited<ReturnType<typeof buildApp>>;
    let calls: number;

    beforeAll(async () => {
      calls = 0;
      const counting = (id: LLMProvider['id']): LLMProvider => {
        const boom = (): never => {
          throw new Error(`explain uses completeStructured only (${id})`);
        };
        return {
          id,
          listModels: boom,
          complete: boom,
          embed: boom,
          completeStructured: (async () => {
            calls += 1;
            return {
              data: { explanation: 'Two exported authorization checks now reach four routes.' },
              tokensIn: 420,
              tokensOut: 38,
              costUsd: 0.00012,
            };
          }) as unknown as LLMProvider['completeStructured'],
        };
      };
      explainApp = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          llm: {
            openai: counting('openai'),
            anthropic: counting('anthropic'),
            openrouter: counting('openrouter'),
          },
        },
      });
    }, 60_000);

    afterAll(async () => {
      await explainApp?.close();
    });

    it('makes EXACTLY one model call, and the GET beside it makes none', async () => {
      calls = 0;
      // The same app, so a model reached from the GET would be counted here.
      const read = await explainApp.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(read.statusCode).toBe(200);
      expect(calls, 'the map costs nothing').toBe(0);

      const res = await explainApp.inject({
        method: 'POST',
        url: `/pulls/${prId}/blast/explain`,
      });
      expect(res.statusCode).toBe(200);
      expect(calls, 'exactly one call, never two').toBe(1);

      const explained = res.json() as Record<string, unknown>;
      expect(explained.explanation).toContain('authorization checks');
      expect(explained.indexed_sha).toBe(INDEXED_SHA);
      expect(explained.tokens_in).toBe(420);
    });

    it('refuses a map with nothing in it rather than paying to describe it', async () => {
      calls = 0;
      const res = await explainApp.inject({
        method: 'POST',
        url: `/pulls/${unindexedPrId}/blast/explain`,
      });
      expect(res.statusCode).toBe(409);
      expect(calls, 'no model is asked to dress up "we could not look"').toBe(0);
    });
  });

  it('404s for a pull request that does not exist, and only for that', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/blast',
    });
    expect(res.statusCode).toBe(404);
  });
});
