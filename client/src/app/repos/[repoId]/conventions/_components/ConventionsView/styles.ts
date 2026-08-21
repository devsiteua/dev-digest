import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView (design N7 `ScreenConventions`). */
export const s = {
  page: { padding: "20px 28px 40px", maxWidth: 880, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
  } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 3,
  } satisfies CSSProperties,
  actionBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  } satisfies CSSProperties,
  count: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { marginLeft: "auto" } satisfies CSSProperties,
  alert: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 13px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    marginBottom: 16,
  } satisfies CSSProperties,
  alertIcon: { color: "var(--crit)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  alertTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  alertBody: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginTop: 2,
  } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  // The pass's own report, sitting where the design puts "Detected from 84
  // sample files": muted, one line, and never the same width twice.
  scanSummary: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    marginBottom: 16,
  } satisfies CSSProperties,
  scanIcon: { color: "var(--text-muted)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  scanText: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  scanReasons: {
    margin: "6px 0 0",
    padding: 0,
    listStyle: "none",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scanReason: { marginTop: 2 } satisfies CSSProperties,
} as const;
