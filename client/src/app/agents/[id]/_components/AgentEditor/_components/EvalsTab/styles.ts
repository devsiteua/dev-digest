import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  headActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  caseRow: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 6,
  } satisfies CSSProperties,
  caseMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  caseName: { fontSize: 12.5, fontWeight: 600 } satisfies CSSProperties,
  caseSource: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 2,
    fontFamily: "var(--font-mono)",
  } satisfies CSSProperties,
  section: { marginTop: 26 } satisfies CSSProperties,
  runRow: {
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 6,
  } satisfies CSSProperties,
  runHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    fontSize: 11.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  runMetrics: { display: "flex", gap: 8 } satisfies CSSProperties,
  /** Beside the metrics, never in a footnote — an incomplete run's numbers are
      over a smaller set than the label suggests. */
  incomplete: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--warn)",
    marginLeft: "auto",
  } satisfies CSSProperties,
  compareRow: { marginTop: 8 } satisfies CSSProperties,
  compareLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
  muted: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
