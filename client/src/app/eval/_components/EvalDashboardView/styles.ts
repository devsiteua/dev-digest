import type { CSSProperties } from "react";

export const s = {
  page: { padding: "20px 28px 40px", maxWidth: 980, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-end", marginBottom: 18 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 3,
  } satisfies CSSProperties,
  casesTotal: {
    marginLeft: "auto",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metrics: { display: "flex", gap: 14, marginBottom: 20 } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  table: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  /** The design's columns, minus Version: a per-CASE row has no agent version
      of its own — that belongs to the batch it came from. */
  grid: {
    display: "grid",
    gridTemplateColumns: "150px 1fr 80px 80px 80px 80px 80px",
    gap: 12,
    padding: "10px 16px",
    alignItems: "center",
    fontSize: 12.5,
  } satisfies CSSProperties,
  head: {
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  mono: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  cell: { fontVariantNumeric: "tabular-nums" } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)", padding: "16px 0" } satisfies CSSProperties,
} as const;
