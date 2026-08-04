/**
 * Shared display formatters. Lives in `lib/` rather than a route folder because
 * cost is rendered from two sibling trees — the PR list and the PR detail page.
 */

/** Rendered in place of a number we do not have. Never "$0.00" — that means free. */
export const NO_VALUE = "—";

/**
 * USD cost of a run.
 *
 * Precision adapts to the magnitude so a $0.0013 run and a $0.06 run are both
 * legible without padding every column to four decimals: take four decimals,
 * drop however many of them are trailing zeros, and never go below two.
 *
 *   0.06 → "$0.06"   0.014 → "$0.014"   0.0013 → "$0.0013"   10 → "$10.00"
 *
 * `null` means unknown (unpriced model, or never reviewed) and renders as a
 * dash. `0` is real data — a genuinely free model — and renders as "$0.00".
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return NO_VALUE;
  const trailingZeros = usd.toFixed(4).match(/0+$/)?.[0].length ?? 0;
  return `$${usd.toFixed(Math.max(2, 4 - trailingZeros))}`;
}

/** Token count with thousands separators: 9119 → "9,119". */
export function formatTokenCount(n: number): string {
  return n.toLocaleString("en-US");
}
