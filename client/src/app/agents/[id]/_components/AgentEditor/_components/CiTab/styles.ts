import type { CSSProperties } from "react";

/** Co-located styles for the agent's CI tab. */
export const s = {
  wrap: { maxWidth: 720 } satisfies CSSProperties,
  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  headActions: { marginLeft: "auto" } satisfies CSSProperties,
  subtitle: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 16,
    lineHeight: 1.5,
  } satisfies CSSProperties,

  installation: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "13px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 8,
  } satisfies CSSProperties,
  repo: { fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 } satisfies CSSProperties,
  installedAt: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,

  section: { marginTop: 24 } satisfies CSSProperties,
  runsBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  runRow: (last: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: "160px 60px 1fr 70px 90px",
    gap: 10,
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: last ? "none" : "1px solid var(--border)",
    fontSize: 12,
  }),
  runTime: { fontSize: 11, color: "var(--text-secondary)" } satisfies CSSProperties,
  runPr: { color: "var(--accent-text)" } satisfies CSSProperties,
  runFindings: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  noRuns: { fontSize: 12.5, color: "var(--text-muted)", padding: "10px 2px" } satisfies CSSProperties,

  gate: { marginTop: 24, maxWidth: 420 } satisfies CSSProperties,
  savedNote: { fontSize: 12, color: "var(--ok)" } satisfies CSSProperties,
  loading: { display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 } satisfies CSSProperties,
} as const;
