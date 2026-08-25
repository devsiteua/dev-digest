import type { CSSProperties } from "react";

/**
 * Ported from the design's `IntentBlock`
 * (`reference/devdigest-design/src/features/pull-requests/pr-detail.jsx:3-18`).
 * Every colour is a token, never a literal — that is the `@devdigest/ui`
 * convention and what makes the card follow the theme.
 */
export const s = {
  quote: {
    fontSize: 14,
    lineHeight: 1.5,
    fontStyle: "italic",
    color: "var(--text-primary)",
    marginBottom: 14,
    textWrap: "pretty",
  } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 18,
  } satisfies CSSProperties,
  scopeLabel: (tone: "ok" | "muted") =>
    ({
      display: "flex",
      alignItems: "center",
      gap: 5,
      fontSize: 11,
      fontWeight: 700,
      color: tone === "ok" ? "var(--ok)" : "var(--text-muted)",
      marginBottom: 7,
      letterSpacing: "0.04em",
    }) satisfies CSSProperties,
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 5,
  } satisfies CSSProperties,
  item: (tone: "ok" | "muted") =>
    ({
      fontSize: 12.5,
      color: tone === "ok" ? "var(--text-secondary)" : "var(--text-muted)",
      display: "flex",
      gap: 7,
      lineHeight: 1.45,
    }) satisfies CSSProperties,
  bullet: (tone: "ok" | "muted") =>
    ({ color: tone === "ok" ? "var(--ok)" : undefined, marginTop: 1 }) satisfies CSSProperties,
  /**
   * What the PR pointed at and we could not read.
   *
   * Muted rather than alarming: an unreadable plan file is not an error, it is a
   * reason the confidence above is lower than it looks. `--warn` is on the icon
   * alone, so the row reads as a caveat on the claim rather than a second status
   * competing with the confidence reading.
   */
  missing: {
    display: "flex",
    gap: 7,
    marginTop: 14,
    fontSize: 11.5,
    lineHeight: 1.45,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  missingIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  missingList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,
  /** The confidence reading + Re-derive action, in SectionLabel's `right` slot. */
  right: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  /** Source chips — evidence, which is what makes the confidence readable. */
  sources: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  meta: { fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" } satisfies CSSProperties,
} as const;
