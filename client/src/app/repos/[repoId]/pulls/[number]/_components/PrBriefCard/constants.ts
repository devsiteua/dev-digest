import type { IconName } from "@devdigest/ui";
import type { RiskKind, RiskSeverity } from "@devdigest/shared";

/**
 * One icon per risk kind — the design's `RISK_ICON` map, verbatim for the five
 * kinds it has.
 *
 * `other` is ours: the contract carries six kinds and the design's map five,
 * because `other` exists so a real risk that fits none of the five stays
 * expressible. `Info` rather than a warning glyph, because "we could not
 * classify it" is not itself a severity claim — the pill's border already says
 * how bad it is.
 *
 * Typed `Record<RiskKind, …>` on purpose: adding a seventh kind to the contract
 * fails `pnpm typecheck` here rather than crashing the row at runtime, which is
 * the whole reason `Risk.kind` closed to an enum.
 */
export const RISK_ICON: Record<RiskKind, IconName> = {
  security: "Shield",
  db_migration: "Database",
  breaking_api: "AlertOctagon",
  perf: "Zap",
  deps: "Boxes",
  other: "Info",
};

/** Border and icon colour per severity — the design's `RISK_SEV`, verbatim. */
export const RISK_SEV: Record<RiskSeverity, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--info)",
};

/**
 * How long a rendered reference may be before its middle is elided.
 *
 * The design's mock refs are short (`src/middleware/ratelimit.ts:12-18`, 34
 * characters); a real monorepo path with a line range runs past 100 and wraps
 * the pill row into a paragraph. 48 keeps the longest mock ref intact, so the
 * artboard still renders exactly as drawn.
 */
export const REF_MAX_CHARS = 48;
