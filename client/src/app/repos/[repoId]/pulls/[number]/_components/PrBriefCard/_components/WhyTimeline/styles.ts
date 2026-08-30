import type { CSSProperties } from "react";

/**
 * The Why Timeline, on the design's `HistoryAccordion` visual.
 *
 * The accordion, its count badge and the dot-and-rail rows are the design's;
 * what goes IN the rows is derived, because the design's accordion lists prior
 * pull requests and this one lists past briefs of this one. Borrowing the visual
 * rather than inventing a second one is deliberate: the spec says the two share
 * a visual and nothing else.
 */
export const s = {
  frame: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
  } satisfies CSSProperties,
  body: { borderTop: "1px solid var(--border)", padding: "4px 0" } satisfies CSSProperties,
  row: { display: "flex", gap: 12, padding: "10px 14px" } satisfies CSSProperties,
  rail: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 3,
  } satisfies CSSProperties,
  dot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    background: "var(--text-muted)",
    border: "2px solid var(--bg-elevated)",
  } satisfies CSSProperties,
  rope: { width: 1, flex: 1, background: "var(--border)", marginTop: 2 } satisfies CSSProperties,
  rowHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  what: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  delta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
};

/** The header is the toggle, so it is a button — the design draws it as a bar. */
export function headerFor(open: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "9px 12px",
    cursor: "pointer",
    background: open ? "var(--bg-surface)" : "transparent",
    border: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
  };
}

/** Only the last row has no rail below it. */
export function rowFor(last: boolean): CSSProperties {
  return { ...s.row, borderBottom: last ? "none" : "1px solid var(--border)" };
}
