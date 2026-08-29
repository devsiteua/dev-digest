import { and, asc, eq, max } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Project-context data access. Owns `project_context_docs` — the only place in
 * the module where Drizzle appears.
 *
 * Every method takes `workspaceId` and every statement filters on it, including
 * the ones addressed by primary key: a document id is a uuid a caller could have
 * obtained anywhere, and the body stored next to it is a private document the
 * user uploaded. A miss returns `undefined`/`false`, which the service turns
 * into a 404 rather than a leak.
 *
 * Nothing here reads or writes a file. The documents are DevDigest's own rows;
 * `repos.clone_path` is not consulted by this module at all.
 */

export type ProjectContextDocRow = typeof t.projectContextDocs.$inferSelect;

/** A row without its body — what the list route returns. */
export type ProjectContextDocSummary = Omit<ProjectContextDocRow, 'body'>;

/** Just enough of a repo to prove it exists inside this workspace. */
export interface ProjectContextRepoRef {
  id: string;
  fullName: string;
}

export interface InsertProjectContextDoc {
  workspaceId: string;
  repoId: string;
  title: string;
  pathLabel: string;
  body: string;
  order: number;
  sizeBytes: number;
}

/** Enable/disable and retitle. The body is deliberately absent — see AC-23. */
export interface UpdateProjectContextDoc {
  enabled?: boolean;
  title?: string;
}

/**
 * The columns of the list projection, named once so the summary select and the
 * `Omit` above cannot drift.
 */
const SUMMARY_COLUMNS = {
  id: t.projectContextDocs.id,
  workspaceId: t.projectContextDocs.workspaceId,
  repoId: t.projectContextDocs.repoId,
  title: t.projectContextDocs.title,
  pathLabel: t.projectContextDocs.pathLabel,
  enabled: t.projectContextDocs.enabled,
  order: t.projectContextDocs.order,
  sizeBytes: t.projectContextDocs.sizeBytes,
  updatedAt: t.projectContextDocs.updatedAt,
} as const;

export class ProjectContextRepository {
  constructor(private db: Db) {}

  async getRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<ProjectContextRepoRef | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * Every document of one repo, in the user's order, bodies omitted.
   *
   * `id` after `order` is not decoration: `order` is not unique, a partial
   * reorder can leave two rows sharing one, and `updated_at` cannot break the
   * tie either — `defaultNow()` is the TRANSACTION's timestamp (root
   * `INSIGHTS.md`). Without the second key the answer is planner order.
   */
  async listByRepo(workspaceId: string, repoId: string): Promise<ProjectContextDocSummary[]> {
    return this.db
      .select(SUMMARY_COLUMNS)
      .from(t.projectContextDocs)
      .where(
        and(
          eq(t.projectContextDocs.workspaceId, workspaceId),
          eq(t.projectContextDocs.repoId, repoId),
        ),
      )
      .orderBy(asc(t.projectContextDocs.order), asc(t.projectContextDocs.id));
  }

  /** The enabled documents of one repo, WITH bodies, in the user's order. */
  async listEnabledByRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<ProjectContextDocRow[]> {
    return this.db
      .select()
      .from(t.projectContextDocs)
      .where(
        and(
          eq(t.projectContextDocs.workspaceId, workspaceId),
          eq(t.projectContextDocs.repoId, repoId),
          eq(t.projectContextDocs.enabled, true),
        ),
      )
      .orderBy(asc(t.projectContextDocs.order), asc(t.projectContextDocs.id));
  }

  async get(workspaceId: string, id: string): Promise<ProjectContextDocRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.projectContextDocs)
      .where(
        and(
          eq(t.projectContextDocs.workspaceId, workspaceId),
          eq(t.projectContextDocs.id, id),
        ),
      );
    return row;
  }

  async countByRepo(workspaceId: string, repoId: string): Promise<number> {
    const rows = await this.db
      .select({ id: t.projectContextDocs.id })
      .from(t.projectContextDocs)
      .where(
        and(
          eq(t.projectContextDocs.workspaceId, workspaceId),
          eq(t.projectContextDocs.repoId, repoId),
        ),
      );
    return rows.length;
  }

  /** One past the tail of `order`, or 0 for the first document of a repo. */
  async nextOrder(workspaceId: string, repoId: string): Promise<number> {
    const [row] = await this.db
      .select({ maxOrder: max(t.projectContextDocs.order) })
      .from(t.projectContextDocs)
      .where(
        and(
          eq(t.projectContextDocs.workspaceId, workspaceId),
          eq(t.projectContextDocs.repoId, repoId),
        ),
      );
    const current = row?.maxOrder;
    return current === null || current === undefined ? 0 : Number(current) + 1;
  }

  async insert(values: InsertProjectContextDoc): Promise<ProjectContextDocRow> {
    const [row] = await this.db.insert(t.projectContextDocs).values(values).returning();
    // `.returning()` on a single-row insert always yields one row; the throw is
    // for the type, not for a case anyone has seen.
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateProjectContextDoc,
  ): Promise<ProjectContextDocRow | undefined> {
    const [row] = await this.db
      .update(t.projectContextDocs)
      .set({
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(t.projectContextDocs.workspaceId, workspaceId),
          eq(t.projectContextDocs.id, id),
        ),
      )
      .returning();
    return row;
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.projectContextDocs)
      .where(
        and(
          eq(t.projectContextDocs.workspaceId, workspaceId),
          eq(t.projectContextDocs.id, id),
        ),
      )
      .returning({ id: t.projectContextDocs.id });
    return rows.length > 0;
  }

  /**
   * Write the given ids' positions as their index in the list, in one
   * transaction so a half-applied order is never visible.
   *
   * Scoped by repo as well as workspace, so an id belonging to another
   * repository is a no-op rather than a cross-repo write.
   */
  async setOrder(workspaceId: string, repoId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx
          .update(t.projectContextDocs)
          .set({ order: index })
          .where(
            and(
              eq(t.projectContextDocs.workspaceId, workspaceId),
              eq(t.projectContextDocs.repoId, repoId),
              eq(t.projectContextDocs.id, id),
            ),
          );
      }
    });
  }
}
