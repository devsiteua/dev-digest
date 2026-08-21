import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionStatus } from '@devdigest/shared';

/**
 * Conventions data-access. Owns the `conventions` table — the only place in the
 * module where Drizzle appears.
 *
 * Every method takes `workspaceId` and every statement filters on it, including
 * the ones addressed by primary key: a candidate id is a uuid a caller could
 * have obtained anywhere, and the evidence snippet stored next to it is verbatim
 * source code from somebody's private repository. A miss returns
 * `undefined`/`0`, which the service turns into a 404 rather than a leak.
 *
 * `getRepo` reads the `repos` table rather than borrowing the repos module's
 * data layer — the same shape `repo-intel` and `reviews` already keep for the
 * same reason (cross-module reuse goes through the container, and a two-column
 * read is not worth a container entry).
 */

import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

/** Just enough of a repo to name it in a prompt and to read files out of its clone. */
export interface ConventionRepoRef {
  id: string;
  owner: string;
  name: string;
  fullName: string;
}

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  rule: string;
  category: string;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  confidence: number;
}

/** Reword / re-file. Evidence is deliberately absent — see `ConventionUpdate`. */
export interface UpdateConventionFields {
  rule?: string;
  category?: string;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<ConventionRepoRef | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * Every candidate of one repo, newest pass first.
   *
   * The secondary sort keys are not decoration. `insertMany` writes a whole pass
   * in one statement, so `created_at` — which is the TRANSACTION's timestamp —
   * is identical to the microsecond across all of them (root `INSIGHTS.md`,
   * 2026-08-02). Without `confidence` and `id` after it, two identical requests
   * could return the cards in different orders.
   */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.createdAt), desc(t.conventions.confidence), asc(t.conventions.id));
  }

  async get(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /** Persist one verified pass. Rows land as `pending` (the column's default). */
  async insertMany(values: InsertConvention[]): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    return this.db.insert(t.conventions).values(values).returning();
  }

  async updateStatus(
    workspaceId: string,
    id: string,
    status: ConventionStatus,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ status })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async updateFields(
    workspaceId: string,
    id: string,
    patch: UpdateConventionFields,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Stamp the merged skill's id onto the candidates that went into it. */
  async markLinkedToSkill(
    workspaceId: string,
    ids: string[],
    skillId: string,
  ): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .update(t.conventions)
      .set({ skillId })
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)))
      .returning();
  }

  /**
   * Clear the undecided candidates of a repo — what a re-scan replaces.
   *
   * `accepted` and `rejected` rows survive on purpose: they are the user's
   * decisions, and deleting them would let every rejected rule come back as new
   * on the next pass. That, plus the caller's rule-key check against the
   * survivors, is the whole merge strategy.
   */
  async deletePendingByRepo(workspaceId: string, repoId: string): Promise<number> {
    const rows = await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'pending'),
        ),
      )
      .returning({ id: t.conventions.id });
    return rows.length;
  }
}
