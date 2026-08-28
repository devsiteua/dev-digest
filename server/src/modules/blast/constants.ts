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
