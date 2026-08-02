import type { CSSProperties } from "react";

/** Co-located styles for SeverityCounters.
 *
 *  The design draws these as bare text, not as filled severity pills: icon +
 *  number in the level's colour, on a dotted underline that says "there is more
 *  behind this" (`14-screen_dashboard.jsx:55`, `12-prdetail_runs.jsx:67`). The
 *  pill treatment belongs to a single finding's badge, where the level is the
 *  point; three filled pills in a table cell read as three buttons. */
export const s = {
  /** Positioned ancestor for the popover, hence `relative`. `gap` differs per
   *  surface — 8 in the PR list, 10 in the roomier timeline row. */
  row: (gap: number): CSSProperties => ({
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap,
    width: "fit-content",
    cursor: "help",
  }),
  counter: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 11.5,
    fontWeight: 600,
    color,
    borderBottom: `1px dotted ${color}`,
    paddingBottom: 1,
  }),
  /** Both "never reviewed" (—) and "reviewed, nothing found" (0) sit at the muted
   *  token, matching the dash an unreviewed score and an unknown cost already use. */
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
