import type { CSSProperties } from "react";
import { GRID_COLUMNS } from "./constants";

/** Co-located styles for the CI Runs page. */
export const s = {
  page: { padding: "20px 28px 40px" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-end", gap: 12 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 3,
  } satisfies CSSProperties,

  table: {
    marginTop: 18,
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  headRow: {
    display: "grid",
    gridTemplateColumns: GRID_COLUMNS,
    gap: 12,
    padding: "10px 16px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  row: (last: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: GRID_COLUMNS,
    gap: 12,
    padding: "12px 16px",
    borderBottom: last ? "none" : "1px solid var(--border)",
    alignItems: "center",
    fontSize: 12.5,
  }),
  time: { fontSize: 11, color: "var(--text-secondary)" } satisfies CSSProperties,
  repo: {
    fontSize: 12,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  pr: { fontSize: 11.5, color: "var(--accent-text)" } satisfies CSSProperties,
  agent: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,
  agentName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  num: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  loading: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 18,
  } satisfies CSSProperties,
} as const;
