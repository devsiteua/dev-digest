import type { Severity } from "@devdigest/ui";

/**
 * Severity → CSS colour token for the card's left edge.
 *
 * Keyed by `Severity` rather than by `string`, so a value added to the union is
 * a typecheck failure here instead of an unstyled edge — the same reason
 * `ColumnsView`'s `STATUS_TONE` spells its keys out. Note the UI's `Severity`
 * carries a fourth member, `INFO`, that the API contract cannot produce
 * (root `INSIGHTS.md` 2026-08-02); it is listed because the type requires it,
 * not because a finding can arrive with it.
 *
 * A local copy of the PR route's map rather than an import across routes: this
 * feature is allowed exactly two cross-route imports (`RunTraceDrawer` and
 * `MultiAgentPicker`, both taken in `page.tsx`), and a four-line lookup table is
 * not the one to spend a third on.
 */
export const SEV_COLOR: Record<Severity, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Colour for a severity the contract does not know. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";
