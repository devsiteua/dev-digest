import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentCiView,
  CiExport,
  CiExportInput,
  CiFile,
  CiIngestInput,
  CiInstallation,
  CiRun,
  CommitFile,
  RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { CiRepository, type CiInstallationRow } from './repository.js';
import {
  CI_BRANCH,
  CI_RUNS_LIMIT,
  MAX_BUNDLE_BYTES,
  RUNNER_DIR,
  RUNNER_FILES,
  RUNNER_VERSION,
} from './constants.js';
import {
  assertUniqueSlugs,
  bundleFiles,
  ciRunStatus,
  toCiRunDto,
  type RunnerFileName,
} from './helpers.js';
import { agentSlug, buildManifestYaml, buildSkillFiles } from './manifest.js';
import { buildWorkflowYaml } from './workflow.js';

/**
 * Export an agent into a target repository's CI.
 *
 * Two entry points over one assembler. `buildBundle` is the read-only Preview:
 * it touches the database and the local filesystem and nothing else — no GitHub
 * call, no row (AC-34). `exportToCi` assembles the SAME bundle first, so a
 * missing runner build costs no network round trip and leaves nothing behind,
 * then commits, opens a pull request if one is not already open, and only then
 * records the installation.
 *
 * "Only then" is the whole ordering argument: a row written before GitHub
 * succeeded would claim an installation that does not exist, and the CI tab
 * would show a repository the workflow was never committed to (AC-17).
 */
