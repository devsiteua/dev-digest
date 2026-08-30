import type { CSSProperties } from "react";

/** Colocated styles for MultiAgentPicker. Inline objects + design-system CSS
    variables, the one styling mechanism this package uses. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
  },
  headTitle: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" },
  body: { padding: 14, display: "flex", flexDirection: "column", gap: 12 },
  prRow: { display: "flex", flexDirection: "column", gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  },
  agentList: { display: "flex", flexDirection: "column", gap: 2 },
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 8px",
    borderRadius: 7,
  },
  agentMain: { minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 },
  agentMeta: {
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  },
  estimate: {
    fontSize: 11,
    color: "var(--text-muted)",
    textAlign: "right",
    maxWidth: 320,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "11px 14px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  },
  total: { fontSize: 12, color: "var(--text-secondary)", flex: 1, minWidth: 220 },
  error: { fontSize: 12, color: "var(--crit)", padding: "0 14px 12px" },
} satisfies Record<string, CSSProperties>;
