import type { ConventionStatus } from "@devdigest/shared";
import { HIGH_CONFIDENCE, STATUS_COLOR } from "./constants";

/* `evidenceLabel` moved to the route root (`../../helpers`) when the merge modal
   started writing the same `path:start-end` string into the skill body. */

/** 0.88 → 88. */
export function confidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}

/** Green above the threshold, amber below it — never a colour literal. */
export function confidenceColor(confidence: number): string {
  return confidence >= HIGH_CONFIDENCE ? "var(--ok)" : "var(--warn)";
}

/** The card's left-edge colour for a status. */
export function statusColor(status: ConventionStatus): string {
  return STATUS_COLOR[status] ?? STATUS_COLOR.pending;
}
