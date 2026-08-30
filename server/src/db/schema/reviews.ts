import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  serial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});

/**
 * One derived intent per PR (L03), plus everything that makes it auditable.
 *
 * Written by exactly one code path — `modules/intent/repository.ts` — which always
 * knows every column, so almost nothing here is nullable. `cost_usd` is the
 * exception, and carries the same meaning it does on `agent_runs`: null is "the
 * model has no known price", 0 is "genuinely free".
 *
 * The row is a CACHE keyed on `head_sha`: a review reuses it while the PR's head
 * has not moved and re-derives when it has, because scope claimed before a
 * force-push is not this PR's scope.
 */
export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Mirrors `IntentKind` in @devdigest/shared. Drizzle emits a bare `text` column
  // for this, so widening the list is a TYPE-level change with no migration.
  kind: text('kind', {
    enum: [
      'feature',
      'fix',
      'refactor',
      'perf',
      'docs',
      'test',
      'chore',
      'deps',
      'revert',
      'mixed',
    ],
  }).notNull(),
  /** `TIER_SCORE[confidence_tier]`, never an independent number. */
  confidence: doublePrecision('confidence').notNull(),
  // Mirrors `IntentConfidenceTier` in @devdigest/shared.
  confidenceTier: text('confidence_tier', { enum: ['high', 'medium', 'low'] }).notNull(),
  /** Which `IntentSource`s the derivation actually used, strongest first. */
  sources: jsonb('sources').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Quoted spans behind the claim; shape of `IntentEvidence` in @devdigest/shared. */
  evidence: jsonb('evidence')
    .$type<{ source: string; ref: string; quote: string }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /**
   * What the PR named, or a derivation expected, and could not be read.
   *
   * Shaped like `in_scope` — `notNull` with a `'[]'::jsonb` default — because an
   * empty list and a null both mean "nothing was missing", and one of those two
   * spellings would then have to be handled by every reader. The default also
   * makes this column addable to a table that already has rows.
   */
  missingContext: jsonb('missing_context').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  tokensIn: integer('tokens_in').notNull(),
  tokensOut: integer('tokens_out').notNull(),
  /** Null = unpriced model, NOT free. Same convention as `agent_runs.cost_usd`. */
  costUsd: doublePrecision('cost_usd'),
  durationMs: integer('duration_ms').notNull(),
  /** The commit this intent was derived at — the cache key. */
  headSha: text('head_sha').notNull(),
  /**
   * NOT the `now()` helper: that one is hardcoded to a column literally named
   * `created_at`, and this row is upserted in place rather than created once, so
   * the honest name is when the intent was last DERIVED.
   */
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * One row per BRIEF, not one per pull request: the table is a history, so the Why
 * Timeline can show what changed between two generations of the same PR's brief.
 * `state_key` is the SHA-256 of the fully assembled, fully trimmed model input, so
 * an unchanged input upserts the row it already wrote instead of adding a second.
 */
export const prBrief = pgTable(
  'pr_brief',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** SHA-256 of the assembled+trimmed model input. The cache key AND the upsert target. */
    stateKey: text('state_key').notNull(),
    /** The commit the brief was generated at — reported, never acted on. */
    headSha: text('head_sha').notNull(),
    /**
     * Table-wide `serial`, NOT a timestamp and NOT a per-PR counter. `defaultNow()` is
     * the TRANSACTION's timestamp, so two rows written together tie to the microsecond
     * and "latest" becomes planner order. The sequence allocates outside the transaction,
     * so two rows written together get strictly increasing values with no read-modify-write
     * race. Per-PR numbering (1·2·3 on the card) is derived in code from the ordered list.
     */
    seq: serial('seq').notNull(),
    json: jsonb('json').notNull(),
    /**
     * NOT the `now()` helper: that one is hardcoded to a column literally named
     * `created_at`, and this row is upserted in place on an unchanged `state_key`, so
     * the honest name is when the brief was last GENERATED.
     */
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uq: uniqueIndex('pr_brief_pr_state_uq').on(t.prId, t.stateKey),
    seqIdx: index('pr_brief_pr_seq_idx').on(t.prId, t.seq), // timeline read + the 20-row cap
  }),
);
