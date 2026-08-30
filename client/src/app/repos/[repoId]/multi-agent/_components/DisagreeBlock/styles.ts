import type { CSSProperties } from "react";

/** Colocated styles for DisagreeBlock — the conflicts section of `ma-cols`. */
export const s = {
  wrap: { marginTop: 22 } satisfies CSSProperties,
  switchLabel: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  considered: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 10,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  place: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  placeHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  where: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  placeTitle: {
    fontSize: 13,
    fontWeight: 600,
    marginLeft: 6,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  takes: (count: number): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(count, 1)}, 1fr)`,
    gap: 1,
    background: "var(--border)",
  }),
  take: { padding: "10px 14px", background: "var(--bg-elevated)" } satisfies CSSProperties,
  persona: {
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 4,
  } satisfies CSSProperties,
  verdictRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    background: color,
  }),
  verdict: (flagged: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color: flagged ? "var(--text-primary)" : "var(--text-muted)",
    textTransform: flagged ? "uppercase" : "none",
    letterSpacing: flagged ? "0.03em" : 0,
  }),
  note: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
  agreed: {
    padding: "10px 14px",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  empty: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    padding: "8px 0",
  } satisfies CSSProperties,
} as const;
