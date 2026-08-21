import type { ConventionCandidate } from "@devdigest/shared";

type Evidence = Pick<
  ConventionCandidate,
  "evidence_path" | "evidence_start_line" | "evidence_end_line"
>;

/**
 * `src/api/users.ts:23-31` — the one place the line range is rendered back into
 * the path. The server stores the two integers apart precisely because it has to
 * slice a file with them; a single-line range collapses to `path:23`.
 *
 * Lives at the route root because both users need the same string: the card
 * labels its evidence link with it, and the merge modal writes it into the
 * skill body under "Detected in".
 */
export function evidenceLabel(c: Evidence): string {
  const { evidence_path: path, evidence_start_line: start, evidence_end_line: end } = c;
  return end > start ? `${path}:${start}-${end}` : `${path}:${start}`;
}
