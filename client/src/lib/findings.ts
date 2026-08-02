/**
 * Finding formatting shared across route levels.
 *
 * `lineLabel` started life colocated with `FindingCard`, but the findings tooltip
 * on the PR *list* renders the same `file:line` anchor and sits one directory up.
 * Reaching down into a sibling route's `_components` for it would be worse than
 * lifting it here — the co-location rule is about feature logic, not about a
 * formatter two surfaces share.
 */
import type { FindingRecord } from "@devdigest/shared";

/** Format a finding's line range ("11" when single-line, else "11-15"). */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}
