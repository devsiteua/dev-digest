import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * The only SQL of the Blast Radius, and it is one read.
 *
 * Everything else this feature answers with comes from the repo-intel index
 * through `container.repoIntel`, which owns those tables — so there is no blast
 * table, no cache row and no migration.
 *
 * Workspace scoping is not enforced here, for the reason
 * `modules/smart-diff/repository.ts` gives: the caller resolves the PR through
 * `container.reviewRepo.getPull(workspaceId, prId)` — the one workspace-scoped
 * PR query — before this method is reached, and it keys on that PR's id.
 */
export class BlastRepository {
  constructor(private db: Db) {}

  /**
   * The changed file paths of a PR, in a stable order.
   *
   * `GET /pulls/:id` rewrites this table wholesale on every detail load, so
   * insertion order says nothing; `path` is the only column that orders the same
   * way twice. Nothing downstream depends on the order, which is exactly why it
   * has to be pinned — an unordered list reaches the index as an unordered
   * `IN (...)`, and two identical requests could then disagree about which of
   * two equally-ranked callers survived the cap.
   */
  async pathsForPr(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
    return rows.map((row) => row.path);
  }
}
