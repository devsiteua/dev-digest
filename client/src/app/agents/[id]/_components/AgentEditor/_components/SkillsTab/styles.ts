import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  filter: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "5px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 200,
  } satisfies CSSProperties,
  filterInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: 12,
    fontFamily: "inherit",
  } satisfies CSSProperties,
  hint: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 14,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  row: (linked: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid " + (linked ? "var(--border-strong)" : "var(--border)"),
    background: linked ? "var(--bg-hover)" : "var(--bg-elevated)",
  }),
  /**
   * Drag feedback as box-shadow, never as a border override: `row` sets the
   * `border` shorthand, and adding a `borderColor`/`borderTopColor` longhand on
   * top of it makes React warn about conflicting style properties on every
   * rerender — and a dragged list rerenders constantly.
   */
  rowDragging: { opacity: 0.4, cursor: "grabbing" } satisfies CSSProperties,
  /** The row the drop would land on: an insertion rule across its top edge. */
  rowOver: { boxShadow: "inset 0 3px 0 var(--accent)" } satisfies CSSProperties,
  grip: (draggable: boolean): CSSProperties => ({
    display: "inline-flex",
    flexShrink: 0,
    color: draggable ? "var(--text-muted)" : "transparent",
    cursor: draggable ? "grab" : "default",
  }),
  orderIndex: {
    width: 18,
    fontSize: 11,
    color: "var(--text-muted)",
    textAlign: "right",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontSize: 12.5,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  typeChip: (color: string): CSSProperties => ({
    fontSize: 10.5,
    fontWeight: 600,
    color,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    padding: "1px 7px",
    borderRadius: 4,
    flexShrink: 0,
  }),
  offNote: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10.5,
    color: "var(--warn)",
    flexShrink: 0,
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 16,
    alignItems: "center",
  } satisfies CSSProperties,
  savedNote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  /** Present to a screen reader, absent to the eye. */
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;
