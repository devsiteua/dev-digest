import type { CSSProperties } from "react";

export const s = {
  page: { padding: "20px 28px 40px", maxWidth: 980, margin: "0 auto" } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 3,
    marginBottom: 18,
  } satisfies CSSProperties,
  columns: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 } satisfies CSSProperties,
  column: {
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  columnHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  columnTitle: { fontSize: 13, fontWeight: 700 } satisfies CSSProperties,
  /** Beside the metrics, never in a footnote — the numbers above are over a
      smaller set than the label implies. */
  incomplete: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--warn)",
    marginLeft: "auto",
  } satisfies CSSProperties,
  metrics: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  deltaRow: {
    display: "grid",
    gridTemplateColumns: "1fr 90px",
    gap: 12,
    alignItems: "center",
    padding: "7px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  delta: (d: number | null): CSSProperties => ({
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    color: d === null ? "var(--text-muted)" : d > 0 ? "var(--ok)" : d < 0 ? "var(--crit)" : "var(--text-muted)",
  }),
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    margin: "24px 0 8px",
  } satisfies CSSProperties,
  caseRow: (moved: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: "1fr 130px 20px 130px",
    gap: 12,
    alignItems: "center",
    padding: "9px 12px",
    borderRadius: 7,
    border: `1px solid ${moved ? "var(--border-strong)" : "var(--border)"}`,
    background: "var(--bg-elevated)",
    marginBottom: 6,
    fontSize: 12.5,
  }),
  outcome: (o: string): CSSProperties => ({
    fontWeight: 600,
    color:
      o === "pass"
        ? "var(--ok)"
        : o === "fail"
          ? "var(--crit)"
          : "var(--text-muted)",
  }),
  arrow: { color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  muted: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
