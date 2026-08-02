import type { ReviewRecord, SeverityCounts } from "@devdigest/shared";
import { severityCounts } from "@/lib/severity";

/**
 * run_id → that run's findings tally, for the timeline rows.
 *
 * Derived from the reviews this tab already holds rather than fetched: the
 * timeline's `RunSummary` carries `findings_count` and `blockers` but no
 * per-severity breakdown, and adding one would mean a migration or a findings
 * join on a hot endpoint. The tab already pairs runs with reviews by `run_id`
 * for the cost badge; this is the same pairing.
 *
 * A run with no review — deleted, failed, or still going — is simply absent, and
 * the row falls back to its plain "{n} finding(s)" text. That is the honest
 * outcome: once a review is deleted its findings are gone, so a count of them
 * would be describing nothing.
 */
export function severityCountsByRun(reviews: ReviewRecord[]): Record<string, SeverityCounts> {
  const byRun: Record<string, SeverityCounts> = {};
  for (const review of reviews) {
    if (review.run_id) byRun[review.run_id] = severityCounts(review.findings);
  }
  return byRun;
}
