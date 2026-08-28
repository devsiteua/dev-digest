/**
 * GET /pulls/lookup — resolve GitHub's `owner/name` + PR number to the persisted
 * pull request, for callers that hold no DevDigest uuid.
 *
 * The route's whole reason to exist is that it answers OFFLINE, so the central
 * assertion here is a negative one: the container's GitHub client is a tripwire
 * that records and throws on any touch, and every case asserts it was never
 * touched. Gated on Docker (needs Postgres for the repo + PR rows), matching the
 * other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { PrMeta, type ApiErrorBody, type GitHubClient } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A GitHub client that fails the moment anything reaches for it. A mock that
 * quietly ANSWERS would let a GitHub round-trip slip into this route unnoticed,
 * which is exactly the regression the route exists to prevent.
 *
 * Proxied over the real `MockGitHubClient` (server/CLAUDE.md: use `mocks.ts`,
 * do not hand-roll mocks) so one trap covers every method, including ones added
 * later. `github` is a GETTER on the overrides object so that `container.github()`
 * is recorded even by a caller that swallows the throw — `GET /repos/:id/pulls`
 * does precisely that, and a silent catch would otherwise hide the call.
 */
function githubTripwire() {
  const touched: string[] = [];
  const client = new Proxy(new MockGitHubClient(), {
    get(_target, prop) {
      touched.push(String(prop));
      throw new Error(`GitHub client touched: ${String(prop)}`);
    },
  }) as GitHubClient;
  return {
    touched,
    overrides: {
      get github(): GitHubClient {
        touched.push('container.github()');
        return client;
      },
    },
  };
}

let repoSeq = 0;

async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { name?: string; number?: number } = {},
) {
  const name = opts.name ?? `looked-up-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: opts.number ?? 482,
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 247,
      deletions: 38,
      filesCount: 9,
      status: 'open',
      openedAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T03:00:00Z'),
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('GET /pulls/lookup (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('resolves owner/name#number to the persisted PR, and asks GitHub nothing', async () => {
    const gh = githubTripwire();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: gh.overrides });
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/lookup?repo=${repo.fullName}&number=${pr.number}`,
    });

    expect(res.statusCode).toBe(200);
    // The response is the PrMeta the list endpoint already returns — no new
    // contract was minted for this route, so nothing had to move in client/.
    const parsed = PrMeta.parse(res.json());
    expect(parsed.id).toBe(pr.id);
    expect(parsed.number).toBe(482);
    expect(parsed.title).toBe('Add rate limiting to public API endpoints');
    expect(parsed.head_sha).toBe('a1b2c3d4');
    expect(parsed.files_count).toBe(9);
    // Never reviewed → the derived review status, same rule as the list.
    expect(parsed.status).toBe('needs_review');
    // Review-derived fields are list-endpoint-only and stay absent here.
    expect(parsed.score).toBeUndefined();
    expect(parsed.findings_by_severity).toBeUndefined();
    expect(gh.touched).toEqual([]);
  });

  it('is not swallowed by /pulls/:id — the static segment wins', async () => {
    const gh = githubTripwire();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: gh.overrides });
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // `/pulls/:id` validates its param as a uuid, so if find-my-way routed
    // "lookup" there this would be a 422 validation error, not a PrMeta.
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/lookup?repo=${repo.fullName}&number=${pr.number}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: pr.id });

    // And the parametric route it shares a prefix with still answers.
    const detail = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ number: pr.number });
  });

  it('the tripwire is armed — the route this one replaces does trip it', async () => {
    // Without this, every `expect(gh.touched).toEqual([])` above could be
    // passing because the trap never fires at all. `GET /repos/:id/pulls` is the
    // route /pulls/lookup exists to avoid: it syncs from GitHub on every
    // request, so it must trip the same tripwire in the same app.
    const gh = githubTripwire();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: gh.overrides });
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const synced = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(synced.statusCode).toBe(200);
    expect(gh.touched).toContain('container.github()');
  });

  it('404s an unknown owner/name with the next step: add the repo', async () => {
    const gh = githubTripwire();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: gh.overrides });

    const res = await app.inject({ method: 'GET', url: '/pulls/lookup?repo=acme/nope&number=1' });

    expect(res.statusCode).toBe(404);
    const body = res.json() as ApiErrorBody;
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('acme/nope');
    expect(body.error.message).toContain('add the repo in DevDigest');
    // A missing repo must not become a reason to go ask GitHub about it.
    expect(gh.touched).toEqual([]);
  });

  it('404s an un-imported PR number with the next step: open the PR list', async () => {
    const gh = githubTripwire();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: gh.overrides });
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/lookup?repo=${repo.fullName}&number=99999`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json() as ApiErrorBody;
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('#99999');
    expect(body.error.message).toContain("open the repo's PR list");
    // The tempting "fix" is to import it from GitHub on the fly. This route
    // never does, which is why it works offline.
    expect(gh.touched).toEqual([]);
  });

  it('scopes both lookups by workspace', async () => {
    const gh = githubTripwire();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: gh.overrides });

    // Same owner/name and same PR number in a second workspace. `repos` is
    // unique on (workspace_id, full_name), so this collision is legal — and it
    // is the only shape that can prove the scoping, since an unscoped query
    // would return whichever row the planner reached first.
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant' })
      .returning();
    const name = `shared-${repoSeq++}`;
    const mine = await setupRepoAndPr(pg.handle.db, workspaceId, { name, number: 7 });
    const theirs = await setupRepoAndPr(pg.handle.db, other!.id, { name, number: 7 });
    expect(theirs.pr.id).not.toBe(mine.pr.id);

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/lookup?repo=acme/${name}&number=7`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: mine.pr.id });
    expect(gh.touched).toEqual([]);
  });

  it('422s a repo that is not owner/name', async () => {
    const gh = githubTripwire();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: gh.overrides });

    // The schema rejects before the handler runs, so no query is ever built
    // from a half-parsed identifier.
    const res = await app.inject({ method: 'GET', url: '/pulls/lookup?repo=acme&number=1' });
    expect(res.statusCode).toBe(422);
    expect(gh.touched).toEqual([]);
  });
});
