import type { CSSProperties } from "react";

/**
 * Where to start reading — a numbered list, not a set.
 *
 * Derived: the design has no artboard for `review_focus`. The visual borrows the
 * row rhythm of the design's `HistoryRow` (the ordinal where its timeline dot
 * sits) so the two lists on one card do not look like two products.
 */
export const s = {
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  ordinal: {
    flexShrink: 0,
    width: 18,
    height: 18,
    borderRadius: 5,
    display: "grid",
    placeItems: "center",
    background: "var(--bg-hover)",
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 700,
    marginTop: 1,
  } satisfies CSSProperties,
  body: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } satisfies CSSProperties,
  ref: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  why: { fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
};

/**
 * The row itself.
 *
 * A `kind: 'file'` row is a `<button>` and a `kind: 'endpoint'` row is a `<div>`
 * (AC-37), so the shared geometry lives here and the element is the caller's
 * choice — rather than one element with a `disabled` that would still be
 * focusable-looking and would still say "button" to a screen reader.
 */
export function rowFor(navigable: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    cursor: navigable ? "pointer" : "default",
  };
}
