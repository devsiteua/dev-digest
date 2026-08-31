import type { CiRun } from "@devdigest/shared";
import { githubPrUrl } from "../../../../lib/github-urls";

/** An ISO timestamp as local text; unparsable input is shown as it arrived. */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** A duration in seconds, rounded: 12.4 → "12s". Null is unknown, not zero. */
export function formatDuration(seconds: number | null | undefined): string | null {
  return seconds == null ? null : `${Math.round(seconds)}s`;
}

/**
 * The pull request on github.com, or null.
 *
 * The target repository need not be imported into the studio, so there is no
 * local PR page to link to and no title of our own to show — `owner/name` plus
 * `#N` is everything we honestly know about it.
 */
export function runPrUrl(run: CiRun): string | null {
  return run.repo && run.pr_number != null ? githubPrUrl(run.repo, run.pr_number) : null;
}
