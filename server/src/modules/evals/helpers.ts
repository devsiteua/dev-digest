import type {
  EvalCase,
  EvalCaseOutcome,
  EvalExpectation,
  EvalOwnerKind,
  EvalRunBatch,
  EvalRunRecord,
  UnifiedDiff,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { EVAL_ERRORS, MAX_CASES_PER_RUN, MAX_INPUT_DIFF_CHARS } from './constants.js';

/**
 * Everything the eval pipeline DECIDES about a case, with no clock, no database
 * and no network.
 *
 * Two callers share this file on purpose: `db/seed.ts` writes the demo case set
 * and `service.ts` writes a user's case, and AC-11 asserts that a seeded case and
 * a created case built from the same PR are the SAME BYTES. One assembler is the
 * only way that can be true.
 */

/** The finding fields a decision is read from — `FindingRow` satisfies it structurally. */
export interface DecidableFinding {
  file: string;
  startLine: number;
  endLine: number;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

/**
 * Turn a DECIDED finding into the expectation a case asserts.
 *
 * An accepted finding is something the agent should keep finding (`must_find`);
 * a dismissed one is something it should stop reporting (`must_not_flag`). A
 * finding with neither decision carries no judgement to encode, so there is
 * nothing to assert and the call is refused — AC-03's server half, mirrored by
 * the disabled control on the card.
 *
 * `acceptedAt` wins when both are set: an accepted finding is a positive
 * statement about the code, and the pair can only arise from an accept following
 * a dismiss.
 */
export function expectationFromFinding(finding: DecidableFinding): EvalExpectation {
  const kind = finding.acceptedAt
    ? 'must_find'
    : finding.dismissedAt
      ? 'must_not_flag'
      : null;

  if (!kind) {
    throw new AppError(
      EVAL_ERRORS.notDecided,
      'This finding has not been accepted or dismissed yet, so there is no expectation to record. Decide it first.',
      409,
    );
  }

  return {
    kind,
    file: finding.file,
    start_line: finding.startLine,
    end_line: finding.endLine,
  };
}

/** One file's slice of a raw unified diff, keyed by the path it declares. */
interface DiffBlock {
  path: string;
  text: string;
}

/**
 * Split a raw unified diff at its `diff --git` boundaries.
 *
 * The path comes from the `+++ b/<path>` line when there is one and from the
 * `diff --git a/<p> b/<p>` header otherwise, which is the same order of
 * preference `parseUnifiedDiff` uses — so a block this function keeps is a block
 * that parser will read back.
 */
function diffBlocks(raw: string): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let current: string[] | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.join('\n');
    blocks.push({ path: pathOfBlock(current), text });
    current = null;
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  flush();

  return blocks.filter((b) => b.path.length > 0);
}

function pathOfBlock(lines: string[]): string {
  for (const line of lines) {
    if (!line.startsWith('+++ ')) continue;
    const p = line.slice(4).replace(/^b\//, '').trim();
    if (p && p !== '/dev/null') return p;
  }
  const header = lines[0] ?? '';
  const m = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
  return m?.[2]?.trim() ?? '';
}

/**
 * The frozen text of a case's input diff — byte-stable across two calls on the
 * same PR.
 *
 * It SORTS its files by path before emitting, and that sort is the whole point:
 * `ReviewRepository.getPrFiles` returns rows in planner order (no `orderBy`), so
 * `diffFromPrFiles` can hand two identical requests the same files in a different
 * sequence. Determinism has to be a property of THIS function rather than of a
 * query it does not own, or AC-11's byte-equality is luck.
 *
 * The per-file text is passed through unchanged, so the result parses back
 * through `parseUnifiedDiff` exactly as the original did.
 */
export function serializeDiff(diff: UnifiedDiff): string {
  const blocks = diffBlocks(diff.raw);
  const ordered = blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => {
      if (a.block.path < b.block.path) return -1;
      if (a.block.path > b.block.path) return 1;
      return a.index - b.index; // an explicit tiebreak, not a reliance on sort stability
    })
    .map((entry) => entry.block.text.replace(/\n+$/, ''));

  return ordered.join('\n');
}

/**
 * AC-06 — refuse an oversized snapshot instead of truncating it.
 *
 * Pure so the boundary can be pinned by a unit test in `verify:l06`; the service
 * calls it before it writes anything.
 */
export function assertInputDiffWithinLimit(serialized: string): void {
  if (serialized.length <= MAX_INPUT_DIFF_CHARS) return;
  throw new AppError(
    EVAL_ERRORS.diffTooLarge,
    `This pull request's diff is ${serialized.length} characters, over the ${MAX_INPUT_DIFF_CHARS}-character limit for a frozen eval case. It is refused rather than truncated: a shortened snapshot would measure a different case than its name claims.`,
    413,
  );
}

/**
 * The case fields the set selection reads. `EvalCaseRow` satisfies it structurally.
 *
 * The owner kind is the SHARED `EvalOwnerKind`, not an inline `'skill' | 'agent'`
 * union. Two reasons, and the second is the load-bearing one: the contract
 * already owns that vocabulary and re-declaring it inline is exactly the drift
 * root `CLAUDE.md` § Gotchas warns about — and AC-28's regression gate greps the
 * server tree for the literal `'skill'`, which cannot tell a type union from a
 * write. An inline union here would fire the gate that guards this very filter.
 */
export interface SelectableCase {
  ownerKind: EvalOwnerKind;
}

/**
 * The cases one batch will cover: agent-owned only, and never more than
 * `MAX_CASES_PER_RUN`.
 *
 * Skill-owned cases are filtered out rather than mis-attributed (AC-28) — nothing
 * in this stream writes one, and running an agent over a case owned by a skill
 * would put a number under the wrong name.
 *
 * The size limit REFUSES rather than truncates (AC-16): taking the first 50 would
 * make the denominator a function of row ordering, and a denominator nobody chose
 * is exactly what this feature exists to remove.
 */
export function caseSetForRun<T extends SelectableCase>(cases: T[]): T[] {
  const agentOwned = cases.filter((c) => c.ownerKind === 'agent');
  if (agentOwned.length > MAX_CASES_PER_RUN) {
    throw new AppError(
      EVAL_ERRORS.tooManyCases,
      `This agent has ${agentOwned.length} eval cases, over the ${MAX_CASES_PER_RUN}-case limit for one run. Delete cases until the set fits: a run that silently covered only the first ${MAX_CASES_PER_RUN} would report a metric over a set nobody chose.`,
      409,
    );
  }
  return agentOwned;
}

/** The `eval_cases` columns the DTO mapper reads. `EvalCaseRow` satisfies it. */
export interface EvalCaseRowLike {
  id: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string | null;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: unknown;
  notes: string | null;
}

/**
 * Row → DTO. The one place a persisted case becomes an API answer, so a column
 * rename cannot leak into a response shape.
 *
 * `input_diff` is coalesced to `''` because the column is nullable while the
 * contract's field is not — a case with no frozen input is a case that measures
 * nothing, and `null` on the wire would only move that decision to the client.
 */
export function toEvalCase(row: EvalCaseRowLike): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
  };
}

