import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";
import { HIGH_CONFIDENCE, STATUS_COLOR } from "./constants";

type Evidence = Pick<
  ConventionCandidate,
  "evidence_path" | "evidence_start_line" | "evidence_end_line"
>;

/**
 * `src/api/users.ts:23-31` — the one place the line range is rendered back into
 * the path. The server stores the two integers apart precisely because it has to
 * slice a file with them; a single-line range collapses to `path:23`.
 */
export function evidenceLabel(c: Evidence): string {
  const { evidence_path: path, evidence_start_line: start, evidence_end_line: end } = c;
  return end > start ? `${path}:${start}-${end}` : `${path}:${start}`;
}

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
