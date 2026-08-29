import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

// Provenance of a skill's body — and, through that, whether the body is trusted.
// ONLY 'manual' means "authored here, in this workspace": its body goes into the
// prompt verbatim. Every other source is third-party text, so the server wraps it
// in `wrapUntrusted()` before it reaches the model (prompt-contract rule 3).
// The value is set by the server from the endpoint that created the row and is
// never accepted from a request body — otherwise a caller could claim 'manual'
// for imported text and opt out of the wrapping.
export const SkillSource = z.enum([
  'manual',
  'imported_file',
  'imported_url',
  'extracted',
  'community',
]);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// An immutable body snapshot from `skill_versions`, written on every save that
// changes `body`. Mirrors AgentVersion below. Kept so an eval run can be replayed
// against the exact text it scored.
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/** One agent this skill is attached to, for the editor's Stats tab. */
export const SkillUsage = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  /** The AGENT's switch, not the link's — a disabled agent never runs at all. */
  agent_enabled: z.boolean(),
});
export type SkillUsage = z.infer<typeof SkillUsage>;

/**
 * Usage numbers for one skill, returned by `GET /skills/:id/stats`.
 *
 * Read the attribution before reading the numbers. `findings` has no `skill_id`
 * — a finding is produced by an AGENT, whose prompt carried every skill linked
 * to it — so everything below `used_by` is measured over *the agents that use
 * this skill*, not over the skill. With two skills on one agent, both get the
 * same `findings`. Per-skill attribution needs the eval pipeline (L06), which is
 * why there is no `pull_frequency` here: the design shows one, and nothing
 * currently written down could compute it honestly.
 *
 * The window is `window_days` back from now; `used_by` is current membership and
 * is NOT windowed.
 */
export const SkillStats = z.object({
  used_by: z.array(SkillUsage),
  window_days: z.number().int(),
  /** Runs by those agents inside the window, any status. */
  runs: z.number().int(),
  findings: z.number().int(),
  accepted: z.number().int(),
  dismissed: z.number().int(),
  /** accepted / (accepted + dismissed). Null while nothing has been triaged. */
  accept_rate: z.number().nullable(),
  by_category: z.array(z.object({ category: z.string(), count: z.number().int() })),
});
export type SkillStats = z.infer<typeof SkillStats>;

/**
 * The parsed core of an imported skill, returned by `POST /skills/import/preview`.
 * The preview endpoint writes NOTHING — the user confirms (and may edit) this
 * draft, and only then does `POST /skills/import` persist it. That is what makes
 * "nothing is saved until you confirm" a property of the API rather than a UI habit.
 *
 * Deliberately has NO `source` and NO `enabled`: both are decided by the server
 * from the endpoint, so an imported body can never present itself as trusted.
 */
export const SkillDraft = z.object({
  // Bounded to exactly what `POST /skills/import` accepts. A draft the confirm
  // step would reject is worse than no draft: the failure lands after the user
  // has already reviewed and approved it.
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  type: SkillType,
  body: z.string(),
  /**
   * Archive entries that were NOT read: scripts, binaries, images, extra docs.
   * We list them so the user can see what an imported bundle contained beyond its
   * markdown core. Nothing here is parsed, written to disk, or executed — only the
   * entry names reach this array.
   */
  ignored_files: z.array(z.string()),
  /** Non-fatal notes about the parse, e.g. "no frontmatter — name taken from the first heading". */
  warnings: z.array(z.string()),
});
export type SkillDraft = z.infer<typeof SkillDraft>;