/** The `eval_run_batches` columns the DTO mapper reads. */
export interface EvalRunBatchRowLike {
  id: string;
  workspaceId: string;
  agentId: string;
  agentVersion: number;
  systemPromptSnapshot: string;
  modelSnapshot: string;
  providerSnapshot: string;
  status: 'running' | 'done' | 'partial' | 'failed';
  startedAt: Date;
  finishedAt: Date | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  recallDenominator: number;
  precisionDenominator: number;
  citationDenominator: number;
  casesTotal: number;
  casesRan: number;
  durationMs: number | null;
  costUsd: number | null;
  error: string | null;
}

/**
 * Row → DTO for a batch.
 *
 * Every ratio leaves with its denominator attached. That pairing is the contract
 * the screen relies on to render `—` instead of a rounded 100% on a metric that
 * was computed over nothing (AC-20 → AC-21) — dropping either half here would
 * move that decision to a place that can no longer make it.
 */
export function toEvalRunBatch(row: EvalRunBatchRowLike): EvalRunBatch {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    agent_id: row.agentId,
    agent_version: row.agentVersion,
    system_prompt_snapshot: row.systemPromptSnapshot,
    model_snapshot: row.modelSnapshot,
    provider_snapshot: row.providerSnapshot,
    status: row.status,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    recall_denominator: row.recallDenominator,
    precision_denominator: row.precisionDenominator,
    citation_denominator: row.citationDenominator,
    cases_total: row.casesTotal,
    cases_ran: row.casesRan,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    error: row.error,
  };
}

/** The `eval_runs` columns the DTO mapper reads, plus the joined case name. */
export interface EvalRunRowLike {
  id: string;
  batchId: string;
  caseId: string;
  caseName?: string | null;
  ranAt: Date;
  actualOutput: unknown;
  status: 'passed' | 'failed' | 'errored';
  error: string | null;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  matchedCount: number | null;
  expectedCount: number | null;
  durationMs: number | null;
  costUsd: number | null;
}

