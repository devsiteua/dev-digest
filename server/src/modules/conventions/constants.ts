import type { FeatureModelChoice } from '@devdigest/shared';

/** Constants for the conventions extractor. */

/**
 * How many top-ranked source files one extraction pass looks at.
 *
 * The sample is picked by `repoIntel.getConventionSamples(repoId, n)`, which
 * already ranks files and drops tests, configs and migrations. This number is
 * therefore the cost knob for the whole feature: it multiplies straight into the
 * prompt, and the prompt is the bill. Twelve files is enough for a house style to
 * repeat itself — a convention that shows up in only one file is not one.
 */
export const SAMPLE_FILE_COUNT = 12;

/**
 * Root-level config files worth showing the model, in the order they are offered.
 *
 * These are *declared* conventions — a repo that ships an ESLint config has
 * already written some of its rules down, and a rule the linter enforces is one
 * the extractor should not claim to have discovered in the code. Every plausible
 * filename is listed because the caller probes the clone for each one and keeps
 * the hits: there is no globbing on the read path (`git.readFile` takes a path),
 * and a config family whose variant we forgot is simply invisible.
 *
 * Order is prompt order, so it runs declared-rules-first (lint, then compiler,
 * then formatting) and ends with the two files that mostly carry tooling
 * metadata.
 */
export const CONFIG_FILES: readonly string[] = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  'package.json',
  '.editorconfig',
];

/**
 * Character budget for ONE sample, applied after line numbering.
 *
 * A single 200 kB generated file would otherwise eat the whole prompt and push
 * the other eleven samples out, which is the worst possible way to spend the
 * budget: conventions are found by repetition across files, not by depth in one.
 * Cutting the tail keeps every surviving line at its real file line number, so
 * an `evidence_start_line` the model reads off the sample still verifies.
 */
export const MAX_SAMPLE_CHARS = 4_000;

/**
 * Character budget for the assembled prompt.
 *
 * A backstop, not a routine truncator: `SAMPLE_FILE_COUNT` files plus the handful
 * of configs a real repo actually has, each already capped at
 * `MAX_SAMPLE_CHARS`, fit under this by construction. It exists so a repo with
 * an unusual number of config files cannot quietly double the bill.
 */
export const MAX_PROMPT_CHARS = 80_000;

/**
 * Most candidates accepted from one model reply.
 *
 * Not a display limit — the ceiling on how much work the verification pass can be
 * made to do by a reply that returns two hundred rules. Anything past it is
 * reported as a discard, never dropped silently.
 */
export const MAX_CANDIDATES = 20;

/**
 * Longest rule text kept. A convention is a one-line directive ("Return early
 * instead of nesting"); anything longer is the model writing prose, and prose is
 * what makes a merged skill unreadable once ten of these are concatenated.
 */
export const MAX_RULE_CHARS = 160;

/**
 * How far, in lines, a snippet may sit from where the model said it does.
 *
 * Models miscount line numbers by a line or two routinely — that is a formatting
 * error, not a hallucination, and rejecting it would throw away good evidence.
 * The snippet still has to be found inside the window, and the numbers we store
 * are the ones where it was actually found. Widening this trades grounding for
 * recall: at some point "near line 40" stops meaning anything.
 */
export const SNIPPET_CONTEXT_LINES = 2;

/**
 * The model this module uses when the workspace has not picked one.
 *
 * Deliberately NOT `resolveFeatureModel(container, ws, 'conventions')`. The
 * registry's default for `conventions` is `openai / gpt-5.4` — the priciest entry
 * in `FEATURE_MODELS`, and one that mirrors nothing, because there was no
 * conventions module to have a constant when the registry was written. The
 * caller asks `getFeatureModelOverride()` for the workspace's choice and falls
 * back to this, so a user who picked a model still gets it.
 */
export const DEFAULT_CONVENTIONS_MODEL: FeatureModelChoice = {
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
};
