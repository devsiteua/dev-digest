import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrFileRow } from '../../db/rows.js';

/**
 * The only SQL of the Smart Diff. Two reads, no writes: this feature derives its
 * answer on every request from tables other flows already maintain, so there is
 * no smart-diff table, no cache row and no migration.
 *
 * Workspace scoping is not enforced here, for the same reason it is not in
 * `modules/intent/repository.ts`: the caller resolves the PR through
 * `container.reviewRepo.getPull(workspaceId, prId)` — which IS workspace-scoped —
 * before either method below is reached. Both queries then key on that PR's id.
 */
export class SmartDiffRepository {
  constructor(private db: Db) {}

  /**
   * The changed files of a PR, in a stable order.
   *
   * `GET /pulls/:id` rewrites this table wholesale on every detail load, so the
   * insertion order is not something to rely on; `path` is the only column that
   * orders the same way twice. The grouping sort re-orders these anyway — this
   * ORDER BY exists so that two identical requests cannot disagree.
   */
  async filesForPr(prId: string): Promise<PrFileRow[]> {
    return this.db
      .select()
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
  }

  /**
   * The findings of the PR's LATEST review — file and start line only.
   *
   * "Latest" is the same rule the PR list's severity counters use
   * (`modules/pulls/routes.ts`) and the same one the client's
   * `latestReviewFindings` uses: newest `kind:'review'` row, tie-broken by `id`.
   * `created_at` defaults to `now()`, which in Postgres is the TRANSACTION's
   * start time, so three agents whose reviews land together share a timestamp to
   * the microsecond; `id` cannot say which is newer, but it makes the choice
   * stable instead of leaving it to the planner.
   *
   * Summaries (`kind:'summary'`) carry no findings and are excluded, and
   * DISMISSED findings are included — the counters beside them include those too,
   * and two tallies that disagree are worse than one that is arguably generous.
   */
  async latestReviewFindingLines(prId: string): Promise<{ file: string; startLine: number }[]> {
    const [review] = await this.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, prId), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt), desc(t.reviews.id))
      .limit(1);
    if (!review) return [];

    return this.db
      .select({ file: t.findings.file, startLine: t.findings.startLine })
      .from(t.findings)
      .where(eq(t.findings.reviewId, review.id));
  }
}
