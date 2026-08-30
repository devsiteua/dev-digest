import type { CSSProperties } from "react";

/**
 * Co-located styles for the Files tab.
 *
 * One entry today — the notice shown when `?file=` names a path this PR does not
 * change. It borrows `BlastTab`'s banner shape rather than inventing a second
 * one, because it says the same kind of thing: the screen answered, and the
 * answer is that it could not do what was asked.
 */
export const s = {
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "10px 12px",
    margin: "0 0 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  noticeIcon: { color: "var(--warn)", flexShrink: 0 } satisfies CSSProperties,
  noticePath: { color: "var(--text-primary)" } satisfies CSSProperties,
};
