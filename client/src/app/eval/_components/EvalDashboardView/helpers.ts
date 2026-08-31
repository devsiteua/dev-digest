import type { EvalRunRecord } from "@devdigest/shared";

/**
 * A per-case ratio as a percentage, or `—`.
 *
 * The same rule `MetricRow` enforces for a batch, applied to a table cell, and it
 * needs all three inputs to be honest:
 *
 *  - a case that ERRORED has no metrics at all, hence `status`;
 *  - a `null` metric was never computed, and rounding it prints a number nobody
 *    measured;
 *  - a metric with an EMPTY denominator is stored as `1` because the contract
 *    cannot carry `null` — and `1` is not a result. A `must_not_flag` case
 *    asserts no expectation about recall, so it is written `recall: 1`,
 *    `expected_count: 0`, `status: 'passed'`: every guard but the denominator
 *    misses it, and the cell would read a confident 100% for a question the case
 *    never asked.
 */
export function cellPercent(
  value: number | null,
  denominator: number | null,
  status: EvalRunRecord["status"],
): string {
  if (status === "errored" || value === null) return "—";
  if (denominator === 0 || denominator === null) return "—";
  return `${Math.round(value * 100)}%`;
}
