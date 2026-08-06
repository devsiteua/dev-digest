import type { CSSProperties } from "react";
import { ACTION_COLUMN_WIDTH, CONFIDENCE_BAR_WIDTH } from "./constants";

/** Co-located styles for ConventionCard (design N7 `ConventionCard`). */
export const s = {
  card: (edge: string, muted: boolean): CSSProperties => ({
    // Per-side colours, never `borderColor` — that is itself a shorthand for all
    // four sides, so pairing it with `borderLeftColor` makes React warn on every
    // rerender that changes one of them (see client/INSIGHTS.md, 2026-08-02).
    borderStyle: "solid",
    borderTopColor: "var(--border)",
    borderRightColor: "var(--border)",
    borderBottomColor: "var(--border)",
    borderWidth: 1,
    borderLeftWidth: 3,
    borderLeftColor: edge,
    borderRadius: 9,
    background: "var(--bg-elevated)",
    padding: 16,
    marginBottom: 12,
    opacity: muted ? 0.6 : 1,
    transition: "opacity .2s, border-color .12s",
  }),
  row: { display: "flex", gap: 14 } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rule: {
    fontSize: 14,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.4,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  evidence: {
    marginTop: 10,
    borderRadius: 7,
    border: "1px solid var(--border)",
    overflow: "hidden",
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "5px 10px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  evidenceHint: {
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 11.5,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    background: "var(--code-bg)",
    overflow: "auto",
  } satisfies CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  } satisfies CSSProperties,
  confidenceLabel: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  confidenceTrack: { width: CONFIDENCE_BAR_WIDTH } satisfies CSSProperties,
  confidenceValue: { fontSize: 11, color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    flexShrink: 0,
    width: ACTION_COLUMN_WIDTH,
  } satisfies CSSProperties,
} as const;