export class CiService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  /**
   * The file list the Preview renders, and the same list the export commits.
   *
   * The three runner entries carry a path and a byte count with EMPTY contents:
   * the client has no use for 1.6 MB of bundled JavaScript, and holding it in a
   * query cache per preview is the NFR this is measured against.
   */
  async buildBundle(
    workspaceId: string,
    agentId: string,
    input: Pick<CiExportInput, 'post_as' | 'triggers'>,
  ): Promise<CiFile[]> {
    const { files } = await this.assemble(workspaceId, agentId, input);
    return files;
  }

  async exportToCi(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExport> {
    // Assemble BEFORE reaching for GitHub. A refusal here (no runner build, a
    // slug collision) must cost no network call and leave no row (AC-16, AC-33).
    const { files, runner } = await this.assemble(workspaceId, agentId, input);
    const repoRef = parseRepo(input.repo);

    const gh = await this.container.github();

    // The generated files carry their real contents; the runner files carry
    // theirs from disk under their own names, `package.json` included — that
    // file is what scopes the ESM module type to `.devdigest/runner/` and makes
    // the bundle runnable in a repository declaring `"type": "commonjs"` (AC-35).
    const commitPayload: CommitFile[] = [
      ...files
        .filter((f) => !f.path.startsWith(`${RUNNER_DIR}/`))
        .map((f) => ({ path: f.path, contents: f.contents })),
      ...runner.map((f) => ({ path: `${RUNNER_DIR}/${f.name}`, contents: f.contents })),
    ];

    // Never the base branch (AC-14): the workflow arrives as a pull request the
    // target repository's owner reviews, because the `permissions` block is the
    // thing they are being asked to approve.
    await gh.commitFiles(repoRef, {
      branch: CI_BRANCH,
      base: input.base,
      message: 'chore(devdigest): add the CI review workflow and agent bundle',
      files: commitPayload,
    });

    // Re-publishing reuses the open pull request rather than opening a second
    // one (AC-15) — `commitFiles` fast-forwards the branch, so the existing PR
    // already shows the new commit.
    const open = await gh.findOpenPr(repoRef, CI_BRANCH);
    const pr =
      open ??
      (await gh.openPullRequest(repoRef, {
        title: 'Add the DevDigest review workflow',
        head: CI_BRANCH,
        base: input.base,
        body: PR_BODY,
      }));

    // After GitHub, and reusing the row for the same agent + repository so a
    // second install does not create a second installation (AC-15, AC-17).
    const existing = await this.repo.findInstallation(workspaceId, agentId, input.repo);
    const installation =
      existing ??
      (await this.repo.insertInstallation({
        agentId,
        repo: input.repo,
        targetType: input.target,
      }));

    return { installation: toInstallationDto(installation), files, pr_url: pr.url };
  }

  /**
   * Ingest one `devdigest-result.json` posted back by a CI job.
   *
   * Nothing in the request decides which workspace this lands in — the
   * installation resolved from `repo` does, and it is the only thing that can
   * (AC-23). An unknown repository is refused with no row written, because a
   * result nobody installed is not ours to record (AC-19).
   *
   * Idempotent on (installation, PR, commit): the same job re-posting its
   * artifact must not double-count a review (AC-21).
   */
  async ingest(input: CiIngestInput): Promise<CiRun> {
    const target = await this.repo.findInstallationByRepo(input.repo);
    if (!target) {
      throw new NotFoundError(`No CI installation for repository "${input.repo}"`);
    }

    const existing = await this.repo.findRun(
      target.installation.id,
      input.pr_number,
      input.commit_sha,
    );
    if (existing) {
      return toCiRunDto({
        run: existing,
        repo: target.installation.repo,
        agentName: null,
        durationMs: null,
      });
    }

    const ranAt = new Date();
    const run = await this.repo.recordRun({
      agentRun: {
        workspaceId: target.workspaceId,
        agentId: target.agentId,
        ranAt,
        // The run happened in someone else's CI, so there is no local pull
        // request to hang it on, and `blockers` stays null: the studio renders
        // the runner's verdict and never re-derives the gate.
        prId: null,
        blockers: null,
        source: 'ci',
        status: 'done',
        durationMs: input.result.duration_ms ?? null,
        costUsd: input.result.cost_usd,
        findingsCount: input.result.findings_count,
      },
      ciRun: {
        ciInstallationId: target.installation.id,
        prNumber: input.pr_number,
        commitSha: input.commit_sha,
        ranAt,
        status: ciRunStatus(input.result.findings_count, input.exit_code),
        findingsCount: input.result.findings_count,
        costUsd: input.result.cost_usd,
        githubUrl: input.run_url,
        source: 'gha',
      },
    });

    return toCiRunDto({
      run,
      // The installation's own repository, never `input.repo` — the request
      // body does not decide what this run belongs to (AC-23).
      repo: target.installation.repo,
      agentName: null,
      durationMs: input.result.duration_ms ?? null,
    });
  }

  /** The CI Runs page: the most recent runs in this workspace. */
  async listRuns(workspaceId: string): Promise<CiRun[]> {
    const rows = await this.repo.listRuns(workspaceId, CI_RUNS_LIMIT);
    return rows.map(toCiRunDto);
  }

  /**
   * The agent's CI tab.
   *
   * It deliberately carries NO `ci_fail_on`: the tab already holds the agent it
   * is rendering, and saving that field goes through the existing agent update.
   * A second copy here would be a second place to keep in step for no gain.
   */
  async agentCiView(workspaceId: string, agentId: string): Promise<AgentCiView> {
    const [installations, runs] = await Promise.all([
      this.repo.listInstallations(workspaceId, agentId),
      this.repo.listRunsForAgent(workspaceId, agentId, CI_RUNS_LIMIT),
    ]);
    return {
      installations: installations.map(toInstallationDto),
      runs: runs.map(toCiRunDto),
      runner_version: RUNNER_VERSION,
    };
  }

  /**
   * Everything both paths share: the agent, its skills, the generated text and
   * the runner bytes.
   *
   * Returns the runner contents alongside the `CiFile[]` so the export reads the
   * bundle exactly once. The `CiFile[]` never carries those bytes.
   */
  private async assemble(
    workspaceId: string,
    agentId: string,
    input: Pick<CiExportInput, 'post_as' | 'triggers'>,
  ): Promise<{ files: CiFile[]; runner: RunnerFileContents[] }> {
    const found = await this.repo.agentWithSkills(workspaceId, agentId);
    if (!found) throw new NotFoundError('Agent not found');
    const { agent, skills } = found;

    // Before any disk read: two skills collapsing onto one slug would silently
    // overwrite each other in `.devdigest/skills/` (AC-33).
    assertUniqueSlugs(skills);

    const skillFiles = buildSkillFiles(skills);
    const runner = await this.readRunnerBundle();

    const runnerSizes = Object.fromEntries(
      runner.map((f) => [f.name, f.bytes]),
    ) as Record<RunnerFileName, number>;

    const files = bundleFiles({
      agentSlug: agentSlug(agent),
      manifestYaml: buildManifestYaml(agent, skillFiles.map((f) => f.slug)),
      skills: skillFiles,
      workflowYaml: buildWorkflowYaml({ triggers: input.triggers, postAs: input.post_as }),
      runnerSizes,
    });

    return { files, runner };
  }

  /**
   * Read the three files `ncc` emits, refusing clearly when any one is absent.
   *
   * `dist/` is git-ignored and nothing rebuilds it, so "not built yet" is the
   * normal first-run state rather than an exotic failure — the message names the
   * missing file and the command that produces it, because the user cannot
   * otherwise tell a missing build from a broken one (AC-16).
   */
  private async readRunnerBundle(): Promise<RunnerFileContents[]> {
    const dir = this.container.config.runnerBundleDir;
    const files: RunnerFileContents[] = [];

    for (const name of RUNNER_FILES) {
      let contents: string;
      try {
        contents = await readFile(path.join(dir, name), 'utf8');
      } catch {
        throw new AppError(
          'ci_runner_bundle_missing',
          `The runner bundle is incomplete: ${name} is missing from ${dir}. ` +
            'Run `pnpm build` in `agent-runner/` and export again.',
          409,
        );
      }
      files.push({ name, contents, bytes: Buffer.byteLength(contents, 'utf8') });
    }

    const total = files.reduce((sum, f) => sum + f.bytes, 0);
    if (total > MAX_BUNDLE_BYTES) {
      throw new AppError(
        'ci_runner_bundle_too_large',
        `The runner bundle is ${total} bytes, over the ${MAX_BUNDLE_BYTES}-byte ceiling. ` +
          'Run `pnpm build` in `agent-runner/` and export again.',
        409,
      );
    }

    return files;
  }
}

interface RunnerFileContents {
  name: RunnerFileName;
  contents: string;
  bytes: number;
}

const PR_BODY = [
  'This pull request adds a DevDigest review to this repository.',
  '',
  '- `.github/workflows/devdigest-review.yml` runs the review on every pull request',
  '  opened from this repository. Its `permissions` block is `contents: read` and',
  '  `pull-requests: write`, and every action it uses is pinned to a commit SHA.',
  '- `.devdigest/` holds the agent manifest, its skills, and the self-contained',
  '  runner the workflow executes. Nothing is fetched at run time.',
  '',
  'Set `OPENROUTER_API_KEY` in this repository’s Actions secrets before merging.',
].join('\n');

/** "owner/name" → the `RepoRef` every GitHub port method takes. */
function parseRepo(repo: string): RepoRef {
  const [owner, name, ...rest] = repo.split('/');
  if (!owner || !name || rest.length > 0) {
    throw new AppError('ci_invalid_repo', `Expected "owner/name", got "${repo}".`, 400);
  }
  return { owner, name };
}

function toInstallationDto(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
  };
}
