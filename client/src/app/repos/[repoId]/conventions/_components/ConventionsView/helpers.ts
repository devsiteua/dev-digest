import type { ConventionCandidate } from "@devdigest/shared";

/** How many candidates the user has accepted so far. */
export function acceptedCount(list: ConventionCandidate[]): number {
  return list.filter((c) => c.status === "accepted").length;
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