/**
 * How many findings a stored review reported, or `null` when the row cannot say.
 *
 * `actual_output` holds the whole `review` the executor wrote, so the count is
 * already on disk and needs no column. Defensive about the shape because the
 * column is `jsonb` and an older or hand-edited row is not this code's to trust.
 */
function reportedCountOf(actualOutput: unknown): number | null {
  if (actualOutput === null || typeof actualOutput !== 'object') return null;
  const findings = (actualOutput as { findings?: unknown }).findings;
  return Array.isArray(findings) ? findings.length : null;
}

/** Row → DTO for one case's execution. */
export function toEvalRunRecord(row: EvalRunRowLike): EvalRunRecord {
  return {
    id: row.id,
    batch_id: row.batchId,
    case_id: row.caseId,
    case_name: row.caseName ?? null,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    status: row.status,
    error: row.error,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    matched_count: row.matchedCount,
    expected_count: row.expectedCount,
    reported_count: reportedCountOf(row.actualOutput),
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

/** A batch has reached a terminal status when it will not change again. */
const TERMINAL_BATCH = new Set(['done', 'partial', 'failed']);

/**
 * The newest and second-newest TERMINAL batch of each agent.
 *
 * `batches` must already be ordered newest-first — the repository sorts by
 * `(started_at desc, id desc)`, and the second key is not decoration:
 * `defaultNow()` is the transaction's timestamp, so two batches opened together
 * tie to the microsecond and "newest" would otherwise be planner order.
 *
 * A `running` batch is skipped rather than shown: its metrics are null, and a
 * dashboard that let a half-finished run replace the last complete one would
 * report a drop that never happened.
 */
export function latestTwoPerAgent<T extends { agentId: string; status: string }>(
  batches: T[],
): { current: T[]; previous: T[] } {
  const seen = new Map<string, T[]>();
  for (const b of batches) {
    if (!TERMINAL_BATCH.has(b.status)) continue;
    const list = seen.get(b.agentId) ?? [];
    if (list.length < 2) list.push(b);
    seen.set(b.agentId, list);
  }
  const current: T[] = [];
  const previous: T[] = [];
  for (const list of seen.values()) {
    if (list[0]) current.push(list[0]);
    if (list[1]) previous.push(list[1]);
  }
  return { current, previous };
}

/** A workspace-level metric with the denominator it was aggregated over. */
export interface AggregateMetrics {
  recall: number;
  precision: number;
  citationAccuracy: number;
  recallDenominator: number;
  precisionDenominator: number;
  citationDenominator: number;
  costUsd: number | null;
}

/**
 * Roll several batches up into one set of numbers.
 *
 * By re-deriving each numerator from `ratio × denominator` and summing BOTH
 * sides — never by averaging the ratios. A mean of percentages weights a
 * two-case agent the same as a fifty-case one, which is the arithmetic that
 * makes a dashboard disagree with every screen underneath it.
 */
export function aggregateMetrics(
  batches: {
    recall: number | null;
    precision: number | null;
    citationAccuracy: number | null;
    recallDenominator: number;
    precisionDenominator: number;
    citationDenominator: number;
    costUsd: number | null;
  }[],
): AggregateMetrics {
  let rN = 0;
  let rD = 0;
  let pN = 0;
  let pD = 0;
  let cN = 0;
  let cD = 0;
  let cost: number | null = null;

  for (const b of batches) {
    rN += (b.recall ?? 0) * b.recallDenominator;
    rD += b.recallDenominator;
    pN += (b.precision ?? 0) * b.precisionDenominator;
    pD += b.precisionDenominator;
    cN += (b.citationAccuracy ?? 0) * b.citationDenominator;
    cD += b.citationDenominator;
    if (b.costUsd != null) cost = (cost ?? 0) + b.costUsd;
  }

  return {
    recall: rD === 0 ? 1 : rN / rD,
    precision: pD === 0 ? 1 : pN / pD,
    citationAccuracy: cD === 0 ? 1 : cN / cD,
    recallDenominator: rD,
    precisionDenominator: pD,
    citationDenominator: cD,
    costUsd: cost,
  };
}

/**
 * A case's state inside one batch.
 *
 * `errored` becomes `skipped`, not `fail`: the case was in the set and produced
 * no measurement, and reporting it as a failure would blame the agent for a
 * provider that stalled. A case with no row at all in that batch is `absent` —
 * it was not in that run's set, which is the only honest answer when two runs
 * cover different sets (AC-24, AC-25).
 */
export function outcomeOf(status: 'passed' | 'failed' | 'errored' | undefined): EvalCaseOutcome {
  if (status === 'passed') return 'pass';
  if (status === 'failed') return 'fail';
  if (status === 'errored') return 'skipped';
  return 'absent';
}
