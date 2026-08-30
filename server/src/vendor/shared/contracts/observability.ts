import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of GET /pulls/:id/multi-agent. A multi-agent
 *                          run is STARTED by POST /pulls/:id/review with `agentIds`;
 *                          there is no POST /pulls/:id/multi-agent-run route.
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - FindingGroup         the same place, flagged by several agents
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - RunEstimate          what one agent's next run is likely to cost
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(),
  /** Null when the model proposed no fix — `findings.suggestion` is nullable. */
  suggestion: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['running', 'done', 'failed', 'cancelled']),
  /** Failure reason, carried straight from `agent_runs.error`. Null unless failed. */
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/**
 * One agent's finding inside a group. The original text is carried VERBATIM —
 * nothing is rewritten, shortened or merged — so a reader can always reach what
 * each agent actually said about the place the group names.
 */
export const FindingGroupMember = z.object({
  finding_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  run_id: z.string(),
  title: z.string(),
  rationale: z.string(),
  suggestion: z.string().nullable(),
  severity: Severity,
  confidence: z.number().min(0).max(1),
});
export type FindingGroupMember = z.infer<typeof FindingGroupMember>;

/**
 * Findings from several agents about the same place. Derived from persisted
 * findings on every read; not stored. A single finding is a valid group of one,
 * and every finding belongs to exactly one group.
 *
 * `title`, `severity` and the line are the group's REPRESENTATIVE — the first
 * member in the group's own deterministic order — never a synthesised summary.
 */
export const FindingGroup = z.object({
  key: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  title: z.string(),
  severity: Severity,
  members: z.array(FindingGroupMember),
});
export type FindingGroup = z.infer<typeof FindingGroup>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/**
 * Response of GET /pulls/:id/multi-agent — the LATEST multi-agent run of one PR.
 * A run is started by POST /pulls/:id/review with `agentIds`, which answers with
 * `multi_agent_run_id`; nothing posts to this resource.
 */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  /** Every agent the run was started with, whatever became of it. */
  agent_count: z.number().int(),
  /** How many of those finished (`status === 'done'`). Groups and conflicts speak for these only. */
  agents_considered: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  groups: z.array(FindingGroup),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/**
 * What one agent's next run on this PR is likely to cost, averaged over its own
 * completed runs. Response of GET /pulls/:id/multi-agent/estimate — one entry per
 * agent in the workspace, so the picker can say "no data yet" per agent.
 *
 * `null` on either average means "no completed run to average", which is a
 * different fact from `0` — the same null-vs-zero rule `agent_runs.cost_usd` uses.
 */
export const RunEstimate = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  enabled: z.boolean(),
  runs_sampled: z.number().int(),
  avg_duration_ms: z.number().int().nullable(),
  avg_cost_usd: z.number().nullable(),
});
export type RunEstimate = z.infer<typeof RunEstimate>;

export const RunEstimateResponse = z.array(RunEstimate);
export type RunEstimateResponse = z.infer<typeof RunEstimateResponse>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
