import type { CSSProperties } from "react";

/** Co-located styles for the Blast Radius card — the design's artboard verbatim. */
export const s = {
  header: {
    display: "flex",
    alignItems: "center",
    marginBottom: 10,
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    gap: 2,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 2,
  } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "10px 12px",
    marginBottom: 12,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--warn)", flexShrink: 0 } satisfies CSSProperties,
  bannerTitle: {
    fontWeight: 650,
    color: "var(--text-primary)",
    display: "block",
    marginBottom: 2,
  } satisfies CSSProperties,
  bannerAction: { marginLeft: "auto", flexShrink: 0 } satisfies CSSProperties,
  shaLine: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 12,
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  explanation: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    margin: "0 0 12px",
  } satisfies CSSProperties,
  explainError: {
    fontSize: 12.5,
    color: "var(--crit)",
    margin: "0 0 12px",
  } satisfies CSSProperties,
  explanationMeta: {
    display: "block",
    marginTop: 6,
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  summary: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    margin: "0 0 12px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
};

/** The tree/graph toggle button, active or not. */
export function toggleButtonFor(active: boolean): CSSProperties {
  return {
    padding: "3px 10px",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 5,
    border: "none",
    textTransform: "capitalize",
    cursor: "pointer",
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  };
}
