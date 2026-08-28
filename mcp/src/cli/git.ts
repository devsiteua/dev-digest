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

/** How much diff we are willing to hold in memory before giving up. */
const MAX_DIFF_BYTES = 8 * 1024 * 1024;

export class GitError extends Error {}

/** The repository root, or a GitError naming what to do instead. */
export async function repoRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim();
  } catch {
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
        `The working diff is larger than ${MAX_DIFF_BYTES / 1024 / 1024} MB. Commit or stash ` +
          'part of it and review the rest.',
      );
    }
    throw new GitError(`\`git diff HEAD\` failed: ${message}`);
  }
}
