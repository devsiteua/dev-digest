/**
 * Finding formatting shared across route levels.
 *
 * `lineLabel` started life colocated with `FindingCard`, but the findings tooltip
 * on the PR *list* renders the same `file:line` anchor and sits one directory up.
 * Reaching down into a sibling route's `_components` for it would be worse than
 * lifting it here — the co-location rule is about feature logic, not about a
 * formatter two surfaces share.
 */
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";

/** Format a finding's line range ("11" when single-line, else "11-15"). */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/**
 * The findings behind the PR list's FINDINGS column.
 *
 * It has to pick the review the *server* counted, or the popover would list
 * findings the numbers above it do not describe: `GET /repos/:id/pulls` tallies
 * the newest `kind: "review"` row and ignores summaries, so this does the same.
 * Sorting locally rather than trusting the endpoint's order keeps that guarantee
 * independent of a repository-level `orderBy`.
 */
export function latestReviewFindings(reviews: ReviewRecord[]): FindingRecord[] {
  const latest = reviews
    .filter((r) => r.kind === "review")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return latest?.findings ?? [];
}
