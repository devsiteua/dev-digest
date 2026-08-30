/**
 * L07-B — Export to CI, ingest, and every refusal in between, against real
 * Postgres.
 *
 * What can only be proven here, and is proven nowhere else:
 *   - WHERE the bundle lands. `commitFiles` is a port; only a served route with
 *     a recording double can show that the branch is `devdigest/ci` and never
 *     the base, that exactly one pull request is ever opened, and that all three
 *     runner files reach the payload with their names intact.
 *   - WHAT survives a refusal. "No branch, no pull request, no row" is a
 *     statement about three side effects, and a unit test has none of them.
 *   - WHOSE workspace an ingested run belongs to. The answer comes from the
 *     installation's agent, and a test with one workspace cannot fail.
 *
 * GitHub is `MockGitHubClient` throughout — never a network. The runner bundle
 * is a tmp directory this file writes, so a case can delete exactly one of the
 * three files without touching `agent-runner/dist/`, which is git-ignored and
 * absent on a fresh clone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { count, eq } from 'drizzle-orm';
import type { SkillSource } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import {
  CI_BRANCH,
  RUNNER_DIR,
  RUNNER_FILES,
  RUNNER_VERSION,
  WORKFLOW_PATH,
} from '../src/modules/ci/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** 36 characters — over the 32-character floor the ingest token must clear. */
const CI_TOKEN = 'devdigest-ci-token-0123456789abcdef01';
/** Shaped like a real OpenRouter key so "no field contains it" is a real search. */
const FAKE_MODEL_KEY = 'sk-or-v1-FAKE0123456789abcdef0123456789abcdef';

/**
 * What `ncc` really emits, byte for byte where it matters: `dist/package.json`
 * is 23 bytes of pretty-printed JSON, not the one-liner it is usually quoted
 * as. It is the file that scopes the ESM module type to `.devdigest/runner/`,
 * so a target repository declaring `"type": "commonjs"` still runs the bundle.
 */
const RUNNER_PACKAGE_JSON = '{\n  "type": "module"\n}\n';

const RUNNER_FIXTURE: Record<string, string> = {
  'index.js': "import { review } from './300.index.js';\nexport { review as main };\n",
  '300.index.js': 'export const review = () => 0;\n',
  'package.json': RUNNER_PACKAGE_JSON,
};

/** A GitHub client that fails the very first write, as a scope-less token does. */
const GITHUB_FAILURE = 'refusing to push .github/workflows: token lacks the `workflow` scope';

class FailingGitHubClient extends MockGitHubClient {
  override async commitFiles(): Promise<{ branch: string }> {
    throw new Error(GITHUB_FAILURE);
  }
}

