import type { CSSProperties } from "react";

/** Co-located styles for the blast stat row. */
export const s = {
  root: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    alignItems: "center",
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "var(--text-secondary)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  icon: { color: "var(--text-muted)" } satisfies CSSProperties,
  value: { color: "var(--text-primary)", fontWeight: 650 } satisfies CSSProperties,
};
