import type { Container } from '../../platform/container.js';
import type { FindingActionKind, RunEventKind, RunTrace } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. Three mutually exclusive forms:
   *   `all: true`   → every enabled agent
   *   `agentIds`    → exactly those agents, enabled or not (a named set)
   *   `agentId`     → one agent
   *
   * The forms are COUNTED first: zero or more than one is
   * `invalid_run_request` (400). An empty `agentIds` is not "no set given" — it
   * is a set of nothing, and rejected. The count cannot live in the route schema,
   * which can only ever answer 422.
   *
   * Every id in `agentIds` is resolved BEFORE this returns, so a single unknown
   * id 404s with no `agent_runs` row written anywhere — resolution is upstream of
   * `runReview`, not inside its creation loop.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; agentIds?: string[]; all?: boolean },
  ): Promise<AgentRow[]> {
    const forms = [
      opts.agentId !== undefined,
      opts.agentIds !== undefined,
      opts.all !== undefined && opts.all,
    ].filter(Boolean).length;
    if (forms !== 1) {
      throw new AppError(
        'invalid_run_request',
        'Provide exactly one of agentId, agentIds or all:true',
        400,
      );
    }

    if (opts.all) return this.agents.listEnabled(workspaceId);

    if (opts.agentIds !== undefined) {
      if (opts.agentIds.length === 0) {
        throw new AppError('invalid_run_request', 'agentIds must not be empty', 400);
      }
      const targets: AgentRow[] = [];
      for (const id of opts.agentIds) {
        const agent = await this.agents.getById(workspaceId, id);
        if (!agent) throw new NotFoundError('Agent not found');
        targets.push(agent);
      }
      return targets;
    }

    const agent = await this.agents.getById(workspaceId, opts.agentId!);
    if (!agent) throw new NotFoundError('Agent not found');
    return [agent];
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   *
   * `multiAgent` makes the batch ONE multi-agent run: a parent `multi_agent_runs`
   * row is created once, before the loop, and every child run is stamped with it.
   * Both fan-out forms — a named `agentIds` set and `all: true` — pass `true`; only
   * the legacy single `{ agentId }` form passes `false`, leaving its column null.
   * `run-executor` is unaware of the parent row and does not need to be.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    multiAgent: boolean,
    logger?: Logger,
  ): Promise<{
    runs: { run_id: string; agent_id: string; agent_name: string }[];
    reviews: ReviewDto[];
    multi_agent_run_id: string | null;
  }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // `targets.length > 0` is load-bearing, not defensive. `{ all: true }` on a
    // workspace with nothing enabled resolves to an empty list and has always
    // been a no-op; creating a parent row for it would leave a childless
    // `multi_agent_runs` that `GET /pulls/:id/multi-agent` then serves as the
    // PR's latest run — 200 with zero columns, for a run nobody started. The
    // `agentIds` form cannot reach here empty: `resolveTargets` rejects it.
    const multiAgentRunId =
      multiAgent && targets.length > 0
        ? await this.repo.createMultiAgentRun({ workspaceId, prId })
        : null;

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        multiAgentRunId,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [], multi_agent_run_id: multiAgentRunId };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }
}
