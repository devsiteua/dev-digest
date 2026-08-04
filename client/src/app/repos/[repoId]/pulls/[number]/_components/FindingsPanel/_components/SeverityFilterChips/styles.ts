import type { CSSProperties } from "react";

/** Co-located styles for SeverityFilterChips. */
export const s = {
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  /**
   * A severity with no findings. Dimmed and click-through rather than removed, so
   * the row keeps its width while the user toggles levels on and off.
   */
  empty: { opacity: 0.45, pointerEvents: "none", display: "inline-flex" } satisfies CSSProperties,
} as const;
