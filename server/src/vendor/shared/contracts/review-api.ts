import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import {
  BlastRadius,
  Intent,
  IntentConfidenceTier,
  IntentEvidence,
  IntentKind,
  IntentSource,
  SmartDiff,
} from './brief.js';
import { Provider } from './knowledge.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/**
 * A derived intent as persisted and transported — `Intent` plus everything that
 * makes it auditable.
 *
 * `Intent` itself is left alone deliberately: it is a member of `PrBrief`, which
 * a later lesson owns, and the fields below describe THIS derivation rather than
 * what an intent is.
 *
 * Only `cost_usd` is nullish, and for the reason `RunStats.cost_usd` gives: null
 * means the model has no known price, which is a different fact from free. Every
 * other field is required, because a row is written by exactly one code path that
 * always knows all of them — an optional field here would only push a null check
 * into every reader for a case that cannot occur.
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  kind: IntentKind,
  /** `TIER_SCORE[confidence_tier]` — never an independent number. */
  confidence: z.number(),
  confidence_tier: IntentConfidenceTier,
  /** Which sources the derivation actually used, strongest first. */
  sources: z.array(IntentSource),
  evidence: z.array(IntentEvidence),
  /**
   * What the PR pointed at, or what a derivation expected, and could not be read
   * — an unreadable plan file, an issue the token cannot see, a description
   * nobody has synced yet.
   *
   * Kept as a FIELD rather than a log line because the brief asks for exactly
   * that: an unreachable link must not be silently replaced with invention. A
   * reader of a row — the card, the reviewing prompt, an audit — has to be able
   * to tell "the author explained nothing" from "the author explained it
   * somewhere we could not reach".
   */
  missing_context: z.array(z.string()),
  provider: Provider,
  model: z.string(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullish(),
  duration_ms: z.number().int(),
  /**
   * The commit this intent was derived at. A review reuses the row only while it
   * still matches the PR's head; once the head moves the intent is re-derived,
   * because scope claimed three force-pushes ago is not this PR's scope.
   */
  head_sha: z.string(),
  generated_at: z.string(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

/**
 * How much of a blast map to believe.
 *
 * `ok` does NOT mean "there is something to show" — an honest empty map is
 * `ok` with a reason. It means the index answered the question it was asked.
 */
export const BlastStatus = z.enum(['ok', 'partial', 'degraded']);
export type BlastStatus = z.infer<typeof BlastStatus>;

/**
 * Why a map looks the way it does — the field that keeps an empty array from
 * being read as "this pull request affects nothing".
 *
 * The first three go with `degraded` (no usable index), `index_partial` with
 * `partial`, and the last three with `ok`: nothing is wrong in those cases,
 * there is simply nothing downstream to draw, and each of them has a different
 * next step for the reader.
 */
export const BlastReason = z.enum([
  'index_missing',
  'index_failed',
  'repo_intel_disabled',
  'index_partial',
  'no_changed_files',
  'no_indexed_symbols',
  'no_callers',
]);
export type BlastReason = z.infer<typeof BlastReason>;

/**
 * Response of `GET /pulls/:id/blast` — the `BlastRadius` plus how far it is to
 * be trusted.
 *
 * `BlastRadius` itself is left alone deliberately, for the reason `Intent` is:
 * it is a member of `PrBrief`, which a later lesson owns, and the three fields
 * below describe THIS read rather than what a blast radius is.
 *
 * `indexed_sha` is the commit the map was computed against — the index's, never
 * the pull request's head. Every `file:line` in it was recorded at that commit
 * and is only guaranteed to point at the right line there, which is why the
 * links the UI builds are pinned to it.
 */
export const BlastRadiusResponse = BlastRadius.extend({
  status: BlastStatus,
  /** `null` only when `status` is `ok` and the map is populated. */
  reason: BlastReason.nullable(),
  /** `null` when the repository has never been indexed. */
  indexed_sha: z.string().nullable(),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;

/**
 * Response of `POST /pulls/:id/blast/explain` — the map already computed, put
 * into one paragraph by exactly one model call.
 *
 * Nothing is persisted, so there is no id and no `generated_at` row to point at:
 * the paragraph is a rendering of a map the caller already has, and the map is
 * what is durable. Its cost is reported for the same reason `PrIntentRecord`
 * reports its own — a call the user paid for has to be answerable about what it
 * cost — and `cost_usd` is nullable for the same reason too: null means the
 * model has no known price, which is a different fact from free.
 */
export const BlastExplainResponse = z.object({
  explanation: z.string(),
  /** The commit the explained map was computed against. */
  indexed_sha: z.string().nullable(),
  provider: Provider,
  model: z.string(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullish(),
  duration_ms: z.number().int(),
});
export type BlastExplainResponse = z.infer<typeof BlastExplainResponse>;

/**
 * Request of `POST /reviews/working` — review a diff with no pull request
 * behind it.
 *
 * The whole input is what `git diff` printed and which agent to run. There is
 * no repository id and no PR number, because there is no PR: this is the
 * uncommitted working tree of whoever ran the CLI.
 */
/**
 * How much diff `POST /reviews/working` will accept, in characters.
 *
 * The endpoint is the first one where a caller controls the whole body, and the
 * whole body is rendered into ONE prompt — `reviewer-core` truncates the PR
 * description and the intent, never the diff. Without a ceiling here the only
 * bound is Fastify's global `bodyLimit`, which is a transport default rather
 * than a promise this endpoint made, and the failure it produces (a bare 413,
 * ten times a minute, against a paid model) says nothing a caller can act on.
 *
 * 400k characters is roughly 100k tokens — already past what the reviewing
 * models here read well, so a diff above it would be reviewed badly rather than
 * expensively.
 */
export const MAX_WORKING_DIFF_CHARS = 400_000;

export const WorkingReviewRequest = z.object({
  /** The agent's name, its kebab-cased slug, or its id. */
  agent: z.string().min(1),
  /** A unified diff, exactly as `git diff` produced it. */
  diff: z
    .string()
    .min(1)
    .max(
      MAX_WORKING_DIFF_CHARS,
      `The diff is larger than ${MAX_WORKING_DIFF_CHARS} characters. Commit or stash part of the working tree and review the rest.`,
    ),
});
export type WorkingReviewRequest = z.infer<typeof WorkingReviewRequest>;

/**
 * Response of `POST /reviews/working`.
 *
 * `findings` are `Finding`s, not `FindingRecord`s, and that difference is the
 * feature: nothing is persisted, so there is no row id to accept or dismiss.
 * The review happened, was reported, and left no trace — which is what makes it
 * safe to run on a working tree on every save.
 *
 * SYNCHRONOUS, deliberately unlike its neighbour `POST /pulls/:id/review`. That
 * one is fire-and-forget and returns `reviews: []` on purpose, because a browser
 * subscribes to the run over SSE afterwards. A CLI has nothing to subscribe
 * with, and a fire-and-forget answer would leave it with nothing to print.
 */
export const WorkingReviewResponse = z.object({
  agent_name: z.string(),
  provider: Provider,
  model: z.string(),
  verdict: Verdict.nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  findings: z.array(Finding),
  /** How many findings count as blocking under this agent's `ci_fail_on`. */
  blocking: z.number().int(),
  /** How the grounding gate judged the model's citations. */
  grounding: z.string(),
  files_reviewed: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullish(),
  duration_ms: z.number().int(),
});
export type WorkingReviewResponse = z.infer<typeof WorkingReviewResponse>;
