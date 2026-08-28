import type { FindingRecord, ReviewRecord, Severity, Verdict } from '@devdigest/shared';

/**
 * Pure ring — which review counts as "the latest", and what a finding looks like
 * once it leaves this server.
 *
 * Nothing here awaits, fetches or reads the environment: it takes the reviews a
 * caller already fetched and answers questions about them. That is what makes
 * the D7 tie-break testable with two literals instead of a database.
 */

export type ResponseFormat = 'concise' | 'detailed';

/** `limit` bounds, duplicated in `schemas.ts` where the model reads them. */
export const DEFAULT_FINDINGS_LIMIT = 20;
export const MAX_FINDINGS_LIMIT = 100;

/**
 * Severity order for the returned list: worst first, always.
 *
 * A truncated response therefore drops SUGGESTIONs before it drops a CRITICAL —
 * which is the only ordering under which `limit` is safe to have at all.
 */
const SEVERITY_RANK: Readonly<Record<string, number>> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** Whichever of the two identifiers the caller managed to resolve. */
export interface AgentRef {
  readonly id?: string | null;
  readonly name: string;
}

export interface FindingProjection {
  readonly severity: Severity;
  readonly file: string;
  readonly line: number;
  readonly title: string;
  // Present only in the "detailed" form.
  readonly id?: string;
  readonly category?: string;
  readonly rationale?: string;
  readonly suggestion?: string | null;
  readonly confidence?: number;
}

/** Exactly the shape `getFindingsOutput` / `runAgentOnPrOutput` publish. */
export interface ReviewResult {
  readonly repo: string;
  readonly pr: number;
  readonly reviewed: boolean;
  readonly agent: string | null;
  readonly verdict: Verdict | null;
  readonly score: number | null;
  readonly summary: string | null;
  readonly response_format: ResponseFormat;
  readonly findings: readonly FindingProjection[];
  /** The untruncated count. Greater than `findings.length` means `limit` cut. */
  readonly total_findings: number;
  readonly run: {
    readonly id: string | null;
    readonly status: string | null;
    readonly duration_ms: number | null;
    readonly cost_usd: number | null;
  };
}

export interface BuildReviewResultInput {
  readonly repo: string;
  readonly pr: number;
  /** Every review on the pull request, in whatever order the API returned. */
  readonly reviews: readonly ReviewRecord[];
  /** The agent the caller asked for, or null/undefined for "the most recent". */
  readonly agent?: AgentRef | null;
  readonly responseFormat: ResponseFormat;
  readonly limit?: number | undefined;
}

/**
 * Pick the review this answer is about — and **never** `reviews[0]` (D7).
 *
 * `reviewsForPull` orders by `desc(created_at)` and nothing else
 * (`server/src/modules/reviews/repository/review.repo.ts:66`), while
 * `created_at` defaults to `now()`, which in Postgres is the **transaction's**
 * start time. Three agents fanned out by one `all: true` review therefore share
 * a timestamp to the microsecond, and the order among them is whatever the
 * planner returned. So this sorts explicitly, with the same tie-break the
 * server's own latest-review read uses (`pulls/routes.ts` — `desc(created_at),
 * desc(id)`): the id cannot say which is newer, but it makes the choice STABLE,
 * which is the property a caller comparing two answers actually needs.
 *
 * `kind: 'summary'` rows are excluded before any of that. A summary is the
 * consolidated write-up across agents, not one agent's pass, and returning it as
 * "the latest review" would attribute findings to an agent that did not make
 * them.
 */
