import type { CSSProperties } from "react";

/** Colocated styles for ColumnsView — the `ma-cols` artboard, one column per agent. */
export const s = {
  grid: (count: number): CSSProperties => ({
    display: "grid",
    // The artboard caps the grid at five and scrolls beyond it; below five the
    // columns share the width evenly.
    gridTemplateColumns: `repeat(${Math.min(Math.max(count, 1), 5)}, minmax(220px, 1fr))`,
    gap: 12,
    overflowX: count > 5 ? "auto" : "visible",
  }),
  column: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } satisfies CSSProperties,
  head: { padding: 12, borderBottom: "1px solid var(--border)" },
  headTop: { display: "flex", alignItems: "center", gap: 9 },
  headText: { minWidth: 0, flex: 1 },
  agentName: {
    fontSize: 12.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  agentMeta: { fontSize: 10.5, color: "var(--text-muted)" },
  headBottom: { display: "flex", alignItems: "center", gap: 8, marginTop: 8 },
  body: { padding: 12, display: "flex", flexDirection: "column", gap: 7, flex: 1 },
  finding: (color: string): CSSProperties => ({
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    borderLeft: `2px solid ${color}`,
  }),
  findingTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.3,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  findingWhere: { fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 },
  error: {
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--crit-bg)",
    border: "1px solid var(--border)",
    color: "var(--crit)",
    fontSize: 11.5,
    lineHeight: 1.45,
    wordBreak: "break-word",
  } satisfies CSSProperties,
  muted: { fontSize: 11.5, color: "var(--text-muted)" },
  footer: {
    padding: "9px 12px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } satisfies CSSProperties,
} as const;
