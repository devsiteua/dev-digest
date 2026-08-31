import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/**
 * What a case asserts about the model's output.
 *
 * `must_find` came from an ACCEPTED finding — the agent is expected to report
 * something on that range. `must_not_flag` came from a DISMISSED one — reporting
 * there is the failure. A finding with neither decision has nothing to assert and
 * cannot become a case.
 *
 * No field here carries `.default()`, deliberately. `expected_output` and
 * `input_meta` are persisted JSON, which normally obliges a default (see
 * `server/INSIGHTS.md`, 2026-08-29: a drifted snapshot 500s on `.parse()`) — but
 * both eval tables have zero rows in every environment, so there is no legacy row
 * to protect, while a `.default()` would make the key REQUIRED on `z.infer` and
 * therefore on the seed literal that writes the first ones. A field added LATER
 * re-applies that rule rather than copying this exemption.
 */
export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

/** A file plus a line range — matching is file equality and range overlap, nothing else. */
export const EvalExpectation = z.object({
  kind: EvalExpectationKind,
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * Where a case came from. Provenance only — a case keeps NO foreign key to the
 * finding or the PR, so deleting either leaves the case intact.
 */
export const EvalCaseMeta = z.object({
  source_finding_id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  created_from: z.literal('finding'),
});
export type EvalCaseMeta = z.infer<typeof EvalCaseMeta>;

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: EvalCaseMeta.nullish(),
  expected_output: EvalExpectation,
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/**
 * Request body for `POST /eval-cases` — turn ONE decided finding into a case.
 *
 * Only the finding id: the owner, the expectation and the frozen diff are all
 * DERIVED server-side. A body that let a caller supply the expectation would let
 * two cases claim the same provenance and disagree about what it asserts.
 */
export const EvalCaseFromFindingInput = z.object({
  finding_id: z.string().uuid(),
});
export type EvalCaseFromFindingInput = z.infer<typeof EvalCaseFromFindingInput>;

/** Per-case outcome of one execution. `errored` threw; `failed` ran and missed. */
export const EvalRunStatus = z.enum(['passed', 'failed', 'errored']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  batch_id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  status: EvalRunStatus,
  error: z.string().nullable(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  /** The numerator and denominator behind `recall`, so a row is readable alone. */
  matched_count: z.number().int().nullable(),
  expected_count: z.number().int().nullable(),
  /**
   * How many findings the run reported for this case — descriptive, and
   * `citation_accuracy`'s denominator. NOT `precision`'s: that is
   * `precision_denominator` below.
   *
   * Derived from the stored `actual_output`, not a column: the review was already
   * persisted whole, so this needs no migration. It exists because a ratio whose
   * denominator is 0 is stored as `1` (the contract cannot carry `null`), and a
   * screen with no way to tell that `1` from a real 100% prints a number nobody
   * measured. `citation_accuracy` has no denominator of its own on the row — its
   * drop lists are not persisted — so it is guarded by this one, which is
   * conservative in the safe direction: it can show a dash where a real value
   * exists, never a fabricated percentage.
   */
  reported_count: z.number().int().nullable(),
  /**
   * `precision`'s denominator for this row: findings that landed on one of the
   * set's expectations, right or wrong. `reported_count` above is every finding
   * the agent produced and is descriptive only — most of a whole-PR diff is
   * unjudged, and charging it to precision measures how talkative the model is.
   */
  precision_denominator: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/**
 * `partial` is a batch that finished with at least one case errored — it has real
 * metrics over the cases that ran, and `cases_ran < cases_total` says so.
 */
export const EvalRunBatchStatus = z.enum(['running', 'done', 'partial', 'failed']);
export type EvalRunBatchStatus = z.infer<typeof EvalRunBatchStatus>;

/**
 * One execution of a whole case set, with the prompt it ran under frozen into it.
 *
 * Every ratio ships with its denominator. Two runs over different set sizes are
 * only comparable when the reader can see what each percentage was computed over,
 * and a denominator of 0 is what the UI renders as `-` instead of a rounded 1.
 */
export const EvalRunBatch = z.object({
  id: z.string(),
  workspace_id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  system_prompt_snapshot: z.string(),
  model_snapshot: z.string(),
  provider_snapshot: z.string(),
  status: EvalRunBatchStatus,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  recall_denominator: z.number().int(),
  precision_denominator: z.number().int(),
  citation_denominator: z.number().int(),
  cases_total: z.number().int(),
  cases_ran: z.number().int(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
});
export type EvalRunBatch = z.infer<typeof EvalRunBatch>;

/** A batch plus every per-case row it produced. */
export const EvalRunBatchDetail = z.object({
  batch: EvalRunBatch,
  runs: z.array(EvalRunRecord),
});
export type EvalRunBatchDetail = z.infer<typeof EvalRunBatchDetail>;

/**
 * A case's state in one batch. `absent` means the case was not in that batch's set
 * at all — the only honest answer when two runs cover different sets — and
 * `skipped` means it was in the set but never ran (the batch is `partial`).
 */
export const EvalCaseOutcome = z.enum(['pass', 'fail', 'absent', 'skipped']);
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;

/** Two batches side by side, and every case whose state differs between them. */
export const EvalRunComparison = z.object({
  a: EvalRunBatch,
  b: EvalRunBatch,
  cases: z.array(
    z.object({
      case_id: z.string(),
      name: z.string(),
      before: EvalCaseOutcome,
      after: EvalCaseOutcome,
    }),
  ),
});
export type EvalRunComparison = z.infer<typeof EvalRunComparison>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    /**
     * Each metric's OWN denominator, and not one shared count.
     *
     * `traces_total` below is the number of per-case rows that ran; it is not
     * the denominator of any of the three ratios and must never be used as one.
     * A set built only from dismissed findings asserts no `must_find`
     * expectation at all, so `recall_denominator` is 0 while `traces_total` is
     * the size of the set — and a screen that guards on the wrong one prints
     * the vacuous `1` as a confident 100%, which is the single failure this
     * whole feature exists to remove one level up.
     */
    recall_denominator: z.number().int(),
    precision_denominator: z.number().int(),
    citation_denominator: z.number().int(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
