import type {
  EvalCase,
  EvalCaseMeta,
  EvalDashboard,
  EvalRunBatch,
  EvalRunBatchDetail,
  EvalRunComparison,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { EVAL_ERRORS } from './constants.js';
import {
  aggregateMetrics,
  assertInputDiffWithinLimit,
  caseSetForRun,
  latestTwoPerAgent,
  outcomeOf,
  expectationFromFinding,
  serializeDiff,
  toEvalCase,
  toEvalRunBatch,
  toEvalRunRecord,
} from './helpers.js';
import type { EvalsRepository } from './repository.js';
import { EvalRunExecutor } from './run-executor.js';

/**
 * Eval cases — turning a judgement a human already made into something the
 * pipeline can measure against.
 *
 * **The 422 exception, drawn deliberately.** `server/CLAUDE.md` says invalid
 * input is rejected with 422 before the handler runs, and that stays true of the
 * body SHAPE: `EvalCaseFromFindingInput` is a route schema and it answers 422.
 * But three of this module's rejections are not about shape at all — the finding
 * is undecided (409), its review names no agent (409), the frozen diff is too
 * large (413) — and a Zod route schema has no vocabulary for any of them. Each is
 * thrown from HERE as an `AppError(code, message, statusCode)`, which `app.ts`
 * forwards with its status. The exception is documented in `routes.ts`, in this
 * comment and in the plan; sibling routes keep ordinary validation, so the 422
 * convention does not quietly become "throw whatever is convenient".
 *
 * **Nothing is written before every refusal has been made.** The oversize check
 * and the owner check both run ahead of the insert, so a refused call leaves the
 * table exactly as it found it.
 */

/**
 * What the delivery layer and `ContainerOverrides` see. A `Pick` rather than the
 * class, for the reason `ProjectContextApi` is one: a class with private fields
 * can only ever be satisfied by itself, which is not an override.
 */
export type EvalsApi = Pick<
  EvalsService,
  | 'createCaseFromFinding'
  | 'listCasesForAgent'
  | 'deleteCase'
  | 'startRun'
  | 'getBatch'
  | 'listBatchesForAgent'
  | 'dashboard'
  | 'compare'
  | 'reapStaleBatches'
>;

export class EvalsService {
  constructor(
    private container: Container,
    private repo: EvalsRepository,
  ) {}

  /**
   * Freeze one decided finding into a case (AC-02, AC-04, AC-05, AC-06, AC-30).
   *
   * The order of the checks is the contract: owner, then existing case, then
   * expectation, then size, then write.
   */
  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalCase> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.review.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    // AC-30. `reviews.agent_id` is nullable while `eval_cases.owner_id` is NOT
    // NULL, so a review written before any agent existed can produce a finding
    // with nobody to own the case it would become. Refused by name, before any
    // write, rather than resolved by inventing an owner.
    if (!review.agentId) {
      throw new AppError(
        EVAL_ERRORS.noOwner,
        'The review this finding belongs to was not produced by an agent, so there is no agent to own an eval case. Re-run the review with an agent first.',
        409,
      );
    }

    // AC-04 — the same finding never yields a second case. Returning the
    // existing one rather than erroring keeps the control on the card idempotent:
    // a double click is not a failure, it is the same answer twice.
    const existing = await this.repo.findBySourceFinding(workspaceId, findingId);
    if (existing) return toEvalCase(existing);

    // AC-02 / AC-03's server half — throws when the finding carries no decision.
    const expectation = expectationFromFinding(finding);

    // AC-05 — the WHOLE pull request's diff, frozen. Not the finding's file and
    // not its hunk: a reviewer that only ever saw the lines it was expected to
    // flag would score perfectly on a case that measures nothing.
    const diff = await this.container.loadPrDiff(workspaceId, pull.id);
    if (!diff) throw new NotFoundError('Pull request not found');
    const inputDiff = serializeDiff(diff);

    // AC-06 — refuse, never truncate, and refuse before writing anything.
    assertInputDiffWithinLimit(inputDiff);

    const meta: EvalCaseMeta = {
      source_finding_id: finding.id,
      pr_id: pull.id,
      pr_number: pull.number,
      created_from: 'finding',
    };

    const row = await this.repo.insert({
      workspaceId,
      ownerKind: 'agent',
      ownerId: review.agentId,
      name: finding.title,
      inputDiff,
      inputMeta: meta,
      expectedOutput: expectation,
    });
    return toEvalCase(row);
  }

  /** One agent's case set. 404s on an agent that is not in this workspace. */
  async listCasesForAgent(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const agent = await this.repo.getAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await this.repo.listByOwner(workspaceId, agentId);
    return rows.map(toEvalCase);
  }

  /** Delete a case. Its `eval_runs` rows cascade with it (AC-08). */
  async deleteCase(workspaceId: string, caseId: string): Promise<void> {
    const removed = await this.repo.remove(workspaceId, caseId);
    if (!removed) throw new NotFoundError('Eval case not found');
  }

  // ---- runs ---------------------------------------------------------------

  /**
   * Open a batch over an agent's whole case set and return it IMMEDIATELY
   * (AC-10, AC-13, AC-15, AC-16, AC-28).
   *
   * The prompt, provider, model and version are read HERE, at run start, and
   * frozen into the row — the question the comparison screen answers is "which
   * edit moved this", and it cannot be answered from whatever the agent looks
   * like when the results are read.
   *
   * Execution is fire-and-forget (`void … .catch(…)`), the shape
   * `modules/reviews/service.ts` already uses. A real eight-case run is minutes,
   * so holding it on the request would time out in front of the user and lose
   * every measurement that had already been taken.
   */
  async startRun(workspaceId: string, agentId: string): Promise<EvalRunBatch> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // AC-28 + AC-16 — agent-owned cases only, and a refusal rather than a
    // silent truncation above the limit.
    const all = await this.repo.listByOwner(workspaceId, agentId);
    const cases = caseSetForRun(all);

    let batch;
    try {
      batch = await this.repo.insertBatch({
        workspaceId,
        agentId,
        agentVersion: agent.version,
        systemPromptSnapshot: agent.systemPrompt,
        modelSnapshot: agent.model,
        providerSnapshot: agent.provider,
        casesTotal: cases.length,
      });
    } catch (err) {
      // AC-13. The partial unique index on `(agent_id) where status = 'running'`
      // is the arbiter, not a SELECT in this method: a check-then-insert would
      // let two requests a millisecond apart both see "no run in flight". The
      // second request LOSES THE INSERT, and that is what is reported — never
      // queued, because a queued second run would silently measure a prompt the
      // user has since edited.
      if (isUniqueViolation(err)) {
        throw new AppError(
          EVAL_ERRORS.runInFlight,
          `${agent.name} already has an eval run in flight. Wait for it to finish before starting another — two runs at once would report metrics for two different moments under one name.`,
          409,
        );
      }
      throw err;
    }

    const executor = new EvalRunExecutor(this.container, this.repo);
    void executor
      .run(batch.id, agent, cases)
      .catch((err: unknown) => executor.fail(batch.id, workspaceId, (err as Error).message));

    return toEvalRunBatch(batch);
  }

  /** One batch with every per-case row it produced — AC-15's state read. */
  async getBatch(workspaceId: string, batchId: string): Promise<EvalRunBatchDetail> {
    const batch = await this.repo.getBatch(workspaceId, batchId);
    if (!batch) throw new NotFoundError('Eval run not found');
    const runs = await this.repo.listRunsForBatches(workspaceId, [batch.id]);
    return { batch: toEvalRunBatch(batch), runs: runs.map(toEvalRunRecord) };
  }

  /** One agent's run history, newest first. */
  async listBatchesForAgent(workspaceId: string, agentId: string): Promise<EvalRunBatch[]> {
    const agent = await this.repo.getAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await this.repo.listBatchesForAgent(workspaceId, agentId);
    return rows.map(toEvalRunBatch);
  }

  // ---- reads for the screens ---------------------------------------------

  /**
   * The workspace's eval dashboard (AC-21's data half, AC-23).
   *
   * `current` is the newest TERMINAL batch of every agent, rolled up by summing
   * numerators and denominators — not by averaging ratios, which would weight a
   * two-case agent like a fifty-case one. `delta` is the same roll-up over each
   * agent's previous batch.
   *
   * `trend` and `alert` are deliberately `[]` and `null`. They are the trend
   * chart and the regression banner the design draws and this spec puts in
   * `Out of scope` — the field is a later stream's slot, kept on the wire so
   * adding it is not a contract change. This is not an oversight, and a reader
   * should not "fix" it by inventing a series.
   */
  async dashboard(workspaceId: string): Promise<EvalDashboard> {
    const batches = await this.repo.listBatchesForWorkspace(workspaceId);
    const { current, previous } = latestTwoPerAgent(batches);

    const now = aggregateMetrics(current);
    const before = aggregateMetrics(previous);

    const runs = await this.repo.listRunsForBatches(
      workspaceId,
      current.map((b) => b.id),
    );
    const ran = runs.filter((r) => r.status !== 'errored');

    return {
      owner_kind: null,
      owner_id: null,
      cases_total: await this.repo.countForWorkspace(workspaceId),
      current: {
        recall: now.recall,
        precision: now.precision,
        citation_accuracy: now.citationAccuracy,
        // Each ratio's own denominator. `traces_total` below counts rows that
        // ran and is NOT interchangeable with any of these: a set built only
        // from dismissed findings has `recall_denominator` 0 and a full
        // `traces_total`, and a screen guarding on the latter renders the
        // vacuous 1 as 100%.
        recall_denominator: now.recallDenominator,
        precision_denominator: now.precisionDenominator,
        citation_denominator: now.citationDenominator,
        traces_passed: ran.filter((r) => r.status === 'passed').length,
        traces_total: ran.length,
        cost_usd: now.costUsd,
      },
      delta: {
        // Zero rather than the current value when there is nothing to compare
        // against: a first run has not improved on anything.
        recall: previous.length === 0 ? 0 : now.recall - before.recall,
        precision: previous.length === 0 ? 0 : now.precision - before.precision,
        citation_accuracy:
          previous.length === 0 ? 0 : now.citationAccuracy - before.citationAccuracy,
      },
      trend: [],
      alert: null,
      // `listRunsForBatches` orders ASCENDING, because `getBatch` and `compare`
      // both want a stable chronological list. This field does not: it is named
      // `recent_runs` and slicing the head of an ascending read returns the
      // OLDEST rows. Reverse before slicing.
      recent_runs: runs
        .slice()
        .reverse()
        .slice(0, 20)
        .map(toEvalRunRecord),
    };
  }

  /**
   * Boot-time cleanup, called once from `app.ts` beside its review twin. See
   * `EvalsRepository.reapStaleBatches` for why a stuck row here is a lock rather
   * than a cosmetic defect.
   */
  async reapStaleBatches(): Promise<number> {
    return this.repo.reapStaleBatches();
  }

  /**
   * Two batches side by side, with every case whose state differs (AC-24, AC-25).
   *
   * Both batches ship WITH their denominators, because two runs over different
   * set sizes reduced to one percentage difference is the exact failure this
   * feature exists to remove one level up.
   */
  async compare(workspaceId: string, aId: string, bId: string): Promise<EvalRunComparison> {
    const a = await this.repo.getBatch(workspaceId, aId);
    const b = await this.repo.getBatch(workspaceId, bId);
    if (!a || !b) throw new NotFoundError('Eval run not found');

    const runs = await this.repo.listRunsForBatches(workspaceId, [a.id, b.id]);
    const byCase = new Map<string, { name: string; a?: EvalRunStatusValue; b?: EvalRunStatusValue }>();
    for (const r of runs) {
      const entry = byCase.get(r.caseId) ?? { name: r.caseName ?? 'Deleted case' };
      if (r.caseName) entry.name = r.caseName;
      if (r.batchId === a.id) entry.a = r.status;
      if (r.batchId === b.id) entry.b = r.status;
      byCase.set(r.caseId, entry);
    }

    return {
      a: toEvalRunBatch(a),
      b: toEvalRunBatch(b),
      cases: [...byCase.entries()]
        .map(([case_id, e]) => ({
          case_id,
          name: e.name,
          before: outcomeOf(e.a),
          after: outcomeOf(e.b),
        }))
        // Rows whose state CHANGED first: a list ordered by name buries the
        // three rows the experiment was run to see. Stable within each group.
        .sort((x, y) => {
          const moved = (r: { before: string; after: string }) => (r.before === r.after ? 1 : 0);
          return moved(x) - moved(y) || x.name.localeCompare(y.name);
        }),
    };
  }
}

/** The `eval_runs.status` values, named so the comparison map can hold one. */
type EvalRunStatusValue = 'passed' | 'failed' | 'errored';

/**
 * Is this Postgres's "duplicate key" (23505)?
 *
 * Matched on the SQLSTATE rather than the message: the message names the index
 * and would change under a rename, while the code is the same in every locale.
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
