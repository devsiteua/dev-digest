import type { RunEstimate } from "@devdigest/shared";

/**
 * The estimate for one selection, summed over the ticked agents.
 *
 * `costUsd` is `null` as soon as ONE sampled agent has no cost to report — the
 * same rule the PR list already applies to its COST column ("null = never
 * reviewed or at least one run's model is unpriced; 0 = a genuinely free
 * model", `contracts/platform.ts`). Adding an unpriced model in as a zero would
 * quote a total that is knowingly too low.
 *
 * `durationMs` is `null` when no ticked agent has a single completed run — that
 * is the "no data yet" case, and it must be SAID rather than rendered as 0.
 */
export interface SelectionEstimate {
  durationMs: number | null;
  costUsd: number | null;
  /** How many past runs the numbers above were averaged over, across the selection. */
  runsSampled: number;
}

export function summariseEstimate(
  estimates: RunEstimate[] | undefined,
  selectedIds: string[],
): SelectionEstimate {
  const picked = (estimates ?? []).filter((e) => selectedIds.includes(e.agent_id));
  const sampled = picked.filter((e) => e.runs_sampled > 0);
  if (sampled.length === 0) return { durationMs: null, costUsd: null, runsSampled: 0 };

  let durationMs = 0;
  let costUsd: number | null = 0;
  let runsSampled = 0;
  for (const e of sampled) {
    durationMs += e.avg_duration_ms ?? 0;
    runsSampled += e.runs_sampled;
    if (e.avg_cost_usd == null) costUsd = null;
    else if (costUsd != null) costUsd += e.avg_cost_usd;
  }
  return { durationMs, costUsd, runsSampled };
}

/**
 * Seconds-formatted duration, or `null` when there is no duration to format.
 *
 * Deliberately returns `null` rather than a dash: the caller decides which
 * sentence stands in for a number it does not have, and that sentence is copy.
 */
export function formatDurationMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return `${(ms / 1000).toFixed(1)}s`;
}
