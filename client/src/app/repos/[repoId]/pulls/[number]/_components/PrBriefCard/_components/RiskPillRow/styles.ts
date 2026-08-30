import type { CSSProperties } from "react";

/** The design's `RiskPillRow`, artboard `pr-overview` — its inline styles, named. */
export const s = {
  row: { display: "flex", gap: 7, flexWrap: "wrap" } satisfies CSSProperties,
  panel: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  explanation: {
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    margin: 0,
  } satisfies CSSProperties,
  refs: { display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" } satisfies CSSProperties,
  noRefs: { fontSize: 12, color: "var(--text-muted)", marginTop: 8 } satisfies CSSProperties,
  /**
   * Read aloud, never drawn.
   *
   * The pill says its kind with an icon and its severity with a border colour,
   * and neither is anything at all to a screen reader. An `aria-label` would
   * have replaced the visible title instead of adding to it, so this is a
   * hidden span rather than a label — and it is an inline style object because
   * that is this package's one styling mechanism (`sr-only` would be Tailwind,
   * which is installed here but is not what anything styles with).
   */
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
};

/**
 * One pill. The border carries the severity only while the pill is open — that
 * is the design's own rule, and it is why an unopened row reads as a list rather
 * than as a traffic light.
 */
export function pillFor(open: boolean, severityColour: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    border: `1px solid ${open ? severityColour : "var(--border)"}`,
    background: open ? "var(--bg-hover)" : "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
  };
}
