import type { EvalRunRecord } from "@devdigest/shared";

/**
 * A per-case ratio as a percentage, or `—`.
 *
 * The same rule `MetricRow` enforces for a batch, applied to a table cell: a
 * `null` metric is one that was never computed, and rounding it would print a
 * number nobody measured. A case that ERRORED has no metrics at all, which is
 * why `status` is consulted rather than only the value.
 */
export function cellPercent(value: number | null, status: EvalRunRecord["status"]): string {
  if (status === "errored" || value === null) return "—";
  return `${Math.round(value * 100)}%`;
}
