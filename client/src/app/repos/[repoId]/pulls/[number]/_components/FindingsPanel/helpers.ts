import type { FindingRecord } from "@devdigest/shared";
import type { SeverityKey } from "@/lib/severity";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/**
 * The confidence gate on its own. Both the list and the severity counters derive
 * from this same set, so a chip never advertises findings the toggle has hidden.
 */
export function confidenceFiltered(
  findings: FindingRecord[],
  hideLow: boolean,
): FindingRecord[] {
  return hideLow ? findings.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD) : findings;
}

/**
 * Optionally drop low-confidence findings, narrow to the selected severities, and
 * sort by severity. An empty or omitted `severities` means no severity filter.
 *
 * A selected severity that matches nothing is dropped from the effective filter:
 * turning on "hide low confidence" can empty a severity the user already selected,
 * and its chip then renders muted and inert — with no way left to un-toggle it, the
 * panel would be stuck on an empty list.
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severities: readonly SeverityKey[] = [],
): FindingRecord[] {
  const shown = confidenceFiltered(findings, hideLow);
  const effective = severities.filter((s) => shown.some((f) => f.severity === s));
  const narrowed = effective.length
    ? shown.filter((f) => effective.includes(f.severity as SeverityKey))
    : shown;
  return [...narrowed].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
