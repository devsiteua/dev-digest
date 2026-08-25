import type { SmartDiffRole } from "@devdigest/shared";

/** Constants for the Smart Diff surface. */

/**
 * The order groups are drawn in.
 *
 * The server already answers in this order (`modules/smart-diff/constants.ts`
 * `ROLE_ORDER`), so this is not a second opinion — it is what the flat-order
 * toggle and the "unmatched file" fallback need in order to place a group the
 * response did not contain.
 */
export const ROLE_ORDER: readonly SmartDiffRole[] = ["core", "wiring", "boilerplate"];

/** The dot beside each group header. Tokens only — never a literal colour. */
export const ROLE_COLOUR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-muted)",
};
