import type { CSSProperties } from "react";

/** Co-located styles for RunCostBadge. */
export const s = {
  /**
   * Empty by design for a known cost — the badge inherits its container's font
   * size and colour so it reads correctly in a table cell, a timeline column,
   * and an accordion header without a variant prop. An unknown cost dims to the
   * muted token, matching the "—" already used for an unreviewed score.
   */
  value: (unknown: boolean): CSSProperties => (unknown ? { color: "var(--text-muted)" } : {}),
} as const;
