import { Severity } from '@devdigest/shared';
import type {
  AgentColumn,
  AgentColumnFinding,
  MultiAgentRun,
  RunEstimate,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import {
  MultiAgentRepository,
  type ColumnRow,
  type CompletedRunRow,
  type FindingRow,
} from './repository.js';
import {
  detectConflicts,
  estimateFor,
  groupFindings,
  type EstimatableRun,
  type GroupableFinding,
} from './helpers.js';

/**
 * Multi-Agent Review — the READ side of running several agents on one PR.
 *
 * It makes ZERO model calls, and it cannot make one by accident: no `LLMProvider`
 * is in scope in this file. Every number it returns comes from rows the review
 * executor already wrote, and every judgement it makes — which findings describe
 * the same place, where the agents disagree, what the next run is likely to cost
 * — is a pure function in `helpers.ts`.
 *
 * No SQL and no Fastify below the first line. `multi_agent_runs`, `agent_runs`,
 * `reviews` and `findings` are reached through `MultiAgentRepository`; the pull
 * request through `container.reviewRepo.getPull`, which is the one
 * workspace-scoped pull-request query; the agents through `container.agentsRepo`.
 * Nothing here imports a sibling module — `no-cross-module-import` is only a
 * WARNING, so the container is the rule, not the exit code.
 */
export class MultiAgentService {
  private repo: MultiAgentRepository;

  constructor(private container: Container) {
    this.repo = new MultiAgentRepository(container.db);
  }

  /**
   * The latest multi-agent run of a pull request, as columns, groups and
   * conflicts. `undefined` — never an empty object — when the PR has never been
   * run through a set of agents, so the route can say that and only that.
   */
  async read(workspaceId: string, prId: string): Promise<MultiAgentRun | undefined> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const run = await this.repo.latestForPull(workspaceId, prId);
    if (!run) return undefined;

    const rows = await this.repo.runsFor(run.id);
    const columns = rows.map(toColumnShell);
    const findings = await this.repo.findingsFor(rows.map((r) => r.runId));

    const nameByAgent = new Map(columns.map((c) => [c.agent_id, c.agent_name]));
    for (const finding of findings) {
      const column = columns.find((c) => c.run_id === finding.runId);
      if (column) column.findings.push(toColumnFinding(finding));
    }

    const groups = groupFindings(findings.flatMap((f) => toGroupable(f, nameByAgent)));
    const { conflicts, agents_considered } = detectConflicts(groups, columns);

    return {
      id: run.id,
      pr_id: run.prId,
      pr_number: pull.number,
      ran_at: run.ranAt.toISOString(),
      agent_count: columns.length,
      agents_considered,
      total_duration_ms: columns.reduce((sum, c) => sum + (c.duration_ms ?? 0), 0),
      total_cost_usd: totalCost(columns),
      columns,
      groups,
      conflicts,
    };
  }

  /**
   * What each agent in the workspace is likely to cost on this pull request.
   *
   * One entry per agent, enabled or not, so the picker can say "no data yet" for
   * the one agent that has never run rather than blanking the whole panel. Read
   * from `agent_runs` alone: no model call, no background aggregation.
   *
   * The PR's own completed runs come first; an agent that never ran here falls
   * back to its recent runs anywhere in the workspace.
   */
  async estimate(workspaceId: string, prId: string): Promise<RunEstimate[]> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const agents = await this.container.agentsRepo.list(workspaceId);
    const onThisPr = await this.repo.completedRunsForPull(workspaceId, prId);

    const estimates: RunEstimate[] = [];
    for (const agent of agents) {
      const own = onThisPr.filter((r) => r.agentId === agent.id);
      const sample =
        own.length > 0 ? own : await this.repo.recentCompletedRunsForAgent(workspaceId, agent.id);
      estimates.push({
        agent_id: agent.id,
        agent_name: agent.name,
        enabled: agent.enabled,
        ...estimateFor(sample.map(toEstimatable)),
      });
    }
    return estimates;
  }
}

// ---------------------------------------------------------------------------
// Row → DTO. Kept here because composing the response IS this service's job;
// the rules it composes are the pure functions in `helpers.ts`.
// ---------------------------------------------------------------------------

const COLUMN_STATUSES = ['running', 'done', 'failed', 'cancelled'] as const;

/**
 * `agent_runs.status` is a bare `text` column, so the four values it actually
 * carries are a convention rather than a constraint. Anything else — including
 * the null a row would have before the executor touched it — reads as `running`,
 * which is the state a row that exists and has not finished is in.
 */
function toStatus(status: string | null): AgentColumn['status'] {
  const known = COLUMN_STATUSES.find((s) => s === status);
  return known ?? 'running';
}

function toColumnShell(row: ColumnRow): AgentColumn {
  return {
    run_id: row.runId,
    agent_id: row.agentId ?? '',
    agent_name: row.agentName ?? '',
    provider: row.provider,
    model: row.model,
    status: toStatus(row.status),
    error: row.error,
    verdict: row.verdict,
    score: row.score,
    summary: row.summary,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    findings: [],
  };
}

/** `findings.severity` is `text`; every writer goes through the Zod enum, so a miss is a corrupt row. */
function toSeverity(severity: string): Severity {
  const parsed = Severity.safeParse(severity);
  return parsed.success ? parsed.data : 'SUGGESTION';
}

function toColumnFinding(row: FindingRow): AgentColumnFinding {
  return {
    id: row.findingId,
    severity: toSeverity(row.severity),
    category: row.category,
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: row.rationale,
    suggestion: row.suggestion,
    confidence: row.confidence,
    kind: row.kind,
  };
}

/**
 * A finding with no `agent_id` or no `run_id` cannot be attributed, and an
 * unattributable finding in a view whose whole subject is "who said what" is
 * dropped rather than shown under a blank name — hence the flatMap.
 */
function toGroupable(
  row: FindingRow,
  nameByAgent: ReadonlyMap<string, string>,
): GroupableFinding[] {
  if (!row.agentId || !row.runId) return [];
  return [
    {
      finding_id: row.findingId,
      agent_id: row.agentId,
      agent_name: nameByAgent.get(row.agentId) ?? '',
      run_id: row.runId,
      file: row.file,
      start_line: row.startLine,
      end_line: row.endLine,
      title: row.title,
      rationale: row.rationale,
      suggestion: row.suggestion,
      severity: toSeverity(row.severity),
      confidence: row.confidence,
    },
  ];
}

/** Row naming stops at this file: `helpers.ts` speaks the contract's vocabulary, not the schema's. */
function toEstimatable(row: CompletedRunRow): EstimatableRun {
  return { status: row.status, duration_ms: row.durationMs, cost_usd: row.costUsd };
}

/**
 * Null is "unknown", 0 is "genuinely free" — the rule `agent_runs.cost_usd`
 * states and the PR list already follows. A total is only known when every run
 * that finished reported a price, so a batch containing one unpriced model — or
 * one still running — totals to null rather than to a number that silently
 * under-reports the bill.
 */
function totalCost(columns: readonly AgentColumn[]): number | null {
  const done = columns.filter((c) => c.status === 'done');
  if (done.length === 0) return null;
  if (done.some((c) => c.cost_usd === null)) return null;
  return done.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0);
}
