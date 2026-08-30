import type { EvalExpectation } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import { parseUnifiedDiff } from '../../adapters/index.js';
import type { EvalCaseRow, EvalsRepository } from './repository.js';
import { type CaseScore, type GroundingCounts, scoreBatch, scoreCase } from './scoring.js';

/**
 * Runs one batch: the agent, over its frozen case set, in the background.
 *
 * Three decisions worth naming, because each is a different failure the design
 * is built to survive:
 *
 *  - **A case that throws does not fail the run.** It is written as `errored` and
 *    the batch finishes `partial` with `cases_ran < cases_total`. A provider that
 *    stalls one call out of eight is the normal weather here, and a run that
 *    threw away seven good measurements because of it would be useless (AC-14).
 *  - **The batch is not held on an HTTP request.** The route inserts it and
 *    returns immediately; a real eight-case run is minutes, not seconds (AC-15).
 *  - **The agent's OWN model and provider run**, resolved from `container`. A
 *    cheaper pinned model would make every number a measurement of a
 *    configuration nobody uses.
 */
export class EvalRunExecutor {
  constructor(
    private container: Container,
    private repo: EvalsRepository,
  ) {}

  /**
   * Execute a batch to a terminal status. NOT awaited by the route; it owns its
   * own error handling, and a throw escaping it would be an unhandled rejection.
   */
  async run(batchId: string, agent: AgentRow, cases: EvalCaseRow[]): Promise<void> {
    const started = Date.now();
    const scores: CaseScore[] = [];
    const grounding: GroundingCounts[] = [];
    let ran = 0;
    let errored = 0;
    let cost = 0;

    const llm = await this.container.llm(agent.provider);

    for (const evalCase of cases) {
      const caseStart = Date.now();
      try {
        const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');
        const outcome = await reviewPullRequest({
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          diff,
          llm,
          strategy: agent.strategy ?? 'single-pass',
          sessionId: `eval:${batchId}:${evalCase.id}`,
        });

        const expectation = evalCase.expectedOutput as EvalExpectation;
        const score = scoreCase(expectation, outcome.review.findings);
        const counts: GroundingCounts = {
          findings: outcome.review.findings,
          dropped: outcome.dropped,
          scopeDropped: outcome.scopeDropped,
        };
        scores.push(score);
        grounding.push(counts);
        ran += 1;
        cost += outcome.costUsd ?? 0;

        // The per-case row carries its OWN three ratios, so a reader of the
        // comparison list can see which case moved without re-deriving it.
        const single = scoreBatch([score], [counts]);
        await this.repo.insertRun({
          batchId,
          caseId: evalCase.id,
          status: score.pass ? 'passed' : 'failed',
          actualOutput: outcome.review,
          pass: score.pass,
          recall: single.recall.value,
          precision: single.precision.value,
          citationAccuracy: single.citationAccuracy.value,
          matchedCount: score.matchedCount,
          expectedCount: score.expectedCount,
          durationMs: Date.now() - caseStart,
          costUsd: outcome.costUsd ?? null,
        });
      } catch (err) {
        // AC-14 — the case fails, the run does not. Nothing from a case that
        // threw enters any denominator: it produced no measurement, and counting
        // it as a miss would report the provider's outage as the agent's recall.
        errored += 1;
        await this.repo
          .insertRun({
            batchId,
            caseId: evalCase.id,
            status: 'errored',
            error: (err as Error).message,
            pass: null,
            durationMs: Date.now() - caseStart,
          })
          .catch(() => undefined);
      }
    }

    const totals = scoreBatch(scores, grounding);
    await this.repo.updateBatch(batchId, agent.workspaceId, {
      status: errored === 0 ? 'done' : ran === 0 ? 'failed' : 'partial',
      finishedAt: new Date(),
      recall: totals.recall.value,
      precision: totals.precision.value,
      citationAccuracy: totals.citationAccuracy.value,
      recallDenominator: totals.recall.denominator,
      precisionDenominator: totals.precision.denominator,
      citationDenominator: totals.citationAccuracy.denominator,
      casesRan: ran,
      durationMs: Date.now() - started,
      costUsd: cost,
    });
  }

  /**
   * Mark a batch failed outright — used when the executor itself could not
   * start (an unresolvable provider, say). Without this a crash before the first
   * case would leave the row `running` forever, and the partial unique index
   * would then refuse every later run for that agent.
   */
  async fail(batchId: string, workspaceId: string, message: string): Promise<void> {
    await this.repo
      .updateBatch(batchId, workspaceId, {
        status: 'failed',
        finishedAt: new Date(),
        error: message,
      })
      .catch(() => undefined);
  }
}
