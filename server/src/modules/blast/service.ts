import type { BlastExplainResponse, BlastRadiusResponse, ChangedSymbol } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { BlastRepository } from './repository.js';
import {
  BLAST_EXPLAIN_MODEL,
  BLAST_EXPLAIN_SYSTEM_PROMPT,
  BLAST_EXPLAIN_TIMEOUT_MS,
  DOWNSTREAM_HOPS_BEYOND_CALLERS,
} from './constants.js';
import {
  BlastExplainReplySchema,
  buildDownstream,
  buildExplainPrompt,
  decideBlastState,
  describeBlast,
  groupCallersBySymbol,
  orderSymbols,
  type BlastDependentInput,
  type BlastFacts,
  type BlastIndexStatus,
} from './helpers.js';

/**
 * The Blast Radius — what a pull request's diff can reach, read from the
 * pre-built index and from nothing else.
 *
 * **No path reachable from here parses the repository.** That is the difference
 * between this feature and the facade's `getBlastRadius`, which falls back to a
 * ripgrep pass over the clone and re-reads clone files to find endpoints:
 * `getBlastRadiusFromIndex` returns `null` instead, and `null` is rendered as a
 * degraded state with a reason rather than paid for with a parse. It costs no
 * model call either, and an integration test proves that by serving the route
 * with providers that throw on every method.
 *
 * No SQL and no Fastify below this line: the repository is built from
 * `container.db` the way `SmartDiffService` builds its own, the index arrives
 * through `container.repoIntel`, and the PR is resolved through
 * `container.reviewRepo` so tenancy is checked by the one query in this
 * codebase that is workspace-scoped for pull requests.
 */
/**
 * The verb set `Container` brokers, and what a test stands in for.
 *
 * A `Pick<>` over the class rather than the class itself, for the reason
 * `IntentApi` (`intent/service.ts`) and `ProjectContextApi` (`context/service.ts`)
 * both give: a class with private fields can only ever be satisfied by itself,
 * so typing the override as `BlastService` would make it un-overridable.
 */
export type BlastApi = Pick<BlastService, 'forPull' | 'explain'>;

export class BlastService {
  private repo: BlastRepository;

  constructor(private container: Container) {
    this.repo = new BlastRepository(container.db);
  }

  /**
   * The whole map for one pull request, and — when there is no map — which of
   * the six honest answers it is.
   *
   * A pull request that cannot be mapped is never a 404 and never an empty
   * array on its own: the only 404 here is "there is no such pull request".
   */
  async forPull(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // Independent reads: the index state does not depend on the PR's files and
    // is needed even when there are none — it carries the sha every answer is
    // reported against.
    const [files, state] = await Promise.all([
      this.repo.pathsForPr(prId),
      this.container.repoIntel.getIndexState(pull.repoId),
    ]);

    const indexed =
      files.length > 0
        ? await this.container.repoIntel.getBlastRadiusFromIndex(pull.repoId, files)
        : null;

    const symbols: ChangedSymbol[] = orderSymbols(
      (indexed?.changedSymbols ?? []).map((s) => ({
        name: s.name,
        file: s.file,
        kind: s.kind,
      })),
    );
    const callersBySymbol = groupCallersBySymbol(indexed?.callers ?? []);
    const dependentsBySymbol = await this.dependentsPerSymbol(pull.repoId, callersBySymbol);

    const downstream = buildDownstream({
      symbols,
      callersBySymbol,
      factsByFile: (indexed?.factsByFile ?? {}) as Readonly<Record<string, BlastFacts>>,
      dependentsBySymbol,
    });

    const blastState = decideBlastState({
      repoIntelEnabled: this.container.config.repoIntelEnabled,
      indexStatus: state.status as BlastIndexStatus,
      changedFileCount: files.length,
      indexAnswered: indexed !== null,
      symbolCount: symbols.length,
      callerCount: indexed?.callers.length ?? 0,
    });

    // Counted over the ASSEMBLED map, not over the facade's flat union: the two
    // differ wherever a test file was dropped as a source of facts, and the
    // number a reader is given has to be the number of things they can see.
    const endpointCount = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
    const cronCount = new Set(downstream.flatMap((d) => d.crons_affected)).size;
    const indexedSha = state.lastIndexedSha === '' ? null : state.lastIndexedSha;

    return {
      changed_symbols: symbols,
      downstream,
      summary: describeBlast({
        state: blastState,
        indexedSha,
        changedFileCount: files.length,
        symbolCount: symbols.length,
        callerCount: downstream.reduce((n, d) => n + d.callers.length, 0),
        endpointCount,
        cronCount,
      }),
      status: blastState.status,
      reason: blastState.reason,
      indexed_sha: indexedSha,
    };
  }

