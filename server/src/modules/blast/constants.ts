import type { FeatureModelChoice } from '@devdigest/shared';

/**
 * Constants for the Blast Radius (L04).
 *
 * Every path rule and every number this feature decides with lives here, for
 * the reason `modules/smart-diff/constants.ts` gives: the classification is the
 * part a reviewer will argue with ("why is my route missing?"), and an argument
 * is only settleable if the whole rule set is readable in one place.
 *
 * What is NOT here: the caller cap and the graph depth. Both belong to the
 * index that answers the question — `MAX_CALLERS_PER_SYMBOL` and `BFS_DEPTH`
 * are `modules/repo-intel/constants.ts` — and this module imports nothing from
 * a sibling module (see `routes.ts` for why).
 */

/**
 * How many further reverse hops the map walks BEYOND a symbol's own callers.
 *
 * The arithmetic, because it is easy to get off by one: a symbol's callers are
 * the files whose references resolved to the changed file, so by construction
 * they are its direct importers — level 1. One more reverse hop reaches level 2,
 * which is the total depth from the changed file that repo-intel's `BFS_DEPTH`
 * names. Raising this to 2 would make the map three levels deep, not two.
 */
export const DOWNSTREAM_HOPS_BEYOND_CALLERS = 1;

/**
 * What makes a file a TEST, for the purpose of reading facts off it.
 *
 * A test file can register routes. In the demo repository `tests/router.test.ts`
 * carries `file_facts.endpoints = ["GET /orders", "POST /orders"]` while
 * `POST /orders` exists nowhere in production code — so an unfiltered map would
 * tell a reviewer their change reaches an endpoint that does not exist.
 *
 * This drops the FILE, not the endpoint, so a test file's crons go with it for
 * the same reason: a schedule declared in a spec is not a job that runs.
 *
 * Callers from test files are deliberately KEPT — those are real calls of real
 * code, and a test is often the first place a signature change breaks.
 *
 * Matched as a substring of the lowercased path with a leading `/` prepended —
 * the same shape `modules/repo-intel/service.ts` (`JUNK_PATH_PATTERNS`) uses,
 * with the slashes kept so a DIRECTORY rule stays a directory rule: without the
 * leading one, `test/` also matches `src/latest/index.ts`.
 */
export const TEST_PATH_PATTERNS: readonly string[] = [
  '.test.',
  '.spec.',
  '/__tests__/',
  '/__mocks__/',
  '/test/',
  '/tests/',
  '/spec/',
  '/e2e/',
  '/__fixtures__/',
];

// ---- The one optional model call -------------------------------------------

/**
 * The model that turns an already-computed map into one paragraph.
 *
 * A MODULE-LOCAL constant, and deliberately not `resolveFeatureModel`: that
 * helper is keyed by `FeatureModelId`, which is a fixed five-value enum in
 * `contracts/platform.ts`. A sixth entry would cost two `vendor/shared` mirror
 * edits, the client's duplicate registry and a Settings row — for one paragraph
 * behind a button. It would also inherit that registry's trap, recorded in the
 * root `INSIGHTS.md` on 2026-08-06: its defaults promise to mirror each module's
 * own constant, a promise it cannot keep for a module written after it.
 *
 * The same cheap model the other small structured features here use
 * (`DEFAULT_INTENT_MODEL`, `DEFAULT_CONVENTIONS_MODEL`): the call is a few
 * hundred tokens of already-computed facts in and one paragraph out, so price
 * and schema adherence decide it, not reasoning depth.
 */
export const BLAST_EXPLAIN_MODEL: FeatureModelChoice = {
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
};

/** How long one explanation may take before the request gives up. */
export const BLAST_EXPLAIN_TIMEOUT_MS = 45_000;

/**
 * How many symbols, callers and routes the prompt may carry.
 *
 * The map is already capped at 20 callers per symbol, but a wide diff can still
 * declare hundreds of symbols, and this is a paragraph rather than a report.
 * Trimming here is visible in the prompt itself — the counts are stated — so the
 * model is never left to imply it saw everything.
 */
export const EXPLAIN_MAX_SYMBOLS = 12;
export const EXPLAIN_MAX_CALLERS_PER_SYMBOL = 6;
export const EXPLAIN_MAX_ENDPOINTS_PER_SYMBOL = 8;

/**
 * The whole instruction. It says what the model may do — rephrase — and what it
 * may not: add a node, a route or a risk that is not in the list it was handed.
 *
 * That prohibition is the reason this endpoint is safe to have at all. Every
 * node and edge in the map came out of the index; a paragraph that invents one
 * more would put a claim nobody checked next to a set of claims that were.
 */
export const BLAST_EXPLAIN_SYSTEM_PROMPT = [
  'You explain the blast radius of a pull request to the engineer reviewing it.',
  '',
  'You are given a map that has ALREADY been computed from a static index of the',
  'repository: the symbols the diff changed, the call sites that reach them, and',
  'the HTTP endpoints and scheduled jobs downstream of those call sites.',
  '',
  'Write ONE paragraph of at most four sentences, in plain English, saying what a',
  'reviewer should watch out for given that map. Lead with what is most exposed —',
  'a public endpoint or a scheduled job outranks an internal caller.',
  '',
  'Rules you must not break:',
  '- Use ONLY the symbols, files, endpoints and jobs listed below. Never name one',
  '  that is not there, and never invent a file path or a route.',
  '- Do not guess at what the code does. You have not seen it — you have seen',
  '  names and a graph.',
  '- If the map is small or empty, say so plainly. Do not pad it.',
  '- No headings, no bullet points, no code fences. One paragraph.',
].join('\n');
