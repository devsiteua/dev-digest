/**
 * GET /pulls/:id refreshes the persisted files/commits snapshot from GitHub.
 * The refresh replaces both sets wholesale, so it runs inside one transaction:
 * without it, a failure after the DELETE leaves the PR with an empty snapshot
 * and the route's own catch block then serves that emptiness as if it were the
 * persisted detail. Gated on Docker, like the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrDetail } from '@devdigest/shared';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const OLD_FILE = 'src/previously-imported.ts';
const OLD_SHA = 'oldsha0';

let repoSeq = 0;

/** A PR that already carries a persisted snapshot — one file, one commit. */
async function setupPrWithSnapshot(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `refresh-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  await db
    .insert(t.prFiles)
    .values({ prId: pr!.id, path: OLD_FILE, additions: 3, deletions: 1, patch: null });
  await db
    .insert(t.prCommits)
    .values({ prId: pr!.id, sha: OLD_SHA, message: 'earlier import', author: 'someone' });
  return { repo: repo!, pr: pr! };
}

/**
 * Returns a payload whose commit violates `pr_commits.message NOT NULL`, so the
 * INSERT fails *after* both DELETEs have run — the exact window the transaction
 * exists to close.
 */
class BrokenCommitGitHub extends MockGitHubClient {
  override async getPullRequest(
    ...args: Parameters<MockGitHubClient['getPullRequest']>
  ): Promise<PrDetail> {
    const detail = await super.getPullRequest(...args);
    return {
      ...detail,
      files: [{ path: 'src/replacement.ts', additions: 1, deletions: 0, patch: null }],
      commits: [
        {
          sha: 'newsha0',
          message: null as unknown as string,
          author: 'someone',
          committed_at: null,
        },
      ],
    };
  }
}

d('GET /pulls/:id detail refresh (Testcontainers pg)', () => {
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

  it('replaces the persisted files and commits with the GitHub payload', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    const { pr } = await setupPrWithSnapshot(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as PrDetail;
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.files.map((f) => f.path)).not.toContain(OLD_FILE);

    const rows = await pg.handle.db
      .select()
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, pr.id));
    expect(rows.map((r) => r.path)).not.toContain(OLD_FILE);
    expect(rows).toHaveLength(body.files.length);
  });

  it('keeps the previous snapshot when the refresh fails part-way through', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new BrokenCommitGitHub() },
    });
    const { pr } = await setupPrWithSnapshot(pg.handle.db, workspaceId);

    // The route swallows a failed refresh and serves the persisted detail.
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(res.statusCode).toBe(200);

    // Everything the transaction touched must be back where it started: the old
    // file is still here and was not replaced, and the commit was not wiped.
    // Without the transaction the DELETEs would have committed on their own and
    // both assertions below would fail.
    const body = res.json() as PrDetail;
    expect(body.files.map((f) => f.path)).toEqual([OLD_FILE]);
    expect(body.commits.map((c) => c.sha)).toEqual([OLD_SHA]);

    const files = await pg.handle.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
    const commits = await pg.handle.db
      .select()
      .from(t.prCommits)
      .where(eq(t.prCommits.prId, pr.id));
    expect(files.map((f) => f.path)).toEqual([OLD_FILE]);
    expect(commits.map((c) => c.sha)).toEqual([OLD_SHA]);
  });
});
