/**
 * Evals — the literals. Every number a caller rejects on lives here, so a
 * rejection message and the limit it names cannot drift apart.
 */

/**
 * The largest frozen input a case may carry, in characters.
 *
 * A case is a SNAPSHOT: the diff is stored whole so a run months later measures
 * the same input. Oversized diffs are refused rather than truncated — a silently
 * shortened snapshot would make every later metric a measurement of a different
 * case than the one the name suggests.
 */
export const MAX_INPUT_DIFF_CHARS = 100_000;

/**
 * The most cases one batch may cover.
 *
 * A cap that silently took the first 50 would make the denominator a function of
 * row ordering, which is the same defect that rules out a one-case run. The set
 * is refused instead, with the limit named.
 */
export const MAX_CASES_PER_RUN = 50;

/**
 * The `AppError` codes this module answers with.
 *
 * They are here rather than inline because a Zod route schema can only ever
 * answer 422: every rejection below is thrown from the service or a pure guard,
 * carries its own status, and is the exception documented in `routes.ts`.
 */
export const EVAL_ERRORS = {
  /** AC-06 — the frozen diff would exceed `MAX_INPUT_DIFF_CHARS`. */
  diffTooLarge: 'eval_case_diff_too_large',
  /** AC-16 — the agent's set is larger than `MAX_CASES_PER_RUN`. */
  tooManyCases: 'eval_run_too_many_cases',
  /** AC-03's server half — the finding carries neither an accept nor a dismiss. */
  notDecided: 'eval_case_not_decided',
  /** AC-30 — the finding's review names no agent, and a case needs an owner. */
  noOwner: 'eval_case_no_owner',
  /** AC-13 — that agent already has a batch in flight. */
  runInFlight: 'eval_run_already_running',
} as const;