export function selectLatestReview(
  reviews: readonly ReviewRecord[],
  agent?: AgentRef | null,
): ReviewRecord | null {
  const candidates = reviews.filter(
    (review) => review.kind === 'review' && (!agent || matchesAgent(review, agent)),
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort(compareNewestFirst)[0]!;
}

/** `created_at` desc, then `id` desc. Exported so the tie-break can be tested alone. */
export function compareNewestFirst(a: ReviewRecord, b: ReviewRecord): number {
  const byTime = parseTimestamp(b.created_at) - parseTimestamp(a.created_at);
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id > b.id ? -1 : 1;
}

/**
 * Does this review belong to the agent the caller named?
 *
 * The id is the authority when both sides have one; the name is the fallback for
 * a review written before an agent was deleted, whose `agent_id` is null but
 * whose `agent_name` the API still reports.
 */
export function matchesAgent(review: ReviewRecord, agent: AgentRef): boolean {
  if (agent.id && review.agent_id) return review.agent_id === agent.id;
  const name = review.agent_name ?? '';
  return name.trim().toLowerCase() === agent.name.trim().toLowerCase();
}

/** Worst severity first; original order preserved inside a severity (stable sort). */
export function sortFindings(findings: readonly FindingRecord[]): FindingRecord[] {
  return [...findings].sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** Project one persisted finding onto what the requested format publishes. */
export function projectFinding(
  finding: FindingRecord,
  format: ResponseFormat,
): FindingProjection {
  const concise: FindingProjection = {
    severity: finding.severity,
    file: finding.file,
    // One line, not a range: `start_line` is where a reader jumps, and the
    // grounding gate already guarantees it intersects a real diff hunk.
    line: finding.start_line,
    title: finding.title,
  };
  if (format === 'concise') return concise;

  return {
    ...concise,
    id: finding.id,
    category: finding.category,
    rationale: finding.rationale,
    suggestion: finding.suggestion ?? null,
    confidence: finding.confidence,
  };
}

/**
 * Clamp `limit` to the documented window.
 *
 * `schemas.ts` already validates what a model sends, so this exists for the
 * in-process caller (`run_agent_on_pr`, which passes none) and for the case a
 * future SDK version stops applying defaults. Silent clamping is safe *only*
 * because `total_findings` always reports the untruncated count.
 */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_FINDINGS_LIMIT;
  return Math.min(MAX_FINDINGS_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Build the whole answer: the selected review, its findings, and the honest
 * total beside them.
 *
 * A pull request nobody has reviewed comes back as `reviewed: false` with the
 * reason in `summary` — not as an empty `findings` array, which reads as "the
 * reviewers looked and found nothing". That distinction is the same one
 * `get_blast_radius` exists to make, and the tool's own description promises it
 * in words.
 */
export function buildReviewResult(input: BuildReviewResultInput): ReviewResult {
  const review = selectLatestReview(input.reviews, input.agent);
  if (!review) {
    return {
      repo: input.repo,
      pr: input.pr,
      reviewed: false,
      agent: null,
      verdict: null,
      score: null,
      // The one free-text field in the published shape. `reviewed: false` is
      // what marks it as an explanation rather than a review's own summary.
      summary: describeNoReview(input),
      response_format: input.responseFormat,
      findings: [],
      total_findings: 0,
      run: { id: null, status: null, duration_ms: null, cost_usd: null },
    };
  }

  const sorted = sortFindings(review.findings);
  const limit = clampLimit(input.limit);
  return {
    repo: input.repo,
    pr: input.pr,
    reviewed: true,
    // Named even when the caller did not ask for an agent — with no `agent`
    // argument this is the only thing that says whose pass was returned.
    agent: review.agent_name ?? null,
    verdict: review.verdict,
    score: review.score,
    summary: review.summary,
    response_format: input.responseFormat,
    findings: sorted.slice(0, limit).map((f) => projectFinding(f, input.responseFormat)),
    total_findings: sorted.length,
    run: {
      // `get_findings` read a persisted review, so the run id is all it knows.
      // A null here means "not read", never "zero" — see `runOutput` in schemas.
      id: review.run_id,
      status: null,
      duration_ms: null,
      cost_usd: null,
    },
  };
}

/**
 * The sentence a caller gets when nothing has reviewed the pull request — or
 * when the agent they named has not.
 *
 * The two cases read differently on purpose: "nobody has reviewed it" and "that
 * reviewer has not, but these have" call for different next steps, and a single
 * message covering both would be right about neither.
 */
export function describeNoReview(input: BuildReviewResultInput): string {
  const target = `${input.repo}#${input.pr}`;
  const reviewers = reviewersOf(input.reviews);

  if (input.agent) {
    if (reviewers.length > 0) {
      return (
        `${input.agent.name} has not reviewed ${target} yet. These agents have: ` +
        `${reviewers.join(', ')} — call get_findings again without the agent argument to read ` +
        `the most recent of them, or run_agent_on_pr to have ${input.agent.name} review it.`
      );
    }
    return (
      `${input.agent.name} has not reviewed ${target}, and neither has any other agent. ` +
      `Run run_agent_on_pr with this repo, pr and agent to produce a review — that spends a ` +
      `real model call.`
    );
  }

  return (
    `No agent has reviewed ${target} yet, so there are no findings to read. This is not an ` +
    `empty review: nothing has looked at this pull request. Run run_agent_on_pr with an agent ` +
    `from list_agents to produce one — that spends a real model call.`
  );
}

/**
 * One line describing what came back, for the human-readable content block.
 *
 * The structured payload is the machine's answer; this is what a reader sees
 * first, so it leads with the counts that decide whether to look further.
 */
export function describeReviewResult(result: ReviewResult): string {
  if (!result.reviewed) return result.summary ?? '';

  const shown =
    result.total_findings === result.findings.length
      ? `${result.total_findings} finding${result.total_findings === 1 ? '' : 's'}`
      : `${result.findings.length} of ${result.total_findings} findings (limit reached — ` +
        `raise limit to see the rest)`;

  return (
    `${result.agent ?? 'An agent'} reviewed ${result.repo}#${result.pr}: ` +
    `verdict ${result.verdict ?? 'unknown'}, score ${result.score ?? 'unknown'}, ${shown}, ` +
    `worst severity first.`
  );
}

/** Distinct agent names that have written a `kind: 'review'` row on this PR. */
function reviewersOf(reviews: readonly ReviewRecord[]): string[] {
  const names = new Set<string>();
  for (const review of reviews) {
    if (review.kind !== 'review') continue;
    if (review.agent_name) names.add(review.agent_name);
  }
  return [...names];
}

/** Unknown severities sort last rather than first — `severity` is a free-text column. */
function rank(severity: string): number {
  return SEVERITY_RANK[severity] ?? Object.keys(SEVERITY_RANK).length;
}

/**
 * `created_at` as a number, with an unparseable value falling through to the id
 * tie-break rather than poisoning the comparison with NaN.
 */
function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
