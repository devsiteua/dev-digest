import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * The clone the extractor reads. Line numbers matter: the fixture below cites
 * ranges out of these files, and the whole feature turns on whether the lines
 * are really there.
 */
const CLONE: Record<string, string> = {
  // 1: export async function listUsers(req) {
  // 2:   if (!req.user) {
  // 3:     throw new UnauthorizedError('sign in first');
  // 4:   }
  // 5:   return db.users.findMany();
  // 6: }
  'src/api/users.ts': [
    'export async function listUsers(req) {',
    '  if (!req.user) {',
    "    throw new UnauthorizedError('sign in first');",
    '  }',
    '  return db.users.findMany();',
    '}',
  ].join('\n'),
  // 1: export const WINDOW_SECONDS = 3600;
  // 2: export const MAX_REQUESTS = 100;
  'src/middleware/limit.ts': [
    'export const WINDOW_SECONDS = 3600;',
    'export const MAX_REQUESTS = 100;',
    '',
    'export function limiter() {',
    '  return WINDOW_SECONDS;',
    '}',
  ].join('\n'),
  // 1: export const config = {
  // 2:   port: Number(process.env.PORT ?? 3000),
  // 3: };
  'src/config.ts': ['export const config = {', '  port: Number(process.env.PORT ?? 3000),', '};'].join(
    '\n',
  ),
};

const SAMPLE_PATHS = Object.keys(CLONE);

const RULE_EARLY = 'Return early with a typed error instead of nesting the happy path';
const RULE_CONSTANTS = 'Name module-level constants in SCREAMING_SNAKE_CASE';
const RULE_CONFIG = 'Read environment variables only in src/config.ts';
const RULE_GHOST_FILE = 'Keep every route handler under fifty lines';
const RULE_GHOST_SNIPPET = 'Hash every password with argon2 before storing it';

/**
 * One model reply: three rules the clone can prove, and two it cannot.
 *
 * The ghosts are the point of the suite. `RULE_GHOST_FILE` cites a file that was
 * never sampled — the cheapest hallucination to catch — and `RULE_GHOST_SNIPPET`
 * cites a real, sampled file with lines that are not in it, which is the one a
 * path check alone would let through and display under the label "detected in".
 *
 * `RULE_EARLY`'s snippet is also deliberately re-indented and one line off from
 * where it really sits: a model that miscounts has still found the code, and
 * what gets stored must be the FILE's text at the corrected numbers.
 */
const EXTRACTION_FIXTURE = {
  candidates: [
    {
      rule: RULE_EARLY,
      category: 'error-handling',
      evidence_path: 'src/api/users.ts',
      evidence_snippet: "if (!req.user) {\n  throw new UnauthorizedError('sign in first');\n}",
      start_line: 3,
      end_line: 5,
      confidence: 0.9,
    },
    {
      rule: RULE_CONSTANTS,
      category: 'naming',
      evidence_path: 'src/middleware/limit.ts',
      evidence_snippet: 'export const WINDOW_SECONDS = 3600;\nexport const MAX_REQUESTS = 100;',
      start_line: 1,
      end_line: 2,
      confidence: 0.82,
    },
    {
      rule: RULE_CONFIG,
      category: 'structure',
      evidence_path: 'src/config.ts',
      evidence_snippet: '  port: Number(process.env.PORT ?? 3000),',
      start_line: 2,
      end_line: 2,
      confidence: 0.71,
    },
    {
      rule: RULE_GHOST_FILE,
      category: 'structure',
      evidence_path: 'src/api/nowhere.ts',
      evidence_snippet: 'export function handler() {}',
      start_line: 1,
      end_line: 1,
      confidence: 0.95,
    },
    {
      rule: RULE_GHOST_SNIPPET,
      category: 'security',
      evidence_path: 'src/config.ts',
      evidence_snippet: "const hash = await argon2.hash(password);",
      start_line: 1,
      end_line: 2,
      confidence: 0.99,
    },
  ],
};

/**
 * L02 — conventions extractor: the grounding pass, the accept/reject loop, the
 * merged skill, and the two things a re-scan must not do (resurrect a rejected
 * rule, or lose an accepted one).
 */