// ---- Conventions ----
/**
 * Where a candidate sits in the review loop. This replaces the original
 * `accepted: boolean`, which could not tell "nobody has looked at it yet" apart
 * from "somebody looked and said no" — two states the extractor screen has to
 * render differently, and two states a re-scan must treat differently (a
 * rejected rule should not come back as new).
 */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/**
 * One house rule the extractor believes it found, with the evidence that
 * grounds it.
 *
 * The evidence is NOT the model's word for it. `evidence_path` must be one of
 * the files the sampler picked, and `evidence_snippet` is re-read from that file
 * in the clone at `[evidence_start_line, evidence_end_line]` — so what the UI
 * shows as proof is what is actually on disk, not what the model wrote down.
 * That is also why the range is two integer fields rather than being baked into
 * the path as `src/api/users.ts:23-31`: code has to slice with it, and only the
 * UI ever renders it back as one string.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string(),
  rule: z.string(),
  /**
   * The theme of the rule — naming, error-handling, structure, imports, typing,
   * async, … Deliberately a free-form string and not an enum: the model coins
   * the label, and a closed list would silently drop a good rule whose category
   * we had not thought of. Grouping in the UI is by whatever came back.
   */
  category: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  evidence_start_line: z.number().int(),
  evidence_end_line: z.number().int(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  /** The merged skill this candidate ended up in, or null while it is in none. */
  skill_id: z.string().nullable(),
  created_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** A rule the model proposed and the evidence check threw away, with the reason. */
export const ConventionDiscard = z.object({
  rule: z.string(),
  reason: z.string(),
});
export type ConventionDiscard = z.infer<typeof ConventionDiscard>;

/**
 * The outcome of one extraction pass.
 *
 * `sampled_files` and `discarded` are not diagnostics — they are the answer to
 * "why is this list so short?". A pass that silently returned three candidates
 * out of twenty proposed rules reads as "the repo has three conventions"; naming
 * what was sampled and what failed grounding is what makes it readable as
 * "seventeen rules had no evidence in these files".
 */
export const ConventionExtractResult = z.object({
  candidates: z.array(ConventionCandidate),
  sampled_files: z.array(z.string()),
  discarded: z.array(ConventionDiscard),
});
export type ConventionExtractResult = z.infer<typeof ConventionExtractResult>;

/**
 * A partial edit of one candidate: fix the wording, re-file it under another
 * category, or move it through the accept/reject loop. Every field is optional
 * because the screen sends whichever one control the user touched.
 *
 * Evidence is NOT editable. It was verified against the file on disk, and a
 * hand-typed snippet would still be labelled "detected in" — so the only way to
 * change it is another extraction pass.
 */
export const ConventionUpdate = z.object({
  rule: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  status: ConventionStatus.optional(),
});
export type ConventionUpdate = z.infer<typeof ConventionUpdate>;

/**
 * Merge the accepted candidates of one repo into a single skill.
 *
 * Bounded to what `POST /skills` accepts, for the same reason `SkillDraft` is —
 * a body the skills layer would reject is worse than none, because the user has
 * already reviewed and approved it by then.
 *
 * Has NO `source` and no `id`: the server stamps `'extracted'` and fills
 * `evidence_files` from `convention_ids`. Accepting `source` from the body would
 * let a caller label generated text `'manual'` and skip the untrusted wrapping
 * the whole trust model rests on (see `SkillSource` above).
 */
export const ConventionSkillRequest = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  type: SkillType,
  enabled: z.boolean(),
  body: z.string().min(1),
  /** Which candidates were merged — they get stamped with the new skill's id. */
  convention_ids: z.array(z.string()).min(1),
});
export type ConventionSkillRequest = z.infer<typeof ConventionSkillRequest>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
  // Inject the repo's project-context documents into this agent's review
  // prompt (the `## Project context` slot). Default on; gated again by the
  // global PROJECT_CONTEXT_ENABLED flag.
  project_context: z.boolean().default(true),
  /**
   * How many skills are linked to this agent, counted server-side so the agent
   * cards can show it without one `GET /agents/:id/skills` per card. DERIVED —
   * it is not a column, nothing accepts it on a write, and it is deliberately
   * `.nullish()`: a producer that has no cheap way to count (a plugin export, a
   * fixture) omits the key rather than claiming zero, and "we did not count"
   * must stay distinguishable from "no skills attached".
   */
  skill_count: z.number().int().nullish(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel/
// project_context plus the ordered skill ids linked at snapshot time. Used for
// reproducibility (eval replays a past version) and for surfacing an agent's
// edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  // The snapshot of `Agent.project_context` — what the agent was set to when
  // this version was cut. Gated again at run time by PROJECT_CONTEXT_ENABLED,
  // which is config and therefore deliberately not part of the snapshot.
  //
  // `.default(true)` unlike its neighbours, and NOT cosmetic: `toAgentVersionDto`
  // runs `AgentVersionConfig.parse(row.configJson)` and throws on a malformed
  // snapshot rather than leak an unvalidated blob. Every row written before this
  // change has no `project_context` key, so a bare `z.boolean()` turns
  // `GET /agents/:id/versions` into a 500 on any database with history. Reading a
  // pre-existing snapshot as "on" is the reading `run-executor` already gives a
  // missing flag (`agent.repoIntel !== false`).
  project_context: z.boolean().default(true),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
