import type { EvalCaseOutcome, EvalRunBatch } from "@devdigest/shared";

/** A metric and the two numbers it was computed over, ready to render. */
export interface MetricPair {
  label: string;
  before: number | null;
  beforeDenominator: number;
  after: number | null;
  afterDenominator: number;
}

/**
 * The delta between two runs of a metric — or `null` when there is not one.
 *
 * `null` whenever EITHER side has an empty denominator. Subtracting a vacuous
 * `1` from a real 0.4 would print "-60", a regression that never happened, and
 * a screen whose whole job is trustworthy numbers must not invent that one.
 */
export function deltaOf(pair: MetricPair): number | null {
  if (pair.beforeDenominator === 0 || pair.afterDenominator === 0) return null;
  if (pair.before === null || pair.after === null) return null;
  return pair.after - pair.before;
}

/** A batch is incomplete when fewer cases ran than its set held. */
export function isIncomplete(b: EvalRunBatch): boolean {
  return b.cases_ran < b.cases_total;
}

/** A case whose state differs between the two runs is the reason to be here. */
export function changed(row: { before: EvalCaseOutcome; after: EvalCaseOutcome }): boolean {
  return row.before !== row.after;
}
