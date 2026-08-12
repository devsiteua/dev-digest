/**
 * Bar colour per finding category, taken from the design's "Findings by
 * category" donut (`skills-lab.jsx`).
 *
 * Keyed by the raw string the API sends, not by `@devdigest/ui`'s `Category`
 * type: `findings.category` is a plain text column, so an agent can produce a
 * label this map has never heard of. Unknown categories fall back to the accent
 * colour rather than disappearing.
 */
export const CATEGORY_BAR_COLOR: Record<string, string> = {
  security: "var(--crit)",
  bug: "var(--warn)",
  perf: "#8b5cf6",
  style: "var(--accent)",
  test: "var(--ok)",
};
