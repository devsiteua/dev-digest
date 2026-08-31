import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable('eval_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  inputDiff: text('input_diff'),
  inputFiles: jsonb('input_files'),
  inputMeta: jsonb('input_meta'),
  expectedOutput: jsonb('expected_output'),
  notes: text('notes'),
});

/**
 * One execution of a whole case SET — the unit a metric is comparable across.
 *
 * It snapshots the prompt, provider, model and agent version read at run START,
 * so "which edit moved recall" is answerable from the row itself rather than from
 * whatever the agent looks like now.
 *
 * `agentId` deliberately carries NO foreign key, mirroring `evalCases.ownerId`
 * above: a batch is a historical measurement that outlives the agent it measured,
 * exactly as a case outlives the PR it was cut from. The asymmetry with
 * `workspaceId` (which does cascade) is intentional — a deleted workspace takes
 * its history with it; a deleted agent does not.
 */
export const evalRunBatches = pgTable(
  'eval_run_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The agent this batch measured. No FK — see the table comment. */
    agentId: uuid('agent_id').notNull(),
    systemPromptSnapshot: text('system_prompt_snapshot').notNull(),
    modelSnapshot: text('model_snapshot').notNull(),
    providerSnapshot: text('provider_snapshot').notNull(),
    agentVersion: integer('agent_version').notNull(),
    status: text('status', { enum: ['running', 'done', 'partial', 'failed'] })
      .notNull()
      .default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Null while the batch is still running; a ratio once it reaches a terminal status. */
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    /**
     * The denominators the three ratios were computed over. Persisted because a
     * ratio without its denominator cannot be compared across two runs of
     * different set sizes — which is the whole point of a batch.
     */
    recallDenominator: integer('recall_denominator').notNull().default(0),
    precisionDenominator: integer('precision_denominator').notNull().default(0),
    citationDenominator: integer('citation_denominator').notNull().default(0),
    /** `casesRan < casesTotal` is what makes a `partial` batch honest on screen. */
    casesTotal: integer('cases_total').notNull().default(0),
    casesRan: integer('cases_ran').notNull().default(0),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
  },
  (t) => ({
    /**
     * One running batch per agent, enforced by the database rather than by a
     * check-then-insert in the service: the second concurrent request loses the
     * insert instead of racing past a SELECT that was true a moment ago.
     */
    oneRunningPerAgent: uniqueIndex('eval_run_batches_agent_running_uq')
      .on(t.agentId)
      .where(sql`status = 'running'`),
    /**
     * "Latest per agent" reads sort by (started_at desc, id desc): `defaultNow()`
     * is the TRANSACTION's timestamp, so rows written together tie to the
     * microsecond and a single-key sort returns planner order.
     */
    wsAgentIdx: index('eval_run_batches_ws_agent_idx').on(t.workspaceId, t.agentId, t.startedAt),
  }),
);

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  /**
   * The batch this row belongs to. `notNull` is safe as an addition because the
   * table has no writer anywhere in the tree today — verified before the column
   * was added, and there is no environment holding a legacy row.
   */
  batchId: uuid('batch_id')
    .notNull()
    .references(() => evalRunBatches.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  actualOutput: jsonb('actual_output'),
  /** `errored` is a case that threw — distinct from one that ran and failed. */
  status: text('status', { enum: ['passed', 'failed', 'errored'] }).notNull().default('failed'),
  error: text('error'),
  pass: boolean('pass'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  /** The per-case numerator/denominator behind `recall`, for the comparison list. */
  matchedCount: integer('matched_count'),
  expectedCount: integer('expected_count'),
  /**
   * `precision`'s denominator for this row: findings that landed on ANY of the
   * set's expectations. Not the count of findings reported — a case stores the
   * whole PR diff, so most of what the agent says is unjudged and belongs in
   * neither half of the ratio. Stored rather than derived because the drop lists
   * it would need are not persisted, and a screen with no denominator renders
   * the vacuous 1 as a confident 100%.
   */
  precisionDenominator: integer('precision_denominator'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
});

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
