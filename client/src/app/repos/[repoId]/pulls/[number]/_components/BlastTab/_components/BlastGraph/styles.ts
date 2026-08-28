import type { CSSProperties } from "react";

/** Co-located styles for the blast graph. */
export const s = {
  scroller: { overflowX: "auto" } satisfies CSSProperties,
  svg: { display: "block" } satisfies CSSProperties,
  legend: {
    display: "flex",
    gap: 14,
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 8,
    paddingLeft: 4,
  } satisfies CSSProperties,
  empty: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    padding: "24px 4px",
  } satisfies CSSProperties,
};
