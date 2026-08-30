import type { CSSProperties } from "react";

export const s = {
  right: { display: "inline-flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  meta: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  /** The design's own divider — a 1px rule with 16px of air either side. */
  divider: { height: 1, background: "var(--border)", margin: "16px 0" } satisfies CSSProperties,
  proseLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,
  prose: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-primary)",
    margin: "0 0 12px",
  } satisfies CSSProperties,
  /**
   * A degraded-input note. Same geometry as `IntentCard`'s `missing_context`
   * block, because it says the same kind of thing next to the same kind of
   * claim — two cards on one tab must not disagree about what a caveat is.
   */
  note: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 10px",
    marginTop: 10,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  noteIcon: { color: "var(--text-muted)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  noteList: { margin: 0, padding: 0, listStyle: "none" } satisfies CSSProperties,
  /**
   * The staleness banner. Warm rather than neutral, because unlike the notes
   * above it has an ACTION: the brief is not merely caveated, it is out of date
   * and one click fixes it (AC-31).
   */
  stale: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "10px 12px",
    marginBottom: 14,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  staleIcon: { color: "var(--warn)", flexShrink: 0 } satisfies CSSProperties,
  staleTitle: {
    fontWeight: 650,
    color: "var(--text-primary)",
    display: "block",
    marginBottom: 2,
  } satisfies CSSProperties,
  staleAction: { marginLeft: "auto", flexShrink: 0 } satisfies CSSProperties,
  blockLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  } satisfies CSSProperties,
  emptyBlock: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
};
