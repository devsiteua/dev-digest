import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

/**
 * What kind of change a PR is — a CLOSED taxonomy, not free text.
 *
 * The value is stored, rendered as a chip and read back by later lessons, and a
 * model that answers "refactor/cleanup" on one PR and "cleanup" on the next makes
 * all three impossible. `mixed` is deliberate rather than a dustbin: a PR that
 * genuinely does two things should be able to say so instead of being forced into
 * whichever half is larger, because "this PR is two PRs" is itself review-worthy.
 */
export const IntentKind = z.enum([
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
]);
export type IntentKind = z.infer<typeof IntentKind>;

/**
 * How much the derived intent is worth.
 *
 * NOT a model-reported probability. The tier is computed by code from WHICH
 * sources were actually found (`IntentSource` below): documentation the PR points
 * at outranks the PR's own prose, which outranks signals derived from the change
 * itself. The model may lower the tier it is given — "this body is a template with
 * nothing filled in" — and can never raise it.
 *
 * Three buckets rather than a percentage because that is the real resolution of
 * the evidence: there is no honest difference between 41% and 46% confidence when
 * the input is "a title and some file paths".
 */
export const IntentConfidenceTier = z.enum(['high', 'medium', 'low']);
export type IntentConfidenceTier = z.infer<typeof IntentConfidenceTier>;

/**
 * Where a derived intent's evidence came from, strongest first.
 *
 * `plan_file` and `linked_issue` are documentation the author pointed at
 * deliberately; the rest is inference. Persisted as a list so the card can show
 * WHY a tier is what it is — an unexplained "low" reads as a broken feature.
 *
 * Note what is absent: an arbitrary URL from the PR body is never a source. The
 * only reachable documents are this repo's clone and this repo's GitHub issues.
 */
export const IntentSource = z.enum([
  'plan_file',
  'linked_issue',
  'pr_body',
  'pr_title',
  'commits',
  'branch',
  'file_paths',
]);
export type IntentSource = z.infer<typeof IntentSource>;

/**
 * One quoted span behind a derived intent.
 *
 * `ref` locates it in a way the reader can check — a repo-relative path, `#471`,
 * a branch name — and `quote` is the short excerpt that justified the claim.
 * Evidence is what separates a derived intent from a plausible guess.
 */
export const IntentEvidence = z.object({
  source: IntentSource,
  ref: z.string(),
  quote: z.string(),
});
export type IntentEvidence = z.infer<typeof IntentEvidence>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
