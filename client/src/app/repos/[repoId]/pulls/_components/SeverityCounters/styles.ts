import type { CSSProperties } from "react";

/** Co-located styles for SeverityCounters. */
export const s = {
  row: { display: "inline-flex", alignItems: "center", gap: 4 } satisfies CSSProperties,
  /** Both "never reviewed" (—) and "reviewed, nothing found" (0) sit at the muted
   *  token, matching the dash an unreviewed score and an unknown cost already use. */
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
