import type { BlastRadiusResponse } from '@devdigest/shared';

/**
 * Pure ring — the blast map as this server publishes it, and the sentence that
 * goes above it.
 *
 * A PROJECTION, not a translation. Every key here is the server's own, because
 * the contract "is not `mcp/`'s to invent" (`INSIGHTS.md`, 2026-08-28): renaming
 * a field would open a drift front against
 * `server/src/vendor/shared/contracts/review-api.ts` with nothing to catch it,
 * since `pnpm typecheck` is the only guard this package has. What the projection
 * DOES do is add the two identifiers the caller passed — `repo` and `pr` — so an
 * answer can never be attributed to a pull request nobody asked about, the same
 * reason `ReviewResult` carries them.
 *
 * Nothing here awaits or fetches: it takes a response the tool already has and
 * answers questions about it.
 */

/** Exactly the shape `getBlastRadiusOutput` publishes. */
export interface BlastResult {
  readonly repo: string;
  readonly pr: number;
  readonly status: BlastRadiusResponse['status'];
  readonly reason: string | null;
  readonly indexed_sha: string | null;
  readonly summary: string;
  readonly changed_symbols: BlastRadiusResponse['changed_symbols'];
  readonly downstream: BlastRadiusResponse['downstream'];
}

export function buildBlastResult(input: {
  repo: string;
  pr: number;
  map: BlastRadiusResponse;
}): BlastResult {
  const { repo, pr, map } = input;
  return {
    repo,
    pr,
    status: map.status,
    reason: map.reason,
    indexed_sha: map.indexed_sha,
    summary: map.summary,
    changed_symbols: map.changed_symbols,
    downstream: map.downstream,
  };
}

/**
 * The human-readable block that rides above the JSON.
 *
 * It leads with the state, never with a count, because a count of zero is the
 * one number in this payload that can be read two ways. A `degraded` map gets a
 * sentence saying nothing was analysed — the same warning D13's stub existed to
 * deliver, now attached to a real answer instead of standing in for one.
 */
export function describeBlastResult(result: BlastResult): string {
  const at = result.indexed_sha ? ` (index at ${result.indexed_sha.slice(0, 7)})` : '';
  const head = `${result.repo}#${result.pr} — blast radius: ${result.status}${
    result.reason ? ` (${result.reason})` : ''
  }${at}`;

  if (result.status === 'degraded') {
    // The server's summary already carries the "not a claim that the pull
    // request affects nothing" warning; this adds only the next step, so the
    // block does not say the same sentence twice.
    return [head, result.summary, 'Ask DevDigest to re-analyze the repository, then call this tool again.'].join('\n');
  }

  const callers = result.downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpoints = new Set(result.downstream.flatMap((d) => d.endpoints_affected)).size;
  const crons = new Set(result.downstream.flatMap((d) => d.crons_affected)).size;
  const counts =
    `${count(result.changed_symbols.length, 'changed symbol')}, ${count(callers, 'caller')}, ` +
    `${count(endpoints, 'endpoint')}, ${count(crons, 'scheduled job')}.`;

  return result.status === 'partial'
    ? [head, result.summary, `${counts} The index is incomplete, so callers may be missing.`].join(
        '\n',
      )
    : [head, result.summary, counts].join('\n');
}

/** `1 caller` / `3 callers` — the plural is not worth a library. */
function count(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}
