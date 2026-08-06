import type { ConventionCandidate, ConventionDiscard, ConventionExtractResult } from "@devdigest/shared";
import { MAX_LISTED_DISCARDS } from "./constants";

/**
 * The candidates that go into a merged skill — and the only ones that may.
 * A rejected or undecided rule reaching a prompt through the merge modal is the
 * one thing this screen must not do (L02 acceptance criteria).
 */
export function acceptedOnly(list: ConventionCandidate[]): ConventionCandidate[] {
  return list.filter((c) => c.status === "accepted");
}

/** How many candidates the user has accepted so far. */
export function acceptedCount(list: ConventionCandidate[]): number {
  return acceptedOnly(list).length;
}

/** True when every candidate is accepted — the bulk control flips to "Deselect all". */
export function allAccepted(list: ConventionCandidate[]): boolean {
  return list.length > 0 && list.every((c) => c.status === "accepted");
}

/**
 * The candidates a bulk accept/deselect actually has to write. "Accept all"
 * sweeps up rejected ones too — it is literal — and neither direction re-sends
 * a row that is already in the target status.
 */
export function bulkTargets(
  list: ConventionCandidate[],
  target: "accepted" | "pending",
): ConventionCandidate[] {
  return target === "accepted"
    ? list.filter((c) => c.status !== "accepted")
    : list.filter((c) => c.status === "accepted");
}

/** What one extraction pass actually did, in the numbers the screen shows. */
export interface ScanSummary {
  sampled: number;
  returned: number;
  kept: number;
  discarded: number;
  /** The first few rejections, verbatim, with the reason the code gave. */
  listed: ConventionDiscard[];
  /** How many more there were beyond `listed`. */
  hidden: number;
}

/**
 * Turn an extraction response into the line under the heading.
 *
 * The count of DISCARDED candidates is not a diagnostic — it is the difference
 * between "this repo has three conventions" and "the model proposed twenty and
 * seventeen of them cited lines that are not there". A short list with no
 * explanation is the single most misleading thing this screen could show, and
 * the discard reasons are also the raw material for the quality report the
 * lesson asks for.
 */
export function scanSummary(result: ConventionExtractResult): ScanSummary {
  const kept = result.candidates.length;
  const discarded = result.discarded.length;
  return {
    sampled: result.sampled_files.length,
    returned: kept + discarded,
    kept,
    discarded,
    listed: result.discarded.slice(0, MAX_LISTED_DISCARDS),
    hidden: Math.max(0, discarded - MAX_LISTED_DISCARDS),
  };
}
