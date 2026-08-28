/**
 * Pure ring — what the user typed, and what to print when they ask.
 *
 * Nothing here spawns, fetches or reads the environment, so every flag
 * combination is a table in `test/cli.test.ts` rather than a process.
 */

/**
 * The review modes the CLI KNOWS ABOUT, in the order `--help` lists them.
 *
 * `staged` and `branch` are declared and parse, and then fail with "not
 * implemented" — deliberately, and it is not laziness dressed up as a feature.
 * A flag that silently falls back to `working` would review the wrong diff and
 * say nothing; a flag that is rejected as unknown teaches the user that the mode
 * does not exist, which is a different and wrong lesson. This way the surface is
 * announced once and filled in later without the spelling changing.
 */
export const REVIEW_MODES = ['working', 'staged', 'branch'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

/** The only mode with an implementation behind it. */
export const IMPLEMENTED_MODES: readonly ReviewMode[] = ['working'];

export interface CliOptions {
  readonly command: 'review';
  readonly mode: ReviewMode;
  readonly agent: string | null;
  readonly help: boolean;
  readonly json: boolean;
}

export class CliUsageError extends Error {}

/**
 * Parse `process.argv.slice(2)`.
 *
 * Long flags only, in either `--flag value` or `--flag=value` form. No short
 * aliases: this is a command someone types once and then puts in a script, and
 * an alias is a second spelling to keep working forever for one saved keystroke.
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  let mode: ReviewMode = 'working';
  let agent: string | null = null;
  let help = false;
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    // `--help` only. The doc comment above forbids short aliases, and `-h` was
    // one — undocumented in `helpText()`, so it was a second spelling nobody had
    // been told about and everybody would have had to keep working.
    if (arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    const [flag, inlineValue] = splitFlag(arg);
    if (flag === '--mode' || flag === '--agent') {
      const value = inlineValue ?? argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new CliUsageError(`${flag} needs a value.`);
      }
      if (flag === '--mode') mode = asMode(value);
      else agent = value;
      continue;
    }
    if (arg.startsWith('-')) throw new CliUsageError(`Unknown option ${JSON.stringify(arg)}.`);
    positional.push(arg);
  }

  if (!help) {
    if (positional.length === 0) throw new CliUsageError('Missing command. Try: devdigest review');
    if (positional[0] !== 'review') {
      throw new CliUsageError(`Unknown command ${JSON.stringify(positional[0])}.`);
    }
    if (positional.length > 1) {
      throw new CliUsageError(`Unexpected argument ${JSON.stringify(positional[1])}.`);
    }
  }

  return { command: 'review', mode, agent, help, json };
}

function splitFlag(arg: string): [string, string | undefined] {
  const eq = arg.indexOf('=');
  return eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
}

function asMode(value: string): ReviewMode {
  const found = REVIEW_MODES.find((mode) => mode === value);
  if (!found) {
    throw new CliUsageError(
      `Unknown --mode ${JSON.stringify(value)}. One of: ${REVIEW_MODES.join(', ')}.`,
    );
  }
  return found;
}

/** The message a not-yet-implemented mode fails with. */
export function notImplementedMessage(mode: ReviewMode): string {
  return `--mode ${mode} is not implemented yet. Only --mode working reviews anything today.`;
}

/**
 * `--help`.
 *
 * The untracked-files exclusion is stated HERE and not only in a comment,
 * because it is the one way this command can quietly review less than the user
 * believes: `git diff HEAD` shows changes to tracked files, so a brand-new file
 * that has never been `git add`ed is invisible to it. Someone who has just
 * written a whole new module and gets "no findings" has to be able to find out
 * why without reading our source.
 */
export function helpText(): string {
  return [
    'devdigest review — review your uncommitted changes with a DevDigest agent.',
    '',
    'Usage:',
    // The invocation that exists. There is no `bin` entry and no build: the
    // package is private and runs through tsx, so `devdigest review` is the
    // feature's name, not a command anyone can type.
    '  pnpm review -- [--mode working] [--agent <name-or-slug>] [--json]',
    '',
    'Options:',
    '  --mode <mode>    working (default) · staged · branch.',
    '                   Only `working` is implemented; the other two parse and',
    '                   then fail, so the spelling is fixed before the feature is.',
    '  --agent <ref>    Which reviewer to run, by name or slug. Defaults to the',
    '                   first ENABLED agent by name — pass it explicitly in a',
    '                   script, so a new agent cannot change what runs.',
    '  --json           Print the raw API response instead of the finding list.',
    '  --help           This text.',
    '',
    'What is reviewed:',
    '  `git diff HEAD` — every uncommitted change to a TRACKED file, staged or not.',
    '  UNTRACKED FILES ARE EXCLUDED. A file you have created but never `git add`ed',
    '  does not appear in that diff, so nothing in it is reviewed. `git add -N <file>`',
    '  makes it visible without staging its contents.',
    '',
    'Exit codes:',
    '  0  the review ran and found nothing blocking',
    '  1  the review ran and found at least one blocking finding',
    '  2  the review could not run at all',
    '',
    'Requires the DevDigest API (./scripts/dev.sh). Override its origin with',
    'DEVDIGEST_API_URL.',
  ].join('\n');
}
