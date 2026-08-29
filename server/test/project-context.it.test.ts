import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import {
  MAX_DOCS_PER_REPO,
  MAX_DOC_BYTES,
} from '../src/modules/context/constants.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/api/public.ts b/src/api/public.ts
--- a/src/api/public.ts
+++ b/src/api/public.ts
@@ -10,3 +10,4 @@
   router.get('/public/orders', handler);
+  router.get('/public/refunds', handler);
   export default router;`;

/** Minimal grounded fixture — this suite is about the PROMPT, not the findings. */
const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'Nothing blocking.',
  score: 90,
  findings: [],
};

/**
 * L05 — project context: persistence, the four rejections, ordering, and the
 * property the whole feature turns on — that an enabled document reaches the
 * assembled prompt, that the run trace records which documents were read, and
 * that deleting one afterwards changes neither the trace nor anything else
 * already written.
 *
 * This is the 14th file in the `.it.test` lane, and each one starts its OWN
 * Postgres container (`server/INSIGHTS.md`, 2026-08-28). If an unrelated file
 * goes red after this one lands, remove this file and re-run before calling it
 * a regression — that separates a real break from load.
 */
d('L05 project context (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        // L03: a review derives the PR's intent first, on the `review_intent`
        // feature model — a DIFFERENT provider from the agent's. An unmocked
        // entry here would be a real, billable call from the test suite.
        llm: {
          openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
          openrouter: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
        },
      },
    });
  }

  /** A fresh repo, so one test's 50-document ceiling is not another's problem. */
  async function makeRepo() {
    const n = seq++;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `context-${n}`,
        fullName: `acme/context-${n}`,
      })
      .returning();
    return repo!;
  }

  const countDocs = async (repoId: string) =>
    (
      await pg.handle.db
        .select({ id: t.projectContextDocs.id })
        .from(t.projectContextDocs)
        .where(eq(t.projectContextDocs.repoId, repoId))
    ).length;

  const upload = (app: Awaited<ReturnType<typeof makeApp>>, repoId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/repos/${repoId}/context`, payload });

  // ---- AC-01: the row, and the pair it is keyed on ------------------------

  it('stores an uploaded document in Postgres, keyed by workspace and repo', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    const res = await upload(app, repo.id, {
      filename: 'prd.md',
      content: '# PRD\n\nPublic endpoints must be rate-limited.',
      title: 'Public API PRD',
    });
    expect(res.statusCode).toBe(201);

    const [row] = await pg.handle.db
      .select()
      .from(t.projectContextDocs)
      .where(
        and(
          eq(t.projectContextDocs.workspaceId, workspaceId),
          eq(t.projectContextDocs.repoId, repo.id),
        ),
      );

    expect(row).toBeDefined();
    expect(row!.title).toBe('Public API PRD');
    expect(row!.pathLabel).toBe('prd.md');
    expect(row!.body).toContain('rate-limited');
    // AC-04: enabled on creation.
    expect(row!.enabled).toBe(true);
    await app.close();
  });

  it('does not return another workspace’s document', async () => {
    const app = await makeApp();
    const repo = await makeRepo();
    const created = (
      await upload(app, repo.id, { filename: 'secret.md', content: 'private notes' })
    ).json();

    // The row exists; a read scoped to a different workspace must not find it.
    const [foreign] = await pg.handle.db
      .select()
      .from(t.projectContextDocs)
      .where(
        and(
          eq(t.projectContextDocs.workspaceId, '00000000-0000-0000-0000-000000000000'),
          eq(t.projectContextDocs.id, created.id),
        ),
      );
    expect(foreign).toBeUndefined();
    await app.close();
  });

  // ---- AC-04: created enabled, after the tail -----------------------------

  it('gives each new document an order above every existing one', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    for (const name of ['a.md', 'b.md', 'c.md']) {
      const res = await upload(app, repo.id, { filename: name, content: `body of ${name}` });
      expect(res.statusCode).toBe(201);
    }

    const list = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    expect(list.map((d: { path_label: string }) => d.path_label)).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);
    expect(list.map((d: { order: number }) => d.order)).toEqual([0, 1, 2]);
    expect(list.every((d: { enabled: boolean }) => d.enabled)).toBe(true);
    // The list projection carries no bodies.
    expect(list.every((d: { body?: unknown }) => d.body === undefined)).toBe(true);
    await app.close();
  });

  // ---- AC-05 to AC-08: four rejections, four statuses, zero rows ----------

  it('rejects an extension that is not .md or .txt with 400, writing nothing', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    const res = await upload(app, repo.id, { filename: 'design.pdf', content: 'hello' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('.md');
    expect(res.json().error.message).toContain('.txt');
    expect(await countDocs(repo.id)).toBe(0);
    await app.close();
  });

  it('rejects an oversize document with 413, naming the limit, writing nothing', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    const res = await upload(app, repo.id, {
      filename: 'huge.md',
      content: 'a'.repeat(MAX_DOC_BYTES + 1),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.message).toContain(String(MAX_DOC_BYTES));
    expect(await countDocs(repo.id)).toBe(0);
    await app.close();
  });

  it('rejects the 51st document with 409, writing nothing', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    // Straight to the table: 50 HTTP round-trips to set up one assertion is a
    // slow test, and the ceiling is a count, not a code path through the route.
    await pg.handle.db.insert(t.projectContextDocs).values(
      Array.from({ length: MAX_DOCS_PER_REPO }, (_, i) => ({
        workspaceId,
        repoId: repo.id,
        title: `doc ${i}`,
        pathLabel: `doc-${i}.md`,
        body: 'x',
        order: i,
        sizeBytes: 1,
      })),
    );

    const res = await upload(app, repo.id, { filename: 'one-too-many.md', content: 'hello' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain(String(MAX_DOCS_PER_REPO));
    expect(await countDocs(repo.id)).toBe(MAX_DOCS_PER_REPO);
    await app.close();
  });

  it('rejects a whitespace-only body with 400, writing nothing', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    const res = await upload(app, repo.id, { filename: 'blank.md', content: '   \n\t\n  ' });
    expect(res.statusCode).toBe(400);
    expect(await countDocs(repo.id)).toBe(0);
    await app.close();
  });

  // ---- AC-10: reorder persists --------------------------------------------

  it('persists a new order and returns the list in it', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    const ids: string[] = [];
    for (const name of ['first.md', 'second.md', 'third.md']) {
      ids.push((await upload(app, repo.id, { filename: name, content: `body ${name}` })).json().id);
    }

    const reordered = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/context/order`,
      payload: { ids: [ids[2], ids[0], ids[1]] },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().map((d: { path_label: string }) => d.path_label)).toEqual([
      'third.md',
      'first.md',
      'second.md',
    ]);

    // And it survives a re-read, rather than being a shape of the response.
    const list = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    expect(list.map((d: { path_label: string }) => d.path_label)).toEqual([
      'third.md',
      'first.md',
      'second.md',
    ]);
    await app.close();
  });

  it('enables, disables and deletes one document', async () => {
    const app = await makeApp();
    const repo = await makeRepo();
    const created = (
      await upload(app, repo.id, { filename: 'style.txt', content: 'tabs, not spaces' })
    ).json();

    const off = await app.inject({
      method: 'PATCH',
      url: `/context/${created.id}`,
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().enabled).toBe(false);

    const gone = await app.inject({ method: 'DELETE', url: `/context/${created.id}` });
    expect(gone.statusCode).toBe(204);
    expect(await countDocs(repo.id)).toBe(0);
    expect(
      (await app.inject({ method: 'GET', url: `/context/${created.id}` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  // ---- AC-09, AC-10, AC-19, AC-20: the prompt, and the trace --------------

  it('puts enabled documents in the prompt, records them in the trace, and keeps that record', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo.id,
        number: 901,
        title: 'Add a public refunds endpoint',
        author: 'tomek.w',
        branch: 'feat/refunds',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/api/public.ts',
      additions: 1,
      deletions: 0,
      patch: "@@ -10,3 +10,4 @@\n   router.get('/public/orders', handler);\n+  router.get('/public/refunds', handler);",
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Context Reader',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'You review things.',
          repo_intel: false,
        },
      })
    ).json();
    expect(agent.project_context).toBe(true);

    /**
     * Run one review and return its persisted trace.
     *
     * `waitForPrRuns` RETURNS the rows it has when its timeout expires rather
     * than throwing (`server/INSIGHTS.md`, 2026-08-07/2026-08-28), so the
     * condition it waited for is asserted here — otherwise a loaded lane fails
     * three lines later on `prompt_assembly` being undefined, and reads as a
     * logic bug in prompt rendering.
     */
    let runsSoFar = 0;
    const runAndReadTrace = async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr!.id}/review`,
        payload: { agentId: agent.id },
      });
      const runId = res.json().runs[0].run_id as string;
      const expected = ++runsSoFar;
      const runs = await waitForPrRuns(pg.handle.db, pr!.id, { expected });
      const terminal = runs.filter((r) =>
        ['done', 'failed', 'cancelled'].includes(r.status ?? ''),
      );
      expect(
        terminal.length,
        `expected ${expected} terminal run(s), saw ${terminal.length} of ${runs.length}`,
      ).toBeGreaterThanOrEqual(expected);

      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      expect(trace.prompt_assembly).toBeDefined();
      return trace as {
        specs_read: string[];
        prompt_assembly: { specs: string | null; user: string };
      };
    };

    // 1. No documents — the slot stays empty, exactly as before L05 (AC-15).
    const none = await runAndReadTrace();
    expect(none.prompt_assembly.specs ?? null).toBeNull();
    expect(none.specs_read).toEqual([]);
    expect(none.prompt_assembly.user).not.toContain('## Project context');

    // 2. Two documents, in order.
    const prd = (
      await upload(app, repo.id, {
        filename: 'prd.md',
        content: 'Public endpoints MUST be rate-limited.',
        title: 'PRD',
      })
    ).json();
    const adr = (
      await upload(app, repo.id, {
        filename: 'adr-7.md',
        content: 'Redis is the shared singleton.',
        title: 'ADR-7',
      })
    ).json();

    const both = await runAndReadTrace();
    expect(both.prompt_assembly.user).toContain('## Project context');
    expect(both.prompt_assembly.specs).toContain('Public endpoints MUST be rate-limited.');
    expect(both.prompt_assembly.specs).toContain('Redis is the shared singleton.');
    // AC-11: wrapped as untrusted data, by the engine, once per document.
    expect(both.prompt_assembly.specs).toContain('<untrusted source="spec-0">');
    expect(both.prompt_assembly.specs).toContain('<untrusted source="spec-1">');
    // AC-19: the trace names what was read.
    expect(both.specs_read).toEqual(['PRD', 'ADR-7']);
    // AC-10: the section follows `order`.
    expect(both.prompt_assembly.specs!.indexOf('rate-limited')).toBeLessThan(
      both.prompt_assembly.specs!.indexOf('Redis'),
    );

    // 3. AC-10 — reorder, and the section follows.
    await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/context/order`,
      payload: { ids: [adr.id, prd.id] },
    });
    const swapped = await runAndReadTrace();
    expect(swapped.specs_read).toEqual(['ADR-7', 'PRD']);
    expect(swapped.prompt_assembly.specs!.indexOf('Redis')).toBeLessThan(
      swapped.prompt_assembly.specs!.indexOf('rate-limited'),
    );

    // 4. A disabled document leaves the prompt without being deleted.
    await app.inject({
      method: 'PATCH',
      url: `/context/${prd.id}`,
      payload: { enabled: false },
    });
    const oneOff = await runAndReadTrace();
    expect(oneOff.specs_read).toEqual(['ADR-7']);
    expect(oneOff.prompt_assembly.specs).not.toContain('rate-limited');

    // 5. AC-09 — a deleted document leaves the next prompt.
    await app.inject({ method: 'DELETE', url: `/context/${adr.id}` });
    const after = await runAndReadTrace();
    expect(after.specs_read).toEqual([]);
    expect(after.prompt_assembly.specs ?? null).toBeNull();

    // 6. AC-20 — and the trace already written still says what was sent, with
    // the text as it was sent. Both documents are gone or disabled by now.
    const reread = (
      await app.inject({
        method: 'GET',
        url: `/runs/${(await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr!.id)))[1]!.id}/trace`,
      })
    ).json();
    expect(reread.specs_read).toEqual(['PRD', 'ADR-7']);
    expect(reread.prompt_assembly.specs).toContain('Public endpoints MUST be rate-limited.');
    expect(reread.prompt_assembly.specs).toContain('Redis is the shared singleton.');

    await app.close();
  }, 60_000);

  // ---- AC-26: the cascade -------------------------------------------------

  it('deletes a repository’s documents with the repository', async () => {
    const app = await makeApp();
    const repo = await makeRepo();

    await upload(app, repo.id, { filename: 'one.md', content: 'one' });
    await upload(app, repo.id, { filename: 'two.md', content: 'two' });
    expect(await countDocs(repo.id)).toBe(2);

    await pg.handle.db.delete(t.repos).where(eq(t.repos.id, repo.id));
    expect(await countDocs(repo.id)).toBe(0);
    await app.close();
  });
});
