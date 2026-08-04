/**
 * Severity tallying for the client.
 *
 * The server has its own `rollupSeverities` (`modules/pulls/status.ts`) for the
 * PR-list column, which arrives pre-computed. This is the same tally applied to
 * findings the client already holds — the panel chips and the timeline rows both
 * count locally rather than asking for a number that is already in the cache.
 * A type cannot cross the wire, so this duplication is deliberate and is the
 * only one.
 */
import type { SeverityCounts } from "@devdigest/shared";

/** The three real severities, in display order. Note `@devdigest/ui` also exports a
 *  `Severity` that includes INFO — that level is unreachable from the API. */
export const SEVERITY_KEYS = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
export type SeverityKey = (typeof SEVERITY_KEYS)[number];

/** Which `SeverityCounts` field each severity lands in. */
const BUCKET: Record<SeverityKey, keyof SeverityCounts> = {
  CRITICAL: "critical",
  WARNING: "warning",
  SUGGESTION: "suggestion",
};

export const EMPTY_COUNTS: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };

/**
 * Tally findings by severity. Anything outside the three known levels is ignored
 * rather than bucketed — `findings.severity` is an unconstrained text column, so
 * an unknown value is possible and must not corrupt a count.
 */
export function severityCounts(rows: { severity: string }[]): SeverityCounts {
  const c: SeverityCounts = { ...EMPTY_COUNTS };
  for (const r of rows) {
    const bucket = BUCKET[r.severity as SeverityKey];
    if (bucket) c[bucket] += 1;
  }
  return c;
}

/** The count for one severity, without string-index gymnastics at the call site. */
export function countFor(counts: SeverityCounts, key: SeverityKey): number {
  return counts[BUCKET[key]];
}

/** Total across the three buckets. */
export function totalCount(counts: SeverityCounts): number {
  return counts.critical + counts.warning + counts.suggestion;
}
