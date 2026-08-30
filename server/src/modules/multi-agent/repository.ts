import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { ESTIMATE_MAX_SAMPLES } from './constants.js';

/**
 * The ONLY layer touching the database for the multi-agent view, and it READS.
 * There is no insert, update or delete in this file and there must not be one:
 * `multi_agent_runs` has exactly one writer — the review module's `run.repo.ts`,
 * which creates the parent row in the same breath as the child `agent_runs` it
 * stamps. Groups and conflicts are derived on every read and never stored.
 *
 * Workspace scoping is not enforced by every method here. It is enforced by the
 * caller resolving the pull request through `container.reviewRepo.getPull`, which
 * is the one workspace-scoped pull-request query in this codebase — the same
 * arrangement `BriefRepository`, `IntentRepository` and `BlastRepository` all
 * document. The two reads that take a `workspaceId` do so because they start from
 * the workspace rather than from a resolved pull request.
 *
 * Every ordered read carries a SECOND, deterministic key. `ran_at` defaults to
 * `now()`, which is the TRANSACTION's timestamp, so rows written in one batch tie
 * to the microsecond and "the latest" silently becomes planner order.
 */

export interface MultiAgentRunRow {
  id: string;
  prId: string;
  ranAt: Date;
}

/** One agent's run inside a multi-agent run, with the review it produced. */
export interface ColumnRow {
  runId: string;
  agentId: string | null;
  agentName: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
  verdict: string | null;
  score: number | null;
  summary: string | null;
}

/** One persisted finding with the attribution `reviews` already carries. */
export interface FindingRow {
  findingId: string;
  agentId: string | null;
  runId: string | null;
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  rationale: string;
  suggestion: string | null;
  severity: string;
  category: string;
  kind: string;
  confidence: number;
}

/** A completed run, reduced to what an estimate is allowed to average. */
export interface CompletedRunRow {
  agentId: string | null;
  status: string | null;
  durationMs: number | null;
  costUsd: number | null;
}

export class MultiAgentRepository {
  constructor(private db: Db) {}

  /**
   * The latest multi-agent run of one pull request.
   *
   * `desc(ranAt), desc(id)` — the second key is the whole point: two runs created
   * inside one transaction share `ran_at` to the microsecond, and without a tie
   * break "the latest" is whatever the planner returned first, which can differ
   * between two identical reads.
   */
  async latestForPull(
    workspaceId: string,
    prId: string,
  ): Promise<MultiAgentRunRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        ranAt: t.multiAgentRuns.ranAt,
      })
      .from(t.multiAgentRuns)
      .where(
        and(
          eq(t.multiAgentRuns.workspaceId, workspaceId),
          eq(t.multiAgentRuns.prId, prId),
        ),
      )
      .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
      .limit(1);
    return row;
  }

  /**
   * Every run of one multi-agent run, in a stable order — `ran_at` then `id`, for
   * the reason above, so a second GET returns the columns left-to-right as the
   * first one did.
   *
   * The review is fetched as a SECOND query rather than as a third join. A run
   * carries at most one `kind: 'review'` row today, but a join that ever matched
   * two would silently produce two COLUMNS for one agent, which is a wrong
   * `agent_count` rather than a duplicate line.
   */
  async runsFor(multiAgentRunId: string): Promise<ColumnRow[]> {
    const runs = await this.db
      .select({
        runId: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        agentName: t.agents.name,
        provider: t.agentRuns.provider,
        model: t.agentRuns.model,
        status: t.agentRuns.status,
        error: t.agentRuns.error,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
      })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId))
      .orderBy(asc(t.agentRuns.ranAt), asc(t.agentRuns.id));
    if (runs.length === 0) return [];

    const reviews = await this.db
      .select({
        runId: t.reviews.runId,
        verdict: t.reviews.verdict,
        score: t.reviews.score,
        summary: t.reviews.summary,
      })
      .from(t.reviews)
      .where(
        and(
          inArray(
            t.reviews.runId,
            runs.map((r) => r.runId),
          ),
          eq(t.reviews.kind, 'review'),
        ),
      );
    const byRun = new Map(reviews.map((r) => [r.runId, r]));

    return runs.map((run) => {
      const review = run.runId ? byRun.get(run.runId) : undefined;
      return {
        ...run,
        verdict: review?.verdict ?? null,
        score: review?.score ?? null,
        summary: review?.summary ?? null,
      };
    });
  }

  /**
   * The findings those runs produced, carrying `reviews.agent_id` and
   * `reviews.run_id` through. That attribution has existed since the starter and
   * this work does not change it — it is what lets a group name which agent said
   * what.
   */
  async findingsFor(runIds: readonly string[]): Promise<FindingRow[]> {
    if (runIds.length === 0) return [];
    return this.db
      .select({
        findingId: t.findings.id,
        agentId: t.reviews.agentId,
        runId: t.reviews.runId,
        file: t.findings.file,
        startLine: t.findings.startLine,
        endLine: t.findings.endLine,
        title: t.findings.title,
        rationale: t.findings.rationale,
        suggestion: t.findings.suggestion,
        severity: t.findings.severity,
        category: t.findings.category,
        kind: t.findings.kind,
        confidence: t.findings.confidence,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(inArray(t.reviews.runId, [...runIds]))
      .orderBy(asc(t.findings.file), asc(t.findings.startLine), asc(t.findings.id));
  }

  /**
   * Completed runs on this pull request, newest first — the first source an
   * estimate reads, because what an agent cost on THIS diff predicts the next
   * pass on it better than its workspace average does.
   */
  completedRunsForPull(workspaceId: string, prId: string): Promise<CompletedRunRow[]> {
    return this.db
      .select({
        agentId: t.agentRuns.agentId,
        status: t.agentRuns.status,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
      })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.prId, prId),
          eq(t.agentRuns.status, 'done'),
        ),
      )
      .orderBy(desc(t.agentRuns.ranAt), desc(t.agentRuns.id));
  }

  /** The fallback: one agent's most recent completed runs anywhere in the workspace. */
  recentCompletedRunsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<CompletedRunRow[]> {
    return this.db
      .select({
        agentId: t.agentRuns.agentId,
        status: t.agentRuns.status,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
      })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.agentId, agentId),
          eq(t.agentRuns.status, 'done'),
        ),
      )
      .orderBy(desc(t.agentRuns.ranAt), desc(t.agentRuns.id))
      .limit(ESTIMATE_MAX_SAMPLES);
  }
}
