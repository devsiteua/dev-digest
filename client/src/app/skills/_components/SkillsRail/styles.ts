import type { CSSProperties } from "react";

/** Co-located styles for the skill rail on /skills/:id. Width matches the agent rail. */
export const s = {
  rail: {
    width: 280,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  header: { padding: "16px 16px 12px", flexShrink: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: 12.5,
    fontFamily: "inherit",
  } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
} as const;
