import type { WorkingReviewResponse } from '@devdigest/shared';

import { ApiClient } from './api/client.js';
import { loadConfig } from './config.js';
import { isDevDigestApiError } from './errors.js';
import {
  CliUsageError,
  helpText,
  IMPLEMENTED_MODES,
  notImplementedMessage,
  parseArgs,
} from './cli/args.js';
import { GitError, repoRoot, workingDiff } from './cli/git.js';
import { EXIT_FAILED, exitCodeFor, renderReport } from './cli/render.js';

/**
 * `devdigest review` — the SECOND entry point of this package.
 *
 * It writes to stdout, and that is not a violation of the stdout rule: the rule
 * is scoped to the process it protects, and this is a different process. Nothing
 * reachable from `src/index.ts` prints — see `CLAUDE.md` § Conventions, and
 * `test/stdio-purity.test.ts`, which spawns THAT entry point by name.
 *
 * The division of labour is the same as the MCP server's: this file knows about
 * a terminal and an exit code, `cli/git.ts` knows about a subprocess,
 * `api/client.ts` knows about HTTP, and `cli/args.ts` and `cli/render.ts` are
 * pure and carry every rule worth a test.
 *
 * The review itself is `POST /reviews/working` on the API, which runs the same
 * engine and the same input builders as a pull-request review. There is no
 * second reviewer here — there is not even a prompt.
 */
async function main(argv: readonly string[]): Promise<number> {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    process.stderr.write(`${error.message}\n\n${helpText()}\n`);
    return EXIT_FAILED;
  }

  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  if (!IMPLEMENTED_MODES.includes(options.mode)) {
    // Declared, not implemented — and it says which, rather than pretending the
    // flag does not exist or quietly reviewing the working tree instead.
    process.stderr.write(`${notImplementedMessage(options.mode)}\n`);
    return EXIT_FAILED;
  }

  const config = loadConfig(process.env);
  const api = new ApiClient({ baseUrl: config.apiBaseUrl, fetch: globalThis.fetch });

  try {
    const root = await repoRoot(process.cwd());
    const diff = await workingDiff(root);
    if (diff.trim().length === 0) {
      // Not a failure, and not a review either: there is nothing to look at.
      // Exit 0, because a CI step that runs this on a clean tree has nothing to
      // block on.
      process.stdout.write(
        'No uncommitted changes to tracked files. (Untracked files are not reviewed — see --help.)\n',
      );
      return 0;
    }

    const agent = options.agent ?? (await firstAgentName(api));
    if (agent === null) {
      process.stderr.write(
        'DevDigest has no reviewer agents configured. Add one in the Agents screen, or pass --agent.\n',
      );
      return EXIT_FAILED;
    }
    const result = await api.post<WorkingReviewResponse>('/reviews/working', { agent, diff });

    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderReport(result)}\n`);
    return exitCodeFor(result);
  } catch (error) {
    if (error instanceof GitError || isDevDigestApiError(error)) {
      process.stderr.write(`${error.message}\n`);
      return EXIT_FAILED;
    }
    throw error;
  }
}

/**
 * The agent to run when `--agent` was not given: the first one DevDigest has,
 * or `null` when it has none.
 *
 * Deliberately not "all enabled agents". One invocation is one model call, and a
 * command that fans out to every agent because a flag was omitted spends money
 * nobody asked it to — the same rule `run_agent_on_pr` follows in requiring
 * `agent` rather than accepting `{ all: true }`.
 */
async function firstAgentName(api: ApiClient): Promise<string | null> {
  const agents = await api.get<Array<{ name: string; enabled?: boolean }>>('/agents');
  // `GET /agents` is `select().from(agents)` with no ORDER BY and no `enabled`
  // filter, so `agents[0]` is planner order — the same trap the root CLAUDE.md
  // records for "latest per group" reads. Left alone, two runs of the same
  // command on the same tree could be reviewed by different agents, and a
  // reviewer the user switched OFF in the studio could be the one billed.
  const usable = agents.filter((agent) => agent.enabled !== false);
  const [first] = [...usable].sort((a, b) => a.name.localeCompare(b.name));
  return first?.name ?? null;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // The last resort: an error no branch above claimed. It still leaves exit 2,
    // because the promise this command makes is that 0 and 1 mean the review RAN.
    process.stderr.write(`devdigest review failed: ${(error as Error).message}\n`);
    process.exitCode = EXIT_FAILED;
  });
