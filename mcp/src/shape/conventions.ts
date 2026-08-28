import type { ConventionCandidate } from '@devdigest/shared';

import type { ResponseFormat } from './findings.js';

/**
 * Pure ring — what the stored convention candidates look like once they leave
 * this server, and what to say when none of them has been accepted.
 *
 * Nothing here awaits, fetches or reads the environment: it takes the candidates
 * a caller already fetched and answers questions about them. `tools/get-conventions.ts`
 * is what turns those answers into an MCP result.
 *
 * The one rule worth stating out loud, because it is the reason this module has
 * a `describe…` function at all: **an empty accepted list is not an empty
 * answer.** `ConventionCandidate.status` was introduced to tell "nobody has
 * looked at it yet" apart from "somebody looked and said no"
 * (`server/src/vendor/shared/contracts/knowledge.ts` — the `ConventionStatus`
 * doc comment), and `ConventionExtractResult` ships `sampled_files` and
 * `discarded` for the same reason: a short list read as "this repo has three
 * conventions" when it means "seventeen rules had no evidence". So the two empty
 * cases here — the extractor has never run, and it ran but nothing has been
 * accepted — are reported as two different sentences with two different next
 * steps.
 */

/** `limit` bounds, duplicated in `schemas.ts` where the model reads them. */
export const DEFAULT_CONVENTIONS_LIMIT = 50;
export const MAX_CONVENTIONS_LIMIT = 200;

/** One accepted rule, in whichever form the caller asked for. */
export interface ConventionProjection {
  readonly rule: string;
  readonly category: string;
  /** `path:line`, or `path:start-end` for a rule grounded in a range. */
  readonly evidence: string;
  // Present only in the "detailed" form.
  readonly evidence_snippet?: string;
  readonly confidence?: number;
}

/** Exactly the shape `getConventionsOutput` publishes. */
export interface ConventionsResult {
  readonly repo: string;
  /**
   * Counts over every stored candidate — never over the truncated list below.
   * `accepted > conventions.length` is what makes truncation visible, which is
   * why there is no separate `total` field: the accepted count already is one.
   */
  readonly accepted: number;
  readonly pending: number;
  readonly rejected: number;
  readonly response_format: ResponseFormat;
  readonly conventions: readonly ConventionProjection[];
}

export interface BuildConventionsResultInput {
  readonly repo: string;
  /** Every stored candidate of the repo, in the order `GET /repos/:id/conventions` returned. */
  readonly candidates: readonly ConventionCandidate[];
  readonly responseFormat: ResponseFormat;
  readonly limit?: number | undefined;
}

export interface StatusCounts {
  readonly accepted: number;
  readonly pending: number;
  readonly rejected: number;
}

/**
 * How many candidates sit in each state.
 *
 * Counted over the whole list rather than derived from the returned rules,
 * because the pending and rejected ones never appear in the payload and are
 * still the numbers that make an empty answer readable.
 */
export function countByStatus(candidates: readonly ConventionCandidate[]): StatusCounts {
  let accepted = 0;
  let pending = 0;
  let rejected = 0;
  for (const candidate of candidates) {
    if (candidate.status === 'accepted') accepted += 1;
    else if (candidate.status === 'rejected') rejected += 1;
    else if (candidate.status === 'pending') pending += 1;
  }
  return { accepted, pending, rejected };
}

/**
 * Re-join the evidence location into the one string a reader jumps to.
 *
 * The contract stores the range as two integer columns on purpose — code slices
 * the file with them, and only a UI ever renders them back as one string
 * (`ConventionCandidate`'s doc comment, which spells the rendering as
 * `src/api/users.ts:23-31`). This tool is that UI's equivalent, so it does the
 * join here and collapses a single-line range to plain `path:line`.
 */
export function formatEvidence(candidate: ConventionCandidate): string {
  const { evidence_path: path, evidence_start_line: start, evidence_end_line: end } = candidate;
  return end > start ? `${path}:${start}-${end}` : `${path}:${start}`;
}

/**
 * Project one accepted candidate onto what the requested format publishes.
 *
 * `evidence_snippet` is the whole reason a detailed form is worth having for
 * this tool: it is the payload's bulk, it is several lines of real source per
 * rule, and a caller that only wants the house rules should not be paying for
 * it in context.
 */
