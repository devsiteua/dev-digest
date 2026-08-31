import type { CSSProperties } from "react";

/** Colocated styles for TabsDetailView — the `ma-tabs` artboard. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 0 } satisfies CSSProperties,
  panel: { paddingTop: 18, maxWidth: 760 } satisfies CSSProperties,
  summary: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 18,
  } satisfies CSSProperties,
  summaryMain: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  agentName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  summaryText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  summaryRight: {
    marginLeft: "auto",
    textAlign: "right",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
    flexShrink: 0,
  } satisfies CSSProperties,
  meta: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  error: {
    padding: "9px 11px",
    borderRadius: 6,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 12,
    lineHeight: 1.45,
    marginBottom: 14,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
