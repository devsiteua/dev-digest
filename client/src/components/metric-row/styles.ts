import type { CSSProperties } from "react";

export const s = {
  card: {
    flex: 1,
    minWidth: 0,
    padding: "9px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  label: { fontSize: 10, color: "var(--text-muted)", fontWeight: 600 } satisfies CSSProperties,
  value: (color?: string): CSSProperties => ({
    fontSize: 19,
    fontWeight: 700,
    marginTop: 2,
    color: color ?? "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  }),
  /** Muted on purpose: `—` is an absence, and it must not read as a result. */
  empty: {
    fontSize: 19,
    fontWeight: 700,
    marginTop: 2,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  denominator: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
  delta: (d: number): CSSProperties => ({
    fontSize: 10,
    fontWeight: 600,
    color: d > 0 ? "var(--ok)" : "var(--crit)",
  }),
} as const;
