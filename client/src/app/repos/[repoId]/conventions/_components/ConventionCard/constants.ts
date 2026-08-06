import type { ConventionStatus } from "@devdigest/shared";

/** At or above this, the confidence bar is green; below it, amber (design N7). */
export const HIGH_CONFIDENCE = 0.85;

/** Confidence bar width, px — a fixed track so the percentages line up. */
export const CONFIDENCE_BAR_WIDTH = 90;

/** The accept/reject column, px. Both buttons are `full` inside it. */
export const ACTION_COLUMN_WIDTH = 150;

/** Rows of the in-card rule editor — a rule is one or two sentences. */
export const RULE_EDITOR_ROWS = 3;

/** The card's left edge carries the status. */
export const STATUS_COLOR: Record<ConventionStatus, string> = {
  pending: "var(--border)",
  accepted: "var(--ok)",
  rejected: "var(--crit)",
};
