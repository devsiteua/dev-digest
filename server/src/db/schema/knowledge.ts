import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  vector,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * House rules the extractor found in a repo, each pinned to the lines that
 * prove it. Every column is NOT NULL except `skill_id`: a candidate without
 * evidence is not a candidate — the extractor discards it rather than storing
 * it — so nullable evidence columns would only ever have meant "we lost it".
 * Safe to tighten because the table has been empty since `0000_init.sql` and
 * nothing reads or writes it yet.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    rule: text('rule').notNull(),
    /** Free-form theme coined by the model: naming, error-handling, imports, … */
    category: text('category').notNull(),
    evidencePath: text('evidence_path').notNull(),
    /** Re-read from the file in the clone, NOT taken from the model's answer. */
    evidenceSnippet: text('evidence_snippet').notNull(),
    evidenceStartLine: integer('evidence_start_line').notNull(),
    evidenceEndLine: integer('evidence_end_line').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    // Replaces the original `accepted boolean`, which conflated "not reviewed
    // yet" with "reviewed and refused". Plain `text` with no CHECK — the enum
    // narrows TypeScript only, same as `skills.source`. Mirrors
    // `ConventionStatus` in @devdigest/shared.
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    // The merged skill this candidate went into. Nullable, and `set null` on
    // purpose: deleting the skill un-files the candidates, it does not delete
    // the evidence they carry.
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    createdAt: now(),
  },
  (t) => ({ wsRepoIdx: index('conventions_ws_repo_idx').on(t.workspaceId, t.repoId) }),
);
