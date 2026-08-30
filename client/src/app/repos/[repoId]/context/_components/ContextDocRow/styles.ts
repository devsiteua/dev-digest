import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 8px 6px 4px",
    borderRadius: 7,
    // Longhand, not the `border` shorthand: the selected and disabled variants
    // below override one part each, and React warns when a shorthand and a
    // longhand for the same value are mixed across a re-render.
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  rowSelected: { background: "var(--bg-hover)", borderColor: "var(--accent)" } satisfies CSSProperties,
  /** The one visual difference a disabled document carries. */
  rowDisabled: { opacity: 0.55, borderStyle: "dashed" } satisfies CSSProperties,
  main: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
    padding: "3px 5px",
    border: "none",
    background: "transparent",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
  iconOn: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  iconOff: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  text: { display: "flex", flexDirection: "column", minWidth: 0, flex: 1 } satisfies CSSProperties,
  title: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  pathLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  size: { fontSize: 11, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  controls: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 } satisfies CSSProperties,
  disabledTag: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    marginRight: 2,
  } satisfies CSSProperties,
} as const;
