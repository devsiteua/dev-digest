import type { CSSProperties } from "react";

/** Co-located styles for FindingsPanel (extracted from inline styles). */
export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /** Separates the severity filter from the confidence toggle. Carries the
   *  `marginLeft: auto` so it and the toggle group both sit hard right, however
   *  many chips are on the left. */
  divider: {
    width: 1,
    height: 18,
    background: "var(--border)",
    margin: "0 2px",
    marginLeft: "auto",
  } satisfies CSSProperties,
  toggleGroup: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
