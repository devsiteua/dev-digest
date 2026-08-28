import type { WorkingReviewResponse } from '@devdigest/shared';

/**
 * Pure ring — the finding list a human reads, and the exit code a script reads.
 *
 * Both are a CONTRACT, which is why they are here rather than inline in the
 * entry point: a CI step branches on the number, and a number decided in the
 * middle of a print loop is a number nobody can test.
 */

/** The three exit codes this command promises. Nothing else is ever returned. */
export const EXIT_OK = 0;
export const EXIT_BLOCKING = 1;
export const EXIT_FAILED = 2;

/**
 * 0 when the review ran and found nothing blocking, 1 when it found something.
 *
 * "Blocking" is the SERVER's judgement (`countBlockers` against the agent's
 * `ci_fail_on`), not a severity comparison redone here. A CLI that decided for
 * itself which findings block would disagree with the studio the first time
 * somebody changed an agent's threshold, and only one of the two would be right.
 */
export function exitCodeFor(result: Pick<WorkingReviewResponse, 'blocking'>): number {
  // This package asserts API responses rather than parsing them (`mcp/CLAUDE.md`
  // § Conventions), and `pnpm typecheck` guards contract drift inside this
  // repository — not a differently-versioned API answering on a user-set
  // `DEVDIGEST_API_URL`. Everywhere else that costs some garbled text; here it
  // would cost the contract, because `undefined > 0` is `false`, and the one
  // direction a gate must never fail in is the one that reports "clean" without
  // knowing. An unreadable count is a review that could not be judged: exit 2.
  if (!Number.isInteger(result.blocking)) return EXIT_FAILED;
  return result.blocking > 0 ? EXIT_BLOCKING : EXIT_OK;
}

/** `CRITICAL  src/config.ts:11  Hardcoded Stripe secret key` — one per finding. */
export function renderFindings(result: WorkingReviewResponse): string[] {
  return result.findings.map((finding) => {
    const range =
      finding.end_line && finding.end_line !== finding.start_line
        ? `${finding.start_line}-${finding.end_line}`
        : `${finding.start_line}`;
    return `${finding.severity.padEnd(10)} ${finding.file}:${range}  ${finding.title}`;
  });
}

/**
 * The whole report: what ran, what it found, and what it cost.
 *
 * The header names the agent and the model before any finding, because the first
 * question about a review nobody asked for is "who said this". The footer says
 * what the grounding gate dropped, for the reason the studio's trace does: a
 * silently shortened finding list reads as "the model found nothing".
 */
export function renderReport(result: WorkingReviewResponse): string {
  const lines: string[] = [
    `${result.agent_name} (${result.provider}/${result.model}) — ${plural(
      result.files_reviewed,
      'file',
    )} reviewed`,
  ];

  if (result.findings.length === 0) {
    lines.push('', 'No findings.');
  } else {
    lines.push('');
    lines.push(...renderFindings(result));
  }

  if (result.summary) lines.push('', result.summary);

  const cost = result.cost_usd == null ? 'unpriced' : `$${result.cost_usd.toFixed(4)}`;
  lines.push(
    '',
    `${plural(result.findings.length, 'finding')}, ${result.blocking} blocking · ` +
      `grounding ${result.grounding} · ${result.tokens_in}→${result.tokens_out} tokens, ${cost} · ` +
      `${result.duration_ms}ms`,
  );
  // Nothing was written anywhere, and a reader should not have to wonder whether
  // this review is now sitting in the studio's history.
  lines.push('Not saved: a working-tree review is never persisted.');
  return lines.join('\n');
}

function plural(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}
