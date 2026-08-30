import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentRow, SkillRow } from '../../db/rows.js';

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
}
