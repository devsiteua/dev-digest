import type { CSSProperties } from "react";

/** Co-located styles for PrSeveritySummary. */
export const s = {
  row: { display: "inline-flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  /** A level with nothing found still renders, so the row reads as a fixed
   *  "critical · warning · suggestion" scoreboard rather than a list that
   *  changes shape between PRs. Dimmed, because zero is not news. */
  zero: { opacity: 0.45 } satisfies CSSProperties,
  none: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
