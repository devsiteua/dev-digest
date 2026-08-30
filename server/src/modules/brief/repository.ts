import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * The ONLY layer touching `pr_brief`, and it touches nothing else.
 *
 * Workspace scoping is not enforced here. It is enforced by the caller
 * resolving the pull request through `container.reviewRepo.getPull`, which is
 * the one workspace-scoped query for pull requests in this codebase — the same
 * arrangement `IntentRepository` and `BlastRepository` both document. A method
 * here that took a `workspaceId` would be a second answer to a question that
 * already has one.
 *
 * Every read is ordered by `seq` and never by `generated_at`: `defaultNow()` is
 * the TRANSACTION's timestamp, so two rows written together tie to the
 * microsecond and "the latest one" silently becomes planner order. AC-27 is that
 * gotcha written down as a criterion.
 */
export type BriefRow = typeof t.prBrief.$inferSelect;
export type BriefInsert = typeof t.prBrief.$inferInsert;

export class BriefRepository {
  constructor(private db: Db) {}

  /** The newest brief for a pull request, or undefined when none was ever written. */
  async latest(prId: string): Promise<BriefRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .orderBy(desc(t.prBrief.seq))
      .limit(1);
    return row;
  }

  /** The Why Timeline: newest first, capped at `limit`. */
  timeline(prId: string, limit: number): Promise<BriefRow[]> {
    return this.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .orderBy(desc(t.prBrief.seq))
      .limit(limit);
  }

  /**
   * Write one brief, replacing the row for this exact input state.
   *
   * The conflict target is `(pr_id, state_key)`, so regenerating on unchanged
   * inputs overwrites rather than growing the timeline with a duplicate (AC-08).
   *
   * `id` and `seq` are excluded from the `set` clause deliberately: both are
   * identity, and re-stamping `seq` on an upsert would move an existing brief to
   * the front of the Why Timeline every time somebody pressed Regenerate on an
   * unchanged pull request.
   */
  async upsert(values: BriefInsert): Promise<BriefRow> {
    const [row] = await this.db
      .insert(t.prBrief)
      .values(values)
      .onConflictDoUpdate({
        target: [t.prBrief.prId, t.prBrief.stateKey],
        set: {
          headSha: values.headSha,
          json: values.json,
          generatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  }

  /**
   * Keep the newest `cap` briefs of a pull request and delete the rest (AC-29).
   *
   * Two queries rather than one `delete … where seq not in (subquery)`: the
   * cut-off is read first, then everything below it goes. It costs one extra
   * round trip and it is readable — and `seq` is a table-wide sequence, so
   * "below the cut-off" is unambiguous even though the values are not
   * consecutive within one pull request.
   */
  async trimToCap(prId: string, cap: number): Promise<number> {
    const kept = await this.db
      .select({ seq: t.prBrief.seq })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .orderBy(desc(t.prBrief.seq))
      .limit(cap);
    if (kept.length < cap) return 0;

    const cutoff = kept[kept.length - 1]!.seq;
    const deleted = await this.db
      .delete(t.prBrief)
      .where(and(eq(t.prBrief.prId, prId), lt(t.prBrief.seq, cutoff)))
      .returning({ id: t.prBrief.id });
    return deleted.length;
  }
}
