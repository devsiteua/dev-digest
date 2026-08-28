import type { BlastRadiusResponse, ChangedSymbol } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { BlastRepository } from './repository.js';
import { DOWNSTREAM_HOPS_BEYOND_CALLERS } from './constants.js';
import {
  buildDownstream,
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
