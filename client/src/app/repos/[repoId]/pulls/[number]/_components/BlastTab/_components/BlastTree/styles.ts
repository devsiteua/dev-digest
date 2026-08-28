import type { CSSProperties } from "react";

/** Co-located styles for the blast tree. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  symbolIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  symbolName: { fontSize: 12.5, fontWeight: 600 } satisfies CSSProperties,
  callerCount: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginLeft: "auto",
  } satisfies CSSProperties,
  body: { padding: "4px 0 8px 28px" } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "3px 0",
    fontSize: 12.5,
  } satisfies CSSProperties,
  callerIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  callerPlain: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  callerName: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  badgeRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    padding: "8px 0 2px 20px",
  } satisfies CSSProperties,
};

/**
 * The clickable symbol row.
 *
 * A `<button>` rather than a `<div onClick>` so it is reachable by keyboard and
 * announced with its `aria-expanded` state; the reset below is what makes a
 * button look like the design's row.
 */
export function symbolRowStyle(open: boolean, empty: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "5px 6px",
    borderRadius: 6,
    border: "none",
    textAlign: "left",
    font: "inherit",
    color: "var(--text-primary)",
    cursor: empty ? "default" : "pointer",
    background: open ? "var(--bg-hover)" : "transparent",
  };
}

/** The disclosure chevron, rotated when the row is open. */
export function chevronStyle(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    flexShrink: 0,
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
