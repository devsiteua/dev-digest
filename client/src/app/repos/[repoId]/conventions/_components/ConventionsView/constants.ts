/** Card placeholders while the list loads — the seeded repo has three. */
export const SKELETON_ROWS = 3;

/** Height of one loading placeholder, px — roughly a card with a snippet. */
export const SKELETON_HEIGHT = 170;

/**
 * How many rejected candidates the scan summary spells out before collapsing
 * the rest into a count. Enough to show the failure MODES — a fabricated
 * snippet, a rule already decided, a duplicate — without turning the report
 * into a second list as long as the real one.
 */
export const MAX_LISTED_DISCARDS = 5;
