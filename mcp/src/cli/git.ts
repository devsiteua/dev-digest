import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Infrastructure ring — the two git commands this CLI runs, and nothing else.
 *
 * `execFile`, never a shell: the arguments are fixed here, but a shell would
 * make the repository path — which is whatever directory the user happens to be
 * in — part of a command string.
 */

/**
 * How much diff this command will send, in bytes.
 *
 * Matched to `MAX_WORKING_DIFF_CHARS` in the contract, not to what fits in
 * memory. An 8 MB ceiling here was worse than no ceiling: everything between the
 * server's limit and it passed this guard, got posted, came back 413 and was
 * rendered as "DevDigest rejected the request as invalid — check the arguments",
 * which is neither true nor actionable at a terminal. Refusing here says the one
 * useful sentence instead. Not imported: `mcp/` takes the contracts as TYPES
 * ONLY, so a runtime value cannot cross that boundary — the number is restated
 * with its owner named.
 */
const MAX_DIFF_BYTES = 400_000;

export class GitError extends Error {}

/** The repository root, or a GitError naming what to do instead. */
export async function repoRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim();
  } catch (error) {
    // ENOENT is not "you are in the wrong directory", it is "there is no git
    // here at all" — and telling someone without git installed to cd somewhere
    // else is the one answer that cannot help them.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new GitError('`git` was not found on PATH. Install git, or run this where git is.');
    }
    throw new GitError(
      'Not inside a git repository. Run this from a checkout — the diff it reviews is ' +
        '`git diff HEAD` in the repository you are standing in.',
    );
  }
}

/**
 * Every uncommitted change to a TRACKED file — staged and unstaged together.
 *
 * `git diff HEAD` rather than `git diff`, so a change that is already staged is
 * still reviewed: a developer stages what they are about to commit, which is
 * exactly what they most want looked at.
 *
 * UNTRACKED FILES ARE NOT IN IT. That is a property of `git diff` and it is
 * stated in `--help` rather than worked around, because every workaround makes
 * the command review something other than what git says it will.
 */
export async function workingDiff(root: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['diff', 'HEAD'], {
      cwd: root,
      maxBuffer: MAX_DIFF_BYTES,
    });
    return stdout;
  } catch (error) {
    const message = (error as { message?: string }).message ?? String(error);
    if (message.includes('maxBuffer')) {
      throw new GitError(
        `The working diff is larger than ${MAX_DIFF_BYTES} bytes, which is what the review ` +
          'endpoint accepts. Commit or stash part of it and review the rest.',
      );
    }
    throw new GitError(`\`git diff HEAD\` failed: ${message}`);
  }
}