d('L02 conventions (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let userId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    userId = seeded.userId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** A repo whose index already ranks the three sample files. */
  async function makeRepo(ws = workspaceId, opts: { indexed?: boolean } = {}): Promise<string> {
    const name = `extract-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        defaultBranch: 'main',
        createdBy: userId,
      })
      .returning();

    if (opts.indexed !== false) {
      await pg.handle.db.insert(t.fileRank).values(
        SAMPLE_PATHS.map((filePath, i) => ({
          repoId: repo!.id,
          filePath,
          pagerank: 1 - i / 10,
          hotness: 0,
          rank: 1 - i / 10,
          percentile: 90 - i,
        })),
      );
    }
    return repo!.id;
  }

  function makeApp(llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', MockLLMProvider>>) {
    const router = llm ?? {
      openrouter: new MockLLMProvider('openai', {
        structuredBySchema: { ConventionExtraction: EXTRACTION_FIXTURE },
      }),
    };
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ files: CLONE }),
        llm: router,
      },
    });
  }

  const rowsFor = (repoId: string) =>
    pg.handle.db.select().from(t.conventions).where(eq(t.conventions.repoId, repoId));

  async function extract(app: Awaited<ReturnType<typeof makeApp>>, repoId: string) {
    return app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
  }

  // ---- The grounding pass --------------------------------------------------

  it('calls the model once, keeps only rules the clone proves, and reports the rest', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: EXTRACTION_FIXTURE },
    });
    const app = await makeApp({ openrouter: llm });
    const repoId = await makeRepo();

    const res = await extract(app, repoId);
    expect(res.statusCode).toBe(200);
    const result = res.json();

    // Exactly one structured call, with the schema the whole feature is named
    // after — the two-step file-selection dialogue is declined on purpose.
    const structured = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structured).toHaveLength(1);
    const req = structured[0]!.req as { schemaName: string; model: string; messages: unknown[] };
    expect(req.schemaName).toBe('ConventionExtraction');
    // No workspace override is set, so the MODULE's cheap default is used — not
    // the `gpt-5.4` the FEATURE_MODELS registry defaults `conventions` to.
    expect(req.model).toBe('deepseek/deepseek-v4-flash');

    expect(result.candidates.map((c: { rule: string }) => c.rule).sort()).toEqual(
      [RULE_CONFIG, RULE_CONSTANTS, RULE_EARLY].sort(),
    );
    expect(result.sampled_files).toEqual(expect.arrayContaining(SAMPLE_PATHS));

    // Nothing is dropped silently: both ghosts come back with a reason.
    const discardedRules = result.discarded.map((d: { rule: string }) => d.rule);
    expect(discardedRules).toContain(RULE_GHOST_FILE);
    expect(discardedRules).toContain(RULE_GHOST_SNIPPET);
    const ghostFile = result.discarded.find((d: { rule: string }) => d.rule === RULE_GHOST_FILE);
    expect(ghostFile.reason).toMatch(/not one of the sampled files/);

    // And neither of them reaches the database.
    const stored = await rowsFor(repoId);
    expect(stored).toHaveLength(3);
    expect(stored.map((r) => r.rule)).not.toContain(RULE_GHOST_FILE);
    expect(stored.map((r) => r.rule)).not.toContain(RULE_GHOST_SNIPPET);
    expect(stored.every((r) => r.status === 'pending')).toBe(true);

    // The stored snippet is the FILE's text at the corrected line numbers, not
    // the model's re-indented copy of it.
    const early = stored.find((r) => r.rule === RULE_EARLY)!;
    expect(early.evidenceStartLine).toBe(2);
    expect(early.evidenceEndLine).toBe(4);
    expect(early.evidenceSnippet).toBe(
      CLONE['src/api/users.ts']!.split('\n').slice(1, 4).join('\n'),
    );

    await app.close();
  });

  it('uses the workspace override when Settings names a model', async () => {
    const openai = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: { candidates: [] } },
    });
    const openrouter = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: EXTRACTION_FIXTURE },
    });
    await pg.handle.db
      .insert(t.settings)
      .values({
        workspaceId,
        userId,
        key: 'feature_models',
        value: { conventions: { provider: 'openai', model: 'gpt-4.1' } },
      })
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: { conventions: { provider: 'openai', model: 'gpt-4.1' } } },
      });

    const app = await makeApp({ openai, openrouter });
    const repoId = await makeRepo();
    expect((await extract(app, repoId)).statusCode).toBe(200);

    expect(openai.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(openrouter.calls).toHaveLength(0);
    const req = openai.calls[0]!.req as { model: string };
    expect(req.model).toBe('gpt-4.1');

    // Leave the workspace as we found it — every other test asserts the default.
    await pg.handle.db
      .delete(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    await app.close();
  });

  it('refuses to scan an unindexed repo, and makes no model call doing it', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: EXTRACTION_FIXTURE },
    });
    const app = await makeApp({ openrouter: llm });
    const repoId = await makeRepo(workspaceId, { indexed: false });

    const res = await extract(app, repoId);
    // repo-intel degrades to `[]` with no error; "index the repo first" is the
    // only thing the user can act on, and an empty screen would not say it.
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/[Ii]ndex the repo first/);
    expect(llm.calls).toHaveLength(0);
    expect(await rowsFor(repoId)).toHaveLength(0);

    await app.close();
  });

  it('persists nothing, and errors on nothing, when every rule fails the check', async () => {
    const app = await makeApp({
      openrouter: new MockLLMProvider('openai', {
        structuredBySchema: {
          ConventionExtraction: {
            candidates: EXTRACTION_FIXTURE.candidates.filter((c) =>
              [RULE_GHOST_FILE, RULE_GHOST_SNIPPET].includes(c.rule),
            ),
          },
        },
      }),
    });
    const repoId = await makeRepo();

    const result = (await extract(app, repoId)).json();
    // The most likely first-run outcome on a real repo. It is a result, not a
    // failure — and the two discards are what makes an empty list readable.
    expect(result.candidates).toEqual([]);
    expect(result.discarded).toHaveLength(2);
    expect(result.sampled_files.length).toBeGreaterThan(0);
    expect(await rowsFor(repoId)).toHaveLength(0);

    await app.close();
  });

  // ---- The review loop -----------------------------------------------------

  it('rewords, re-files and accepts or rejects a candidate', async () => {
    const app = await makeApp();
    const repoId = await makeRepo();
    await extract(app, repoId);

    const listed = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    const target = listed.find((c: { rule: string }) => c.rule === RULE_CONSTANTS);

    const reworded = (
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${target.id}`,
        payload: { rule: '  Name   constants in SCREAMING_SNAKE_CASE.  ', category: 'style' },
      })
    ).json();
    // The same normalisation an extracted rule gets: one line, no trailing stop.
    expect(reworded.rule).toBe('Name constants in SCREAMING_SNAKE_CASE');
    expect(reworded.category).toBe('style');
    expect(reworded.status).toBe('pending');
    // Evidence is not patchable, and an edit does not disturb it.
    expect(reworded.evidence_path).toBe('src/middleware/limit.ts');

    const accepted = (
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${target.id}`,
        payload: { status: 'accepted' },
      })
    ).json();
    expect(accepted.status).toBe('accepted');

    const rejected = (
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${target.id}`,
        payload: { status: 'rejected' },
      })
    ).json();
    expect(rejected.status).toBe('rejected');
    expect(rejected.rule).toBe('Name constants in SCREAMING_SNAKE_CASE');

    await app.close();
  });

  // ---- Merge to one skill --------------------------------------------------

  it('merges only the accepted candidates, stamps `extracted`, and files the rest away', async () => {
    const app = await makeApp();
    const repoId = await makeRepo();
    await extract(app, repoId);

    const listed = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    const byRule = (rule: string) => listed.find((c: { rule: string }) => c.rule === rule);
    const early = byRule(RULE_EARLY);
    const constants = byRule(RULE_CONSTANTS);
    const config = byRule(RULE_CONFIG);

    for (const [id, status] of [
      [early.id, 'accepted'],
      [constants.id, 'accepted'],
      [config.id, 'rejected'],
    ] as const) {
      await app.inject({ method: 'PATCH', url: `/conventions/${id}`, payload: { status } });
    }

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        name: `repo-conventions-${repoSeq}`,
        description: 'House rules extracted from this repo.',
        type: 'convention',
        enabled: true,
        body: `# Repo conventions\n\n- ${RULE_EARLY}\n- ${RULE_CONSTANTS}`,
        // Sent on purpose: provenance is the server's, exactly as for an import.
        source: 'manual',
        convention_ids: [early.id, constants.id, config.id],
      },
    });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill.source).toBe('extracted');

    // The rejected candidate contributed neither its evidence nor its rule.
    expect(skill.evidence_files).toEqual(['src/api/users.ts', 'src/middleware/limit.ts']);
    expect(skill.evidence_files).not.toContain('src/config.ts');
    expect(skill.body).not.toContain(RULE_CONFIG);

    const stored = await rowsFor(repoId);
    expect(stored.find((r) => r.id === early.id)!.skillId).toBe(skill.id);
    expect(stored.find((r) => r.id === constants.id)!.skillId).toBe(skill.id);
    expect(stored.find((r) => r.id === config.id)!.skillId).toBeNull();

    // The merged skill is a first-class skill: readable, versioned, listed.
    const fetched = await app.inject({ method: 'GET', url: `/skills/${skill.id}` });
    expect(fetched.json()).toMatchObject({ source: 'extracted', version: 1 });

    await app.close();
  });

  // Merging is not a one-shot act: accept three rules, merge, accept two more,
  // merge again. With an insert-only path the second merge died on the name
  // check AFTER the whole body had been composed — and the default name is
  // fixed, so it died every time.
  it('re-merging the same repo versions the skill instead of colliding on its name', async () => {
    const app = await makeApp();
    const repoId = await makeRepo();
    await extract(app, repoId);
    const name = `remerge-conventions-${repoSeq}`;

    const listed = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    const byRule = (rule: string) => listed.find((c: { rule: string }) => c.rule === rule);
    const early = byRule(RULE_EARLY);
    const constants = byRule(RULE_CONSTANTS);

    const merge = (body: string, ids: string[]) =>
      app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/skill`,
        payload: {
          name,
          description: 'House rules extracted from this repo.',
          type: 'convention',
          enabled: true,
          body,
          convention_ids: ids,
        },
      });

    await app.inject({
      method: 'PATCH',
      url: `/conventions/${early.id}`,
      payload: { status: 'accepted' },
    });
    const first = await merge(`# Repo conventions\n\n- ${RULE_EARLY}`, [early.id]);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ version: 1, evidence_files: ['src/api/users.ts'] });

    await app.inject({
      method: 'PATCH',
      url: `/conventions/${constants.id}`,
      payload: { status: 'accepted' },
    });
    const second = await merge(`# Repo conventions\n\n- ${RULE_EARLY}\n- ${RULE_CONSTANTS}`, [
      early.id,
      constants.id,
    ]);
    expect(second.statusCode).toBe(201);

    // Same row, new version, and the newly accepted rule is in it.
    expect(second.json().id).toBe(first.json().id);
    expect(second.json().version).toBe(2);
    expect(second.json().body).toContain(RULE_CONSTANTS);
    expect(second.json().evidence_files).toEqual([
      'src/api/users.ts',
      'src/middleware/limit.ts',
    ]);
    expect(second.json().source).toBe('extracted');

    // One skill under that name, and the first body survives as a snapshot.
    const skills = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(skills.filter((s: { name: string }) => s.name === name)).toHaveLength(1);
    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${first.json().id}/versions` })
    ).json();
    expect(versions).toHaveLength(2);

    await app.close();
  });

  // The replace path is keyed on `skill_id` of THIS repo's candidates, not on
  // the name alone — otherwise two repos sharing one workspace would silently
  // overwrite each other under the shared default name.
  it('will not let one repo overwrite the skill another repo merged', async () => {
    const app = await makeApp();
    const repoA = await makeRepo();
    const repoB = await makeRepo();
    const name = `shared-conventions-${repoSeq}`;
    await extract(app, repoA);
    await extract(app, repoB);

    const acceptFirst = async (repoId: string) => {
      const listed = (
        await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
      ).json();
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${listed[0].id}`,
        payload: { status: 'accepted' },
      });
      return listed[0].id as string;
    };

    const merge = (repoId: string, ids: string[]) =>
      app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/skill`,
        payload: {
          name,
          description: 'House rules.',
          type: 'convention',
          enabled: true,
          body: '# Repo conventions',
          convention_ids: ids,
        },
      });

    expect((await merge(repoA, [await acceptFirst(repoA)])).statusCode).toBe(201);

    const clash = await merge(repoB, [await acceptFirst(repoB)]);
    expect(clash.statusCode).toBe(422);
    // Asserted on the raw body rather than a field: what matters is that the
    // refusal names the skill, so the user knows renaming is the way out.
    expect(clash.body).toContain(name);

    const skills = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(skills.filter((s: { name: string }) => s.name === name)).toHaveLength(1);

    await app.close();
  });

  it('refuses to merge when nothing selected has been accepted', async () => {
    const app = await makeApp();
    const repoId = await makeRepo();
    await extract(app, repoId);

    const listed = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${listed[0].id}`,
      payload: { status: 'rejected' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        name: `never-created-${repoSeq}`,
        description: 'Should not exist.',
        type: 'convention',
        enabled: true,
        body: '# Nothing',
        // One rejected and one still pending: neither is a decision to merge.
        convention_ids: [listed[0].id, listed[1].id],
      },
    });
    expect(res.statusCode).toBe(422);

    const skills = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(skills.some((s: { name: string }) => s.name.startsWith('never-created'))).toBe(false);

    await app.close();
  });

  // ---- Re-scan -------------------------------------------------------------

  it('replaces the pending rows on a re-scan and never resurrects a rejected rule', async () => {
    const app = await makeApp();
    const repoId = await makeRepo();
    await extract(app, repoId);

    const listed = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    const byRule = (rule: string) => listed.find((c: { rule: string }) => c.rule === rule);
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${byRule(RULE_CONFIG).id}`,
      payload: { status: 'rejected' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${byRule(RULE_EARLY).id}`,
      payload: { status: 'accepted' },
    });

    const again = (await extract(app, repoId)).json();

    const stored = await rowsFor(repoId);
    // Still three rules, not six: the pending one was replaced, and the two the
    // user decided on were left exactly where they were.
    expect(stored).toHaveLength(3);
    const config = stored.filter((r) => r.rule === RULE_CONFIG);
    expect(config).toHaveLength(1);
    expect(config[0]!.status).toBe('rejected');
    expect(config[0]!.id).toBe(byRule(RULE_CONFIG).id);
    expect(stored.find((r) => r.rule === RULE_EARLY)!.status).toBe('accepted');
    expect(stored.find((r) => r.rule === RULE_EARLY)!.id).toBe(byRule(RULE_EARLY).id);

    // The pending one is a NEW row — that is what "a re-scan replaces pending"
    // means — while the decided rules are reported as decided, not as findings.
    expect(stored.find((r) => r.rule === RULE_CONSTANTS)!.id).not.toBe(byRule(RULE_CONSTANTS).id);
    const decidedDiscards = again.discarded.filter((dd: { reason: string }) =>
      /already accepted or rejected/.test(dd.reason),
    );
    expect(decidedDiscards.map((dd: { rule: string }) => dd.rule).sort()).toEqual(
      [RULE_CONFIG, RULE_EARLY].sort(),
    );

    await app.close();
  });

  // ---- Workspace scoping, on every verb ------------------------------------

  it('404s every verb against a repo or candidate in another workspace', async () => {
    const app = await makeApp();
    const { db } = pg.handle;

    const [otherWs] = await db
      .insert(t.workspaces)
      .values({ name: `other-conventions-${repoSeq}` })
      .returning();
    const foreignRepoId = await makeRepo(otherWs!.id);
    const [foreign] = await db
      .insert(t.conventions)
      .values({
        workspaceId: otherWs!.id,
        repoId: foreignRepoId,
        rule: 'Never leaked across a workspace boundary',
        category: 'naming',
        evidencePath: 'src/secret.ts',
        evidenceSnippet: 'const apiKey = internalSecret;',
        evidenceStartLine: 1,
        evidenceEndLine: 1,
        confidence: 0.9,
        status: 'accepted',
      })
      .returning();

    expect(
      (await app.inject({ method: 'GET', url: `/repos/${foreignRepoId}/conventions` })).statusCode,
    ).toBe(404);
    expect((await extract(app, foreignRepoId)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/conventions/${foreign!.id}`,
          payload: { status: 'rejected' },
        })
      ).statusCode,
    ).toBe(404);

    // Both halves of the merge endpoint: a foreign repo, and a foreign candidate
    // id smuggled into a request against a repo the caller does own.
    const ownRepoId = await makeRepo();
    for (const url of [
      `/repos/${foreignRepoId}/conventions/skill`,
      `/repos/${ownRepoId}/conventions/skill`,
    ]) {
      const res = await app.inject({
        method: 'POST',
        url,
        payload: {
          name: `stolen-${repoSeq}`,
          description: 'Should not exist.',
          type: 'convention',
          enabled: true,
          body: '# Stolen',
          convention_ids: [foreign!.id],
        },
      });
      expect(res.statusCode).toBe(404);
    }

    // The foreign row is untouched: still accepted, still in no skill.
    const [after] = await db.select().from(t.conventions).where(eq(t.conventions.id, foreign!.id));
    expect(after).toMatchObject({ status: 'accepted', skillId: null });

    await app.close();
  });
});
