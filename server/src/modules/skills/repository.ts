import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions`.
 *
 * The `agent_skills` link table is deliberately NOT owned here — the agents
 * module owns the agent side of that relation (link / reorder / list for an
 * agent) and already implements it. This repository only answers the question
 * the agents module cannot: "are these skill ids mine?".
 *
 * Workspace-scoped throughout; there is no unscoped read.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  /**
   * Files whose lines the body was derived from. Only an `extracted` skill has
   * these — it is the provenance the Skills screen shows next to the badge, and
   * the reason `skills.evidence_files` existed before anything wrote to it.
   */
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  /**
   * Deliberately absent from `UpdateSkillInput`, the shape `PUT /skills/:id`
   * accepts: provenance is not editable, and a hand-typed file list would claim
   * evidence nothing verified. Only a re-merge of extracted conventions rewrites
   * it, because only that path re-derives it from candidates on disk.
   */
  evidenceFiles?: string[];
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /**
   * Ids from `ids` that exist in this workspace. The caller compares the size of
   * the result with the size of its input — that is how a cross-workspace skill
   * id is rejected before it can be linked to an agent.
   */
  async idsInWorkspace(workspaceId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, ids)));
    return rows.map((r) => r.id);
  }

  /** Whether a skill of this name already exists (optionally excluding one id). */
  async findByName(
    workspaceId: string,
    name: string,
    exceptId?: string,
  ): Promise<SkillRow | undefined> {
    const rows = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, name)));
    return rows.find((r) => r.id !== exceptId);
  }

  /** Insert a skill AND record version 1 of its body (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        ...(values.evidenceFiles !== undefined ? { evidenceFiles: values.evidenceFiles } : {}),
      })
      .returning();
    await this.snapshotVersion(row!.id, INITIAL_SKILL_VERSION, row!.body);
    return row!;
  }

  /**
   * Update a skill. A changed `body` bumps the version and snapshots the new text
   * into `skill_versions`; metadata-only edits (name, description, type, enabled)
   * do not — the version identifies the TEXT an eval scored, nothing else.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row.id, nextVersion, row.body);
    return row;
  }

  /** Delete a skill. Its versions and every agent link cascade away. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  // ---- skill_versions (immutable body snapshots) ---------------------------

  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** One body snapshot, or undefined when that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- usage stats ---------------------------------------------------------
  // These read `agents`, `agent_skills`, `agent_runs`, `reviews` and `findings`
  // — tables other modules own the WRITE side of. That is deliberate and is not
  // the cross-module import the onion guard is about: no module code is imported
  // here, only the schema barrel every repository already reads. The alternative
  // (asking the agents and reviews services) would put a service-to-service call
  // in a read path that is one SQL query.

  /** Agents this skill is attached to, within the workspace. */
  async usedByAgents(
    workspaceId: string,
    skillId: string,
  ): Promise<{ id: string; name: string; enabled: boolean }[]> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name, enabled: t.agents.enabled })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(asc(t.agents.name));
  }

  /** Runs started by any of `agentIds` since `since`, any status. */
  async runCountForAgents(
    workspaceId: string,
    agentIds: string[],
    since: Date,
  ): Promise<number> {
    if (agentIds.length === 0) return 0;
    const [row] = await this.db
      .select({ count: count() })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          inArray(t.agentRuns.agentId, agentIds),
          gte(t.agentRuns.ranAt, since),
        ),
      );
    return row?.count ?? 0;
  }

  /**
   * Findings produced by any of `agentIds` since `since`, with the triage split
   * and a per-category breakdown.
   *
   * `findings` has no skill column — it hangs off `reviews.agent_id` — so this is
   * attribution to the AGENTS that carry the skill, never to the skill itself.
   * The caller is responsible for saying so on screen; see `SkillStats`.
   */
  async findingStatsForAgents(
    workspaceId: string,
    agentIds: string[],
    since: Date,
  ): Promise<{
    total: number;
    accepted: number;
    dismissed: number;
    byCategory: { category: string; count: number }[];
  }> {
    if (agentIds.length === 0) return { total: 0, accepted: 0, dismissed: 0, byCategory: [] };

    const scope = and(
      eq(t.reviews.workspaceId, workspaceId),
      inArray(t.reviews.agentId, agentIds),
      gte(t.reviews.createdAt, since),
    );

    const [totals] = await this.db
      .select({
        total: count(),
        accepted: sql<number>`count(*) filter (where ${t.findings.acceptedAt} is not null)::int`,
        dismissed: sql<number>`count(*) filter (where ${t.findings.dismissedAt} is not null)::int`,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(scope);

    const byCategory = await this.db
      .select({ category: t.findings.category, count: count() })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(scope)
      .groupBy(t.findings.category)
      .orderBy(desc(count()));

    return {
      total: totals?.total ?? 0,
      accepted: totals?.accepted ?? 0,
      dismissed: totals?.dismissed ?? 0,
      byCategory,
    };
  }

  private async snapshotVersion(skillId: string, version: number, body: string): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }
}
