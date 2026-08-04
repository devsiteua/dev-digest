import type { FindingRecord } from "@devdigest/shared";
import { SEVERITY_KEYS, type SeverityKey } from "@/lib/severity";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/**
 * The chip row's state machine. `null` is the resting state — every severity is
 * on, which is what the design shows on load — and any array is a narrowed view.
 *
 * The first click therefore has to *isolate* rather than un-toggle: from "all on",
 * clicking CRITICAL means "show me only the critical ones", not "hide them". After
 * that the row behaves as a plain multi-select, and emptying it (or filling it back
 * up to all three) returns to the resting state rather than to an empty list.
 */
export function nextSelection(
  current: readonly SeverityKey[] | null,
  key: SeverityKey,
): readonly SeverityKey[] | null {
  if (current === null) return [key];
  const next = current.includes(key)
    ? current.filter((k) => k !== key)
    : [...current, key];
  return next.length === 0 || next.length === SEVERITY_KEYS.length ? null : next;
}

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
 * sort by severity. `null` — the panel's resting state, where every chip reads as
 * active — means no severity filter, and so does an empty array.
 *
 * A selected severity that matches nothing is dropped from the effective filter:
 * turning on "hide low confidence" can empty a severity the user already selected,
 * and its chip then renders muted and inert — with no way left to un-toggle it, the
 * panel would be stuck on an empty list.
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severities: readonly SeverityKey[] | null = null,
): FindingRecord[] {
  const shown = confidenceFiltered(findings, hideLow);
  const effective = (severities ?? []).filter((s) => shown.some((f) => f.severity === s));
  const narrowed = effective.length
    ? shown.filter((f) => effective.includes(f.severity as SeverityKey))
    : shown;
  return [...narrowed].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
