import type { CSSProperties } from "react";

/** Colocated styles for FindingDetailCard — the `ma-tabs` detail card. */
export const s = {
  card: (sevColor: string, muted: boolean): CSSProperties => ({
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    borderLeftWidth: 3,
    borderLeftColor: sevColor,
    background: "var(--bg-elevated)",
    overflow: "hidden",
    opacity: muted ? 0.6 : 1,
  }),
  head: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    cursor: "pointer",
  } satisfies CSSProperties,
  headMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  } satisfies CSSProperties,
  body: {
    padding: "12px 14px 14px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  prose: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  label: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
    marginTop: 12,
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 6,
    marginTop: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  stub: {
    marginTop: 10,
    padding: "9px 11px",
    borderRadius: 6,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 12,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  members: {
    marginTop: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  member: {
    padding: "9px 11px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  memberAgent: {
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 4,
  } satisfies CSSProperties,
} as const;
