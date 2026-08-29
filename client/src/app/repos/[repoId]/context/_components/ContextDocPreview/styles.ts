import type { CSSProperties } from "react";

export const s = {
  pane: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    padding: "14px 18px",
    minHeight: 220,
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBottom: 10,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  pathLabel: { fontSize: 12.5, fontWeight: 600 } satisfies CSSProperties,
  readOnly: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  body: { fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6 } satisfies CSSProperties,
} as const;
