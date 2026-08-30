import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Eval data access. Owns `eval_cases` — the only place in the module where
 * Drizzle appears.
 *
 * Every method that reads or updates takes `workspaceId` and filters on it,
 * including the ones addressed by primary key: a case id is a uuid a caller could
 * have obtained anywhere, and the frozen diff stored next to it is the user's
 * source code. A miss returns `undefined`/`false`, which the service turns into a
 * 404 rather than a leak.
 *
 * `eval_runs` carries no `workspace_id` of its own (`schema/eval.ts`): it is a
 * child of a batch, and the batch is what holds the tenancy. Reads of it are
 * therefore scoped by an INNER JOIN onto `eval_run_batches` — see
 * `listRunsForBatches` — rather than by trusting the ids the caller passed in.
 *
 * `insertRun` is the single method that cannot be scoped that way, because an
 * INSERT has nothing to join against. Its safety is the caller's `batchId`,
 * which every call site derives from `insertBatch`'s own return value inside a
 * workspace-scoped `startRun`. It is named here, alone, because a doc comment
 * that claims an invariant some method below it does not keep is worse than no
 * comment at all — and this paragraph has already been wrong once.
 *
 * What is NOT here, on purpose: `eval_cases` keeps no foreign key to the pull
 * request or the finding it was cut from (`schema/eval.ts`). Provenance lives in
 * `input_meta` as data. That is what makes a case survive the deletion of the PR
 * it came from — the case is a frozen measurement, not a view onto live rows.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunBatchRow = typeof t.evalRunBatches.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: 'agent';
  ownerId: string;
  name: string;
  inputDiff: string;
  inputMeta: unknown;
  expectedOutput: unknown;
}

export class EvalsRepository {
  constructor(private db: Db) {}

