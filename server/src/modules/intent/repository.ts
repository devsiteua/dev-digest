import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrIntentRow } from '../../db/rows.js';

/**
 * The ONLY layer touching `pr_intent`.
 *
 * The table used to be reachable from `ReviewRepository` through two methods
 * nobody called; L03 deleted those rather than leave two writers with two
 * different column sets. Workspace scoping is not enforced here — it is enforced
 * by the caller resolving the PR through `container.reviewRepo.getPull`, which is
 * workspace-scoped, before this class is ever reached.
 */
export type IntentInsert = typeof t.prIntent.$inferInsert;

export class IntentRepository {
  constructor(private db: Db) {}

  async get(prId: string): Promise<PrIntentRow | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row;
  }

  /** Upsert by PR — one intent per PR, replaced whenever the head moves. */
  async upsert(values: IntentInsert): Promise<PrIntentRow> {
    const { prId, ...rest } = values;
    const [row] = await this.db
      .insert(t.prIntent)
      .values(values)
      .onConflictDoUpdate({ target: t.prIntent.prId, set: { ...rest, generatedAt: new Date() } })
      .returning();
    return row!;
  }

  /**
   * Commit subjects for a PR, oldest first.
   *
   * Sorted by `sha` as well as by time on purpose: `committed_at` is nullable
   * (a commit imported without one) and several commits can share a timestamp to
   * the second, so time alone leaves the order to the planner — the same trap the
   * root CLAUDE.md records for `defaultNow()`.
   */
  async commitMessages(prId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ message: t.prCommits.message })
      .from(t.prCommits)
      .where(eq(t.prCommits.prId, prId))
      .orderBy(asc(t.prCommits.committedAt), asc(t.prCommits.sha))
      .limit(limit);
    return rows.map((r) => r.message);
  }
}