export function projectConvention(
  candidate: ConventionCandidate,
  format: ResponseFormat,
): ConventionProjection {
  const concise: ConventionProjection = {
    rule: candidate.rule,
    category: candidate.category,
    evidence: formatEvidence(candidate),
  };
  if (format === 'concise') return concise;

  return {
    ...concise,
    evidence_snippet: candidate.evidence_snippet,
    confidence: candidate.confidence,
  };
}

/**
 * Clamp `limit` to the documented window.
 *
 * `schemas.ts` already validates what a model sends, so this exists for the
 * in-process caller and for the case a future SDK version stops applying
 * defaults. Silent clamping is safe *only* because `accepted` always reports the
 * untruncated count.
 */
export function clampConventionsLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_CONVENTIONS_LIMIT;
  return Math.min(MAX_CONVENTIONS_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Build the whole answer: the accepted rules, and the counts that say what else
 * is stored.
 *
 * **The API's order is preserved rather than re-sorted.** The repository orders
 * by `desc(created_at), desc(confidence), asc(id)`
 * (`server/src/modules/conventions/repository.ts`) — the secondary keys are
 * there because one extraction pass writes its whole batch in a single
 * transaction and `defaultNow()` is the transaction's timestamp, so `created_at`
 * alone cannot order within a pass. That order is already the right one to
 * truncate: newest pass first, most confident first inside it. Re-sorting here
 * would throw away the pass grouping and gain nothing.
 */
export function buildConventionsResult(input: BuildConventionsResultInput): ConventionsResult {
  const counts = countByStatus(input.candidates);
  const accepted = input.candidates.filter((candidate) => candidate.status === 'accepted');
  const limit = clampConventionsLimit(input.limit);

  return {
    repo: input.repo,
    ...counts,
    response_format: input.responseFormat,
    conventions: accepted
      .slice(0, limit)
      .map((candidate) => projectConvention(candidate, input.responseFormat)),
  };
}

/**
 * One paragraph describing what came back, for the human-readable content block.
 *
 * Three cases, and they are three sentences rather than one parameterised one
 * because they call for three different next steps:
 *
 * - **Nothing stored at all** — the extractor has never run on this repository.
 *   The next step is a person opening the Conventions screen and scanning it;
 *   it is emphatically NOT "this repository has no conventions", and the tool's
 *   own description promises that distinction in words.
 * - **Stored, none accepted** — the extractor ran and produced candidates that
 *   nobody has approved yet. The next step is a review pass in the UI, not
 *   another scan, and the pending/rejected counts are what say so.
 * - **Accepted rules** — the counts, plus whether `limit` cut the list.
 */
export function describeConventionsResult(result: ConventionsResult): string {
  const stored = result.accepted + result.pending + result.rejected;

  if (stored === 0) {
    return (
      `DevDigest has no extracted conventions stored for ${result.repo} at all: the conventions ` +
      `extractor has never run on this repository. That is NOT the same as "${result.repo} has ` +
      `no conventions" — nothing has looked yet. Run the extractor from the Conventions screen ` +
      `in DevDigest (it spends a model call, which is why no tool here does it), then call ` +
      `get_conventions again.`
    );
  }

  if (result.accepted === 0) {
    return (
      `The conventions extractor has run on ${result.repo}, but none of its candidates has been ` +
      `accepted yet: ${result.pending} pending, ${result.rejected} rejected. So there are no ` +
      `house rules to apply — not because the repository has none, but because nobody has ` +
      `reviewed what was extracted. Accept or reject the pending candidates on the Conventions ` +
      `screen in DevDigest, then call get_conventions again.`
    );
  }

  const shown =
    result.accepted === result.conventions.length
      ? `${result.accepted} accepted convention${result.accepted === 1 ? '' : 's'}`
      : `${result.conventions.length} of ${result.accepted} accepted conventions (limit ` +
        `reached — raise limit to see the rest)`;

  return (
    `${result.repo}: ${shown}, plus ${result.pending} pending and ${result.rejected} rejected ` +
    `candidate${result.pending + result.rejected === 1 ? '' : 's'} that are not applied. Each ` +
    `rule carries the file:line it was derived from.`
  );
}