  /** Just enough of an agent to prove it exists inside this workspace. */
  async getAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const [row] = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return row;
  }

  /**
   * One agent's case set.
   *
   * Ordered by `(name, id)`. `id` after `name` is not decoration: names are not
   * unique — two findings can share a title — and there is no timestamp on the
   * table to break the tie with, so without the second key the answer is planner
   * order and the list reshuffles between two identical requests.
   */
  async listByOwner(workspaceId: string, ownerId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, ownerId)))
      .orderBy(t.evalCases.name, t.evalCases.id);
  }

  async get(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /**
   * The existing case cut from this finding, if there is one.
   *
   * Reads the provenance out of the JSON rather than joining, because there is
   * no foreign key to join on — see the file comment. `->>` yields text, and the
   * finding id is a uuid rendered as text on the way in, so the comparison is
   * text-to-text with no cast on either side.
   */
  async findBySourceFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          sql`${t.evalCases.inputMeta}->>'source_finding_id' = ${findingId}`,
        ),
      );
    return row;
  }

  async insert(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db.insert(t.evalCases).values(values).returning();
    return row!;
  }

  /**
   * Delete one case. Its `eval_runs` rows go with it through the FK's
   * `onDelete: 'cascade'` (`schema/eval.ts`) — the metrics of a case that no
   * longer exists describe nothing, and leaving them would put orphan rows in
   * every denominator.
   */
  async remove(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** Every case in the workspace — the dashboard's `cases_total`. */
  async countForWorkspace(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(eq(t.evalCases.workspaceId, workspaceId));
    return rows.length;
  }

  // ---- batches + per-case rows -------------------------------------------

  /**
   * Open a batch. The partial unique index on `(agent_id) where status =
   * 'running'` is what refuses a second concurrent run (AC-13) — a
   * check-then-insert here would be a race, so the insert is allowed to fail and
   * the service names the reason.
   */
  async insertBatch(values: {
    workspaceId: string;
    agentId: string;
    agentVersion: number;
    systemPromptSnapshot: string;
    modelSnapshot: string;
    providerSnapshot: string;
    casesTotal: number;
  }): Promise<EvalRunBatchRow> {
    const [row] = await this.db.insert(t.evalRunBatches).values(values).returning();
    return row!;
  }

  async getBatch(workspaceId: string, id: string): Promise<EvalRunBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRunBatches)
      .where(and(eq(t.evalRunBatches.workspaceId, workspaceId), eq(t.evalRunBatches.id, id)));
    return row;
  }

  /**
   * One agent's batches, newest first.
   *
   * `(started_at desc, id desc)`, never `started_at` alone: `defaultNow()` is the
   * TRANSACTION's timestamp (root `CLAUDE.md` § Gotchas), so two batches opened
   * in one transaction tie to the microsecond and a single-key sort answers in
   * planner order.
   */
  async listBatchesForAgent(workspaceId: string, agentId: string): Promise<EvalRunBatchRow[]> {
    return this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(eq(t.evalRunBatches.workspaceId, workspaceId), eq(t.evalRunBatches.agentId, agentId)),
      )
      .orderBy(desc(t.evalRunBatches.startedAt), desc(t.evalRunBatches.id));
  }

  /** Every batch in the workspace, newest first — the dashboard's input. */
  async listBatchesForWorkspace(workspaceId: string): Promise<EvalRunBatchRow[]> {
    return this.db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.workspaceId, workspaceId))
      .orderBy(desc(t.evalRunBatches.startedAt), desc(t.evalRunBatches.id));
  }

  /**
   * Fail every batch left `running` by a process that died mid-run.
   *
   * Workspace-wide on purpose, and the one method here that is not scoped by a
   * workspace, because it runs at boot before any request has a context. It is
   * the eval twin of `ReviewService.reapStaleRuns` (`app.ts`), and it matters
   * MORE than that one does: `eval_run_batches` carries a partial unique index
   * on `(agent_id) WHERE status = 'running'`, so a row nobody will ever finish
   * is not merely cosmetic — it is a permanent lock, and every later run of that
   * agent answers 409 until someone edits the database by hand. Same
   * single-API-instance assumption as its twin.
   */
  async reapStaleBatches(): Promise<number> {
    const rows = await this.db
      .update(t.evalRunBatches)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: 'reaped on boot: the process running this batch did not survive it',
      })
      .where(eq(t.evalRunBatches.status, 'running'))
      .returning({ id: t.evalRunBatches.id });
    return rows.length;
  }

  async updateBatch(
    workspaceId: string,
    id: string,
    values: Partial<EvalRunBatchRow>,
  ): Promise<void> {
    await this.db
      .update(t.evalRunBatches)
      .set(values)
      .where(and(eq(t.evalRunBatches.id, id), eq(t.evalRunBatches.workspaceId, workspaceId)));
  }

  async insertRun(values: {
    batchId: string;
    caseId: string;
    status: 'passed' | 'failed' | 'errored';
    error?: string | null;
    actualOutput?: unknown;
    pass?: boolean | null;
    recall?: number | null;
    precision?: number | null;
    citationAccuracy?: number | null;
    matchedCount?: number | null;
    expectedCount?: number | null;
    durationMs?: number | null;
    costUsd?: number | null;
  }): Promise<EvalRunRow> {
    const [row] = await this.db.insert(t.evalRuns).values(values).returning();
    return row!;
  }

  /**
   * The per-case rows of one or more batches, with each case's name joined in.
   *
   * `(ran_at, id)`: every row of a batch is written in its own statement but
   * within milliseconds, and `ran_at` alone cannot order them reliably.
   */
  async listRunsForBatches(
    workspaceId: string,
    batchIds: string[],
  ): Promise<(EvalRunRow & { caseName: string | null })[]> {
    if (batchIds.length === 0) return [];
    return this.db
      .select({
        id: t.evalRuns.id,
        batchId: t.evalRuns.batchId,
        caseId: t.evalRuns.caseId,
        ranAt: t.evalRuns.ranAt,
        actualOutput: t.evalRuns.actualOutput,
        status: t.evalRuns.status,
        error: t.evalRuns.error,
        pass: t.evalRuns.pass,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citationAccuracy: t.evalRuns.citationAccuracy,
        matchedCount: t.evalRuns.matchedCount,
        expectedCount: t.evalRuns.expectedCount,
        durationMs: t.evalRuns.durationMs,
        costUsd: t.evalRuns.costUsd,
        caseName: t.evalCases.name,
      })
      .from(t.evalRuns)
      // `eval_runs` carries no workspace of its own, so the scoping is an INNER
      // join onto the batch that owns the row. Not the caller's job: a repository
      // that trusts its caller to have scoped the ids it was handed is a
      // repository whose invariant holds only until someone forgets.
      .innerJoin(
        t.evalRunBatches,
        and(
          eq(t.evalRunBatches.id, t.evalRuns.batchId),
          eq(t.evalRunBatches.workspaceId, workspaceId),
        ),
      )
      .leftJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(inArray(t.evalRuns.batchId, batchIds))
      .orderBy(t.evalRuns.ranAt, t.evalRuns.id);
  }
}