d('L07-B export to CI (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let userId: string;
  let runnerDir: string;
  let seq = 0;
  const tmpDirs: string[] = [];

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    userId = seeded.userId;
    runnerDir = await makeRunnerDir();
  });

  afterAll(async () => {
    for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  // ---- fixtures ------------------------------------------------------------

  /** A fresh runner bundle on disk, optionally missing exactly one file. */
  async function makeRunnerDir(omit?: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'devdigest-runner-'));
    tmpDirs.push(dir);
    for (const name of RUNNER_FILES) {
      if (name === omit) continue;
      await writeFile(path.join(dir, name), RUNNER_FIXTURE[name]!, 'utf8');
    }
    return dir;
  }

  /** A directory path that does not exist — the fresh-clone state. */
  async function missingRunnerDir(): Promise<string> {
    const parent = await mkdtemp(path.join(tmpdir(), 'devdigest-norunner-'));
    tmpDirs.push(parent);
    return path.join(parent, 'dist');
  }

  interface AppOptions {
    runnerDir?: string;
    github?: MockGitHubClient;
    secrets?: Record<string, string>;
  }

  const DEFAULT_SECRETS = {
    GITHUB_TOKEN: 'x',
    DEVDIGEST_CI_TOKEN: CI_TOKEN,
    OPENROUTER_API_KEY: FAKE_MODEL_KEY,
  };

  async function makeApp(opts: AppOptions = {}) {
    const github = opts.github ?? new MockGitHubClient();
    const app = await buildApp({
      config: { ...config(), nodeEnv: 'test', runnerBundleDir: opts.runnerDir ?? runnerDir },
      db: pg.handle.db,
      overrides: {
        github,
        secrets: new MockSecretsProvider(opts.secrets ?? DEFAULT_SECRETS),
      },
    });
    return { app, github };
  }

  type App = Awaited<ReturnType<typeof makeApp>>['app'];

  interface SkillFixture {
    name: string;
    body: string;
    source: SkillSource;
  }

  async function makeAgent(
    opts: { workspaceId?: string; name?: string; skills?: SkillFixture[] } = {},
  ): Promise<string> {
    const ws = opts.workspaceId ?? workspaceId;
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: opts.name ?? `CI Reviewer ${seq++}`,
        description: 'exported to CI by the integration lane',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        systemPrompt: 'Review this diff for security defects.',
        strategy: 'auto',
        ciFailOn: 'critical',
        createdBy: userId,
      })
      .returning();

    let order = 0;
    for (const skill of opts.skills ?? []) {
      const [row] = await pg.handle.db
        .insert(t.skills)
        .values({
          workspaceId: ws,
          name: skill.name,
          description: 'attached by the integration lane',
          type: 'custom',
          source: skill.source,
          body: skill.body,
        })
        .returning();
      await pg.handle.db
        .insert(t.agentSkills)
        .values({ agentId: agent!.id, skillId: row!.id, order: order++ });
    }
    return agent!.id;
  }

  const nextRepo = () => `acme/widgets-${seq++}`;

  async function makeInstallation(agentId: string, repo: string): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId, repo, targetType: 'gha' })
      .returning();
    return row!.id;
  }

  // ---- requests ------------------------------------------------------------

  const exportCi = (app: App, agentId: string, repo: string, body: object = {}) =>
    app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo, target: 'gha', action: 'open_pr', base: 'main', ...body },
    });

  const previewCi = (app: App, agentId: string, repo: string, query = '') =>
    app.inject({
      method: 'GET',
      url: `/agents/${agentId}/export-ci/preview?repo=${encodeURIComponent(repo)}${query}`,
    });

  const ingest = (app: App, body: unknown, token: string | null = CI_TOKEN) =>
    app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      payload: body,
    });

  const validArtifact = (repo: string, over: Record<string, unknown> = {}) => ({
    repo,
    pr_number: 42,
    commit_sha: 'a'.repeat(40),
    run_url: 'https://github.com/acme/widgets/actions/runs/1234567890',
    exit_code: 1,
    result: {
      findings_count: 3,
      cost_usd: 0.0412,
      duration_ms: 18_500,
      agent: 'CI Reviewer',
      version: RUNNER_VERSION,
    },
    ...over,
  });

  // ---- row counts ----------------------------------------------------------

  const installationCount = async (agentId: string): Promise<number> => {
    const [row] = await pg.handle.db
      .select({ n: count() })
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    return row!.n;
  };

  const agentRunCount = async (agentId: string): Promise<number> => {
    const [row] = await pg.handle.db
      .select({ n: count() })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.agentId, agentId));
    return row!.n;
  };

  const ciRunCount = async (installationId: string): Promise<number> => {
    const [row] = await pg.handle.db
      .select({ n: count() })
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
    return row!.n;
  };

  const errorOf = (res: { json: () => unknown }): { code: string; message: string } =>
    (res.json() as { error: { code: string; message: string } }).error;

  // ---- install -------------------------------------------------------------

  it('commits to devdigest/ci and opens one pull request, never touching the base (AC-14)', async () => {
    const { app, github } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();

    const res = await exportCi(app, agentId, repo);

    expect(res.statusCode).toBe(200);
    expect(github.committed).toHaveLength(1);
    expect(github.committed[0]!.branch).toBe(CI_BRANCH);
    expect(github.committed[0]!.base).toBe('main');
    // The base branch is never a commit TARGET — the workflow arrives as a pull
    // request its reviewer can read before the permissions block takes effect.
    for (const payload of github.committed) {
      expect(payload.branch).toBe(CI_BRANCH);
      expect(payload.branch).not.toBe(payload.base);
    }
    expect(github.openedPrs).toHaveLength(1);
    expect(github.openedPrs[0]!.head).toBe(CI_BRANCH);
    expect(github.openedPrs[0]!.base).toBe('main');
    expect(res.json().pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(await installationCount(agentId)).toBe(1);

    await app.close();
  });

  it('reuses the row and the open pull request on a second install (AC-15)', async () => {
    const { app, github } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();

    const first = await exportCi(app, agentId, repo);
    const second = await exportCi(app, agentId, repo);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    // Two commits — `commitFiles` fast-forwards the branch, which is how the
    // existing pull request shows the new bundle.
    expect(github.committed).toHaveLength(2);
    // ONE pull request in total, and one row.
    expect(github.openedPrs).toHaveLength(1);
    expect(await installationCount(agentId)).toBe(1);
    expect(second.json().installation.id).toBe(first.json().installation.id);

    await app.close();
  });

  it('commits all three runner files under .devdigest/runner with their names (AC-35)', async () => {
    const { app, github } = await makeApp();
    const agentId = await makeAgent();

    const res = await exportCi(app, agentId, nextRepo());

    expect(res.statusCode).toBe(200);
    const committed = github.committed[0]!.files;
    const byPath = new Map(committed.map((f) => [f.path, f.contents]));

    for (const name of RUNNER_FILES) {
      expect(byPath.get(`${RUNNER_DIR}/${name}`)).toBe(RUNNER_FIXTURE[name]);
    }
    // The 23-byte file that makes the ESM bundle runnable in a repository
    // declaring `"type": "commonjs"`. Read as JSON as well as compared as bytes:
    // what matters to Node is the declaration, not the formatting.
    const manifestJson = byPath.get(`${RUNNER_DIR}/package.json`) ?? '';
    expect(manifestJson).toBe(RUNNER_PACKAGE_JSON);
    expect(Buffer.byteLength(manifestJson, 'utf8')).toBe(23);
    expect(JSON.parse(manifestJson)).toEqual({ type: 'module' });

    // The bytes go to GitHub and NOT to the client: the response lists each
    // runner file by path and size with empty contents (NFR: 0 bundle bytes
    // cross the API).
    const listed = (res.json().files as { path: string; contents: string; bytes?: number }[])
      .filter((f) => f.path.startsWith(`${RUNNER_DIR}/`));
    expect(listed).toHaveLength(3);
    for (const file of listed) {
      expect(file.contents).toBe('');
      expect(file.bytes).toBeGreaterThan(0);
    }

    await app.close();
  });

  it('previews the export\'s exact file list with no GitHub call and no row (AC-34)', async () => {
    const agentId = await makeAgent({
      skills: [{ name: 'House Rules', body: '# House rules\n', source: 'manual' }],
    });
    const repo = nextRepo();
    const query = '&post_as=github_review&triggers=opened&triggers=synchronize';

    const reader = await makeApp();
    const preview = await previewCi(reader.app, agentId, repo, query);

    expect(preview.statusCode).toBe(200);
    // Asserted on the mock's own call counters, not on the absence of an error:
    // a preview that threw would also make no call.
    expect(reader.github.committed).toHaveLength(0);
    expect(reader.github.openedPrs).toHaveLength(0);
    expect(await installationCount(agentId)).toBe(0);
    await reader.app.close();

    const writer = await makeApp();
    const exported = await exportCi(writer.app, agentId, repo, {
      post_as: 'github_review',
      triggers: ['opened', 'synchronize'],
    });

    expect(exported.statusCode).toBe(200);
    expect(preview.json()).toEqual(exported.json().files);
    await writer.app.close();
  });

  // ---- refusals ------------------------------------------------------------

  it('refuses the export when the whole runner directory is absent (AC-16)', async () => {
    const dir = await missingRunnerDir();
    const { app, github } = await makeApp({ runnerDir: dir });
    const agentId = await makeAgent();

    const res = await exportCi(app, agentId, nextRepo());

    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('ci_runner_bundle_missing');
    expect(errorOf(res).message).toContain('pnpm build');
    expect(errorOf(res).message).toContain('agent-runner/');
    expect(errorOf(res).message).toContain(dir);
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
    expect(await installationCount(agentId)).toBe(0);

    await app.close();
  });

  it.each(RUNNER_FILES)(
    'refuses the export when %s is missing from the bundle (AC-16)',
    async (missing) => {
      const dir = await makeRunnerDir(missing);
      const { app, github } = await makeApp({ runnerDir: dir });
      const agentId = await makeAgent();

      const res = await exportCi(app, agentId, nextRepo());

      expect(res.statusCode).toBe(409);
      // The message names the file that is missing — the user cannot otherwise
      // tell a partial build from a broken one.
      expect(errorOf(res).message).toContain(missing);
      expect(errorOf(res).message).toContain('pnpm build');
      expect(errorOf(res).message).toContain('agent-runner/');
      expect(github.committed).toHaveLength(0);
      expect(github.openedPrs).toHaveLength(0);
      expect(await installationCount(agentId)).toBe(0);

      await app.close();
    },
  );

  it('leaves no installation when GitHub rejects the commit, and says why (AC-17)', async () => {
    const github = new FailingGitHubClient();
    const { app } = await makeApp({ github });
    const agentId = await makeAgent();

    const res = await exportCi(app, agentId, nextRepo());

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(errorOf(res).message).toContain(GITHUB_FAILURE);
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
    expect(await installationCount(agentId)).toBe(0);

    await app.close();
  });

  it('refuses two skills that collapse onto one slug, leaving nothing behind (AC-33)', async () => {
    const { app, github } = await makeApp();
    const agentId = await makeAgent({
      skills: [
        { name: 'Secret leakage gate', body: 'a', source: 'manual' },
        { name: 'secret-leakage-gate', body: 'b', source: 'manual' },
      ],
    });

    const res = await exportCi(app, agentId, nextRepo());

    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('ci_slug_collision');
    expect(errorOf(res).message).toContain('"Secret leakage gate"');
    expect(errorOf(res).message).toContain('"secret-leakage-gate"');
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
    expect(await installationCount(agentId)).toBe(0);

    await app.close();
  });

  it('never returns the model key in any field of the export response (AC-10)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent({
      skills: [{ name: 'House Rules', body: '# House rules\n', source: 'manual' }],
    });

    const res = await exportCi(app, agentId, nextRepo());

    expect(res.statusCode).toBe(200);
    const body = res.json() as { files: { contents: string }[] };
    // The whole serialized body, so a key hiding in a nested field counts.
    expect(res.payload).not.toContain(FAKE_MODEL_KEY);
    expect(res.payload).not.toContain('sk-');
    for (const file of body.files) expect(file.contents).not.toContain(FAKE_MODEL_KEY);
    // And the reference IS there — otherwise this would pass on an export that
    // simply forgot to wire the secret at all.
    const workflow = body.files.find(
      (f) => (f as unknown as { path: string }).path === WORKFLOW_PATH,
    );
    expect(workflow?.contents).toContain('${{ secrets.OPENROUTER_API_KEY }}');

    await app.close();
  });

  // ---- ingest: authentication ---------------------------------------------

  it.each([
    { case: 'no Authorization header', token: null, secrets: DEFAULT_SECRETS },
    { case: 'a wrong token', token: 'devdigest-ci-token-0123456789abcdefFF', secrets: DEFAULT_SECRETS },
    { case: 'a token shorter than 32 characters', token: 'short', secrets: { ...DEFAULT_SECRETS, DEVDIGEST_CI_TOKEN: 'short' } },
    { case: 'no token configured at all', token: CI_TOKEN, secrets: { GITHUB_TOKEN: 'x' } },
  ])('answers 401 and writes nothing for $case (AC-18)', async ({ token, secrets }) => {
    const { app } = await makeApp({ secrets });
    const agentId = await makeAgent();
    const repo = nextRepo();
    const installationId = await makeInstallation(agentId, repo);

    const res = await ingest(app, validArtifact(repo), token);

    expect(res.statusCode).toBe(401);
    expect(errorOf(res).code).toBe('unauthorized');
    expect(await ciRunCount(installationId)).toBe(0);
    expect(await agentRunCount(agentId)).toBe(0);

    await app.close();
  });

  // ---- ingest: validation --------------------------------------------------

  it('answers 4xx and writes nothing for a body that fails the contract (AC-19)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();
    const installationId = await makeInstallation(agentId, repo);

    const res = await ingest(app, { repo, pr_number: 42 });

    expect(res.statusCode).toBe(422);
    expect(await ciRunCount(installationId)).toBe(0);
    expect(await agentRunCount(agentId)).toBe(0);

    await app.close();
  });

  it('answers 4xx and writes nothing for a 39-character commit_sha (AC-19)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();
    const installationId = await makeInstallation(agentId, repo);

    const res = await ingest(app, validArtifact(repo, { commit_sha: 'a'.repeat(39) }));

    expect(res.statusCode).toBe(422);
    expect(await ciRunCount(installationId)).toBe(0);
    expect(await agentRunCount(agentId)).toBe(0);

    await app.close();
  });

  it('answers 4xx and writes nothing for a run_url with a script scheme (AC-19)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();
    const installationId = await makeInstallation(agentId, repo);

    const res = await ingest(
      app,
      validArtifact(repo, { run_url: 'javascript:alert(document.cookie)' }),
    );

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await ciRunCount(installationId)).toBe(0);
    expect(await agentRunCount(agentId)).toBe(0);

    await app.close();
  });

  it('answers 4xx and writes nothing for a repository nobody installed (AC-19)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();
    const installationId = await makeInstallation(agentId, repo);

    const res = await ingest(app, validArtifact('acme/never-installed'));

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(errorOf(res).message).toContain('acme/never-installed');
    expect(await ciRunCount(installationId)).toBe(0);
    expect(await agentRunCount(agentId)).toBe(0);

    await app.close();
  });

  it('rejects a body carrying one key the contract does not declare (AC-22)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();
    const installationId = await makeInstallation(agentId, repo);

    const res = await ingest(app, { ...validArtifact(repo), verdict: 'approve' });

    expect(res.statusCode).toBe(422);
    expect(await ciRunCount(installationId)).toBe(0);
    expect(await agentRunCount(agentId)).toBe(0);

    await app.close();
  });

  // ---- ingest: the rows it writes -----------------------------------------

  it('writes an agent_runs row and a ci_runs row linked to it (AC-20, AC-31)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();
    const installationId = await makeInstallation(agentId, repo);

    const res = await ingest(app, validArtifact(repo));

    expect(res.statusCode).toBe(200);

    const [agentRun] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.agentId, agentId));
    expect(agentRun?.source).toBe('ci');
    expect(agentRun?.status).toBe('done');
    expect(agentRun?.durationMs).toBe(18_500);
    expect(agentRun?.costUsd).toBeCloseTo(0.0412, 6);
    expect(agentRun?.findingsCount).toBe(3);
    // The studio renders the runner's verdict; it never re-derives the gate.
    expect(agentRun?.blockers).toBeNull();
    expect(agentRun?.prId).toBeNull();

    const [ciRun] = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
    expect(ciRun?.prNumber).toBe(42);
    expect(ciRun?.commitSha).toBe('a'.repeat(40));
    expect(ciRun?.agentRunId).toBe(agentRun!.id);
    expect(ciRun?.githubUrl).toBe('https://github.com/acme/widgets/actions/runs/1234567890');
    expect(ciRun?.source).toBe('gha');
    // Three findings and a non-zero exit code — the runner's own verdict.
    expect(ciRun?.status).toBe('failed');

    // Both new columns read back through the list, which is the only thing that
    // proves `agent_run_id` is usable rather than merely stored: `duration_s`
    // can only come from the joined `agent_runs` row.
    const list = await app.inject({ method: 'GET', url: '/ci/runs' });
    expect(list.statusCode).toBe(200);
    const row = (list.json() as { id: string; duration_s: number | null; repo: string | null }[])
      .find((r) => r.id === ciRun!.id);
    expect(row?.duration_s).toBe(18.5);
    expect(row?.repo).toBe(repo);

    await app.close();
  });

  it('writes one pair of rows when the same result arrives twice (AC-21)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();
    const installationId = await makeInstallation(agentId, repo);

    const first = await ingest(app, validArtifact(repo));
    const second = await ingest(app, validArtifact(repo));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(await agentRunCount(agentId)).toBe(1);
    expect(await ciRunCount(installationId)).toBe(1);

    await app.close();
  });

  it('takes the workspace from the installation, never from the request (AC-23)', async () => {
    // A SECOND workspace, so the case can actually fail: with one workspace,
    // "the right workspace" and "the only workspace" are indistinguishable.
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${seq++}` })
      .returning();
    const otherWorkspaceId = other!.id;
    expect(otherWorkspaceId).not.toBe(workspaceId);

    const { app } = await makeApp();
    const agentId = await makeAgent({ workspaceId: otherWorkspaceId });
    const repo = nextRepo();
    await makeInstallation(agentId, repo);

    const res = await ingest(app, validArtifact(repo));

    expect(res.statusCode).toBe(200);
    const [agentRun] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.agentId, agentId));
    expect(agentRun?.workspaceId).toBe(otherWorkspaceId);
    expect(agentRun?.workspaceId).not.toBe(workspaceId);

    // And the run is invisible to the default workspace's CI Runs list, which is
    // the same fact read from the other end.
    const list = await app.inject({ method: 'GET', url: '/ci/runs' });
    const ids = (list.json() as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain(res.json().id);

    await app.close();
  });

  it('shows the agent its installations and the runner version (AC-27, data half)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent();
    const repo = nextRepo();
    await makeInstallation(agentId, repo);
    await ingest(app, validArtifact(repo));

    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/ci` });

    expect(res.statusCode).toBe(200);
    const view = res.json() as {
      installations: { repo: string; target_type: string; installed_at: string }[];
      runs: { pr_number: number }[];
      runner_version: string;
    };
    expect(view.installations).toHaveLength(1);
    expect(view.installations[0]!.repo).toBe(repo);
    expect(view.installations[0]!.target_type).toBe('gha');
    expect(view.installations[0]!.installed_at).toEqual(expect.any(String));
    expect(view.runs).toHaveLength(1);
    expect(view.runs[0]!.pr_number).toBe(42);
    expect(view.runner_version).toBe(RUNNER_VERSION);
    // AC-28's other half: the CI view offers no gate field to save through.
    expect(Object.keys(view)).toEqual(['installations', 'runs', 'runner_version']);

    await app.close();
  });
});
