import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentRow, SkillRow } from '../../db/rows.js';
import type { CiRunListRow } from './helpers.js';

/**
 * The only file in `modules/ci` that touches Drizzle.
 *
 * `ci_installations` has no `workspace_id` of its own — it hangs off an agent,
 * and the agent has one. Every read here therefore joins `agents` and filters on
 * `agents.workspace_id`, which is what makes a workspace-scoped query possible
 * at all on this table. AC-23 is that arrangement stated as a criterion: the
 * workspace of an ingested run comes from the installation's agent and never
 * from the request.
 */

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiRunRow = typeof t.ciRuns.$inferSelect;

/** An agent and the skills attached to it, in the user's stated order. */
export interface AgentWithSkills {
  agent: AgentRow;
  skills: SkillRow[];
}

export class CiRepository {
  constructor(private db: Db) {}

  /**
   * The agent and its skills, or undefined when the agent is not in this
   * workspace. One method rather than two because the export needs both and a
   * caller that could get one without the other could build half a manifest.
   *
   * Only ENABLED skills are returned, which is the same set a local review is
   * built from (`buildSkillBlocks`, `modules/reviews/inputs.ts`). Shipping a
   * skill the user switched off would make a CI review apply a rule the studio
   * does not — and the whole point of exporting is that the two agree.
   */
  async agentWithSkills(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentWithSkills | undefined> {
    const [agent] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)));
    if (!agent) return undefined;

    const rows = await this.db
      .select({ skill: t.skills })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));

    return { agent, skills: rows.map((r) => r.skill).filter((s) => s.enabled) };
  }

  /** The installation for this agent + repository, if one already exists. */
  async findInstallation(
    workspaceId: string,
    agentId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(
        and(
          eq(t.ciInstallations.agentId, agentId),
          eq(t.ciInstallations.repo, repo),
          eq(t.agents.workspaceId, workspaceId),
        ),
      );
    return row?.installation;
  }

  /** Record a new installation. Callers reuse an existing row rather than duplicating. */
  async insertInstallation(input: {
    agentId: string;
    repo: string;
    targetType: CiInstallationRow['targetType'];
  }): Promise<CiInstallationRow> {
    const [row] = await this.db.insert(t.ciInstallations).values(input).returning();
    // `.returning()` on a single-row insert always yields the row; the guard is
    // for the type, not for a case that can happen.
    if (!row) throw new Error('ci_installations insert returned no row');
    return row;
  }

  /**
   * The installation an ingested artifact belongs to, resolved by repository
   * alone, together with the workspace and agent it hangs off.
   *
   * This is the ONLY authority for the workspace of an ingested run: the request
   * body never names one, and a body that could would let anyone holding the
   * ingest token write into any workspace (AC-23).
   *
   * A repository exported twice — to a second agent — has two rows. The newest
   * wins, with `id` as the tie-break because `defaultNow()` is the transaction's
   * timestamp and two rows written together tie to the microsecond.
   */
  async findInstallationByRepo(repo: string): Promise<InstallationTarget | undefined> {
    const [row] = await this.db
      .select({
        installation: t.ciInstallations,
        agentId: t.agents.id,
        workspaceId: t.agents.workspaceId,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.ciInstallations.repo, repo))
      .orderBy(desc(t.ciInstallations.installedAt), desc(t.ciInstallations.id))
      .limit(1);
    return row;
  }

  /** The already-ingested run for this installation + PR + commit, if any. */
  async findRun(
    ciInstallationId: string,
    prNumber: number,
    commitSha: string,
  ): Promise<CiRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, ciInstallationId),
          eq(t.ciRuns.prNumber, prNumber),
          eq(t.ciRuns.commitSha, commitSha),
        ),
      );
    return row;
  }

  /**
   * Write the local `agent_runs` row and the `ci_runs` row that points at it, in
   * ONE transaction — a `ci_runs` row whose `agent_run_id` dangles would show a
   * run with no duration and no cost, which is worse than no row at all.
   */
  async recordRun(input: {
    agentRun: typeof t.agentRuns.$inferInsert;
    ciRun: Omit<typeof t.ciRuns.$inferInsert, 'agentRunId'>;
  }): Promise<CiRunRow> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx.insert(t.agentRuns).values(input.agentRun).returning();
      if (!run) throw new Error('agent_runs insert returned no row');
      const [ciRun] = await tx
        .insert(t.ciRuns)
        .values({ ...input.ciRun, agentRunId: run.id })
        .returning();
      if (!ciRun) throw new Error('ci_runs insert returned no row');
      return ciRun;
    });
  }

  /**
   * The most recent CI runs in a workspace, newest first.
   *
   * Scoped through `ci_installations → agents`, which is the only path from a
   * `ci_runs` row to a workspace. Ordered by `ran_at` AND `id`: `defaultNow()`
   * ties a batch to the microsecond, so `ran_at` alone answers in planner order.
   */
  listRuns(workspaceId: string, limit: number): Promise<CiRunListRow[]> {
    return this.runQuery().where(eq(t.agents.workspaceId, workspaceId)).limit(limit);
  }

  /** The same list, narrowed to one agent. */
  listRunsForAgent(
    workspaceId: string,
    agentId: string,
    limit: number,
  ): Promise<CiRunListRow[]> {
    return this.runQuery()
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
      .limit(limit);
  }

  /** Every repository this agent has been exported to. */
  listInstallations(workspaceId: string, agentId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
      .orderBy(desc(t.ciInstallations.installedAt), desc(t.ciInstallations.id))
      .then((rows) => rows.map((r) => r.installation));
  }

  /** The joins both run lists share; the caller adds its own `where` and limit. */
  private runQuery() {
    return this.db
      .select({
        run: t.ciRuns,
        repo: t.ciInstallations.repo,
        agentName: t.agents.name,
        durationMs: t.agentRuns.durationMs,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .leftJoin(t.agentRuns, eq(t.ciRuns.agentRunId, t.agentRuns.id))
      .orderBy(desc(t.ciRuns.ranAt), desc(t.ciRuns.id))
      .$dynamic();
  }
}

/** An installation plus the workspace and agent it determines. */
export interface InstallationTarget {
  installation: CiInstallationRow;
  agentId: string;
  workspaceId: string;
}