  /**
   * The same map, in one paragraph — the ONE model call this feature makes.
   *
   * Nodes and edges go IN. The model is handed the symbols, the call sites, the
   * routes and the jobs that were already computed, and its instruction forbids
   * naming anything else: it rephrases, it does not discover. That is what makes
   * the paragraph as trustworthy as the map beside it.
   *
   * Nothing is persisted. The map is the durable artefact and it is recomputed
   * from the index in milliseconds; a stored paragraph would only be a second
   * thing that can go stale behind it.
   *
   * A map with nothing in it is refused rather than explained. Paying a model to
   * write "there is nothing downstream" over a `degraded` map would be paying it
   * to dress up "we could not look" as a finding.
   */
  async explain(workspaceId: string, prId: string): Promise<BlastExplainResponse> {
    const map = await this.forPull(workspaceId, prId);
    if (map.status === 'degraded' || map.downstream.every((d) => d.callers.length === 0)) {
      // 409, not 422: the request is well-formed, the resource is simply not in
      // a state where there is anything to explain. The summary is carried
      // through so the client can say WHY without a second request.
      throw new AppError(
        'blast_not_explainable',
        `There is no blast map to explain yet. ${map.summary}`,
        409,
      );
    }

    const startedAt = Date.now();
    const choice = BLAST_EXPLAIN_MODEL;
    const llm = await this.container.llm(choice.provider);
    const reply = await llm.completeStructured({
      model: choice.model,
      schema: BlastExplainReplySchema,
      schemaName: 'BlastExplanation',
      messages: [
        { role: 'system', content: BLAST_EXPLAIN_SYSTEM_PROMPT },
        { role: 'user', content: buildExplainPrompt({ map }) },
      ],
      temperature: 0,
      timeoutMs: BLAST_EXPLAIN_TIMEOUT_MS,
    });

    return {
      explanation: reply.data.explanation.trim(),
      indexed_sha: map.indexed_sha,
      provider: choice.provider,
      model: choice.model,
      tokens_in: reply.tokensIn,
      tokens_out: reply.tokensOut,
      cost_usd: reply.costUsd,
      duration_ms: Date.now() - startedAt,
    };
  }

  /**
   * One reverse hop beyond each symbol's own callers.
   *
   * Seeded per SYMBOL and not once for the whole diff, because
   * `endpoints_affected` is a per-symbol field: one traversal from the changed
   * file would hand every symbol in the file the same list, and a reviewer would
   * be told a route is downstream of a function that nothing on that path calls.
   *
   * Memoised on the seed set, which is what keeps the query count off the symbol
   * count: symbols declared in one file are usually called from the same places,
   * so a diff with twenty symbols typically walks two or three distinct sets.
   */
  private async dependentsPerSymbol(
    repoId: string,
    callersBySymbol: ReadonlyMap<string, readonly { file: string }[]>,
  ): Promise<Map<string, BlastDependentInput[]>> {
    const bySymbol = new Map<string, BlastDependentInput[]>();
    const walked = new Map<string, BlastDependentInput[]>();

    for (const [symbol, callers] of callersBySymbol) {
      const seeds = [...new Set(callers.map((c) => c.file))].sort((a, b) => a.localeCompare(b));
      if (seeds.length === 0) continue;
      const key = seeds.join('\n');
      let rows = walked.get(key);
      if (!rows) {
        rows = await this.container.repoIntel.getDependents(
          repoId,
          seeds,
          DOWNSTREAM_HOPS_BEYOND_CALLERS,
        );
        walked.set(key, rows);
      }
      bySymbol.set(symbol, rows);
    }
    return bySymbol;
  }
}
