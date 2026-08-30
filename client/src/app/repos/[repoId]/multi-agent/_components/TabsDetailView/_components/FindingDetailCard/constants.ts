/**
 * Severity → CSS colour token for the card's left edge.
 *
 * A local copy of the PR route's map rather than an import across routes: this
 * feature is allowed exactly two cross-route imports (`RunTraceDrawer` and
 * `MultiAgentPicker`, both taken in `page.tsx`), and a four-line lookup table is
 * not the one to spend a third on.
 */
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Colour for a severity the contract does not know. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";
