import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BlastExplainResponse, BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * L04 — the Blast Radius.
 *   GET  /pulls/:id/blast         → what the diff reaches: symbols, callers, endpoints, crons
 *   POST /pulls/:id/blast/explain → that map, in one paragraph (the only model call)
 *
 * The GET carries no rate-limit override, on the same reasoning as
 * `GET /pulls/:id/smart-diff`: those caps exist where a held-down button is a
 * bill, and it spends nothing but indexed reads. The global 120/min limit still
 * applies. The POST does spend money and is capped accordingly.
 *
 * The service is taken from `Container` rather than constructed here. It used
 * to be constructed here, on the argument that nothing else consumed the blast
 * map so the container gained a dependency with one caller; the PR brief is the
 * second consumer, and that argument expired with it. `container.blast` is now
 * the single construction site, and a test can stand a stub in through
 * `ContainerOverrides.blast`.
 *
 * What has NOT changed is why brokering matters rather than being tidy:
 * `modules/brief/**` importing `modules/blast/service.js` directly would have
 * been caught by nobody. `no-cross-module-import` is the one rule in
 * `.dependency-cruiser-onion.cjs` with `severity: 'warn'`, and depcruise's exit
 * code counts errors only — so that import compiles, runs, and leaves
 * `pnpm arch:check` green.
 *
 * This module still imports NOTHING from `modules/repo-intel`:
 * `container.repoIntel` is typed, so the facade's return shapes arrive by
 * inference and the module declares its own DTOs.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = app.container.blast;

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadiusResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      const startedAt = Date.now();
      const blast = await service.forPull(workspaceId, req.params.id);

      // The line the "the main scenario makes no LLM call" criterion is read
      // against. `llmCalls: 0` is a literal on purpose: the day someone adds a
      // call on this path, this line becomes a lie a reviewer can catch by
      // reading one route.
      //
      // `status` and `reason` are logged beside the counts because a map of
      // zero is only interpretable next to the reason it is zero.
      req.log.info(
        {
          prId: req.params.id,
          symbols: blast.changed_symbols.length,
          callers: blast.downstream.reduce((n, d) => n + d.callers.length, 0),
          endpoints: new Set(blast.downstream.flatMap((d) => d.endpoints_affected)).size,
          crons: new Set(blast.downstream.flatMap((d) => d.crons_affected)).size,
          status: blast.status,
          reason: blast.reason,
          indexedSha: blast.indexed_sha,
          llmCalls: 0,
          durationMs: Date.now() - startedAt,
        },
        'blast radius served',
      );
      return blast;
    },
  );

  /**
   * The optional paragraph — the one and only model call this feature makes,
   * and it is a POST behind an explicit button for exactly that reason.
   *
   * Rate-limited on the same budget as `POST /pulls/:id/intent` and the
   * conventions scan: it spends money, so a held-down button is a bill.
   *
   * Synchronous, like the intent derivation and for the same reason: one call to
   * a cheap model, one step, and no partial output worth streaming.
   */
  app.post(
    '/pulls/:id/blast/explain',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<BlastExplainResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      const explained = await service.explain(workspaceId, req.params.id);

      // `llmCalls: 1` here against the `0` above is the pair the "the main
      // scenario makes no LLM call, and the optional summary makes exactly one"
      // criterion is read against. Both are literals, and both are wrong the
      // moment either route changes shape — which is the point.
      req.log.info(
        {
          prId: req.params.id,
          provider: explained.provider,
          model: explained.model,
          tokensIn: explained.tokens_in,
          tokensOut: explained.tokens_out,
          costUsd: explained.cost_usd,
          indexedSha: explained.indexed_sha,
          llmCalls: 1,
          durationMs: explained.duration_ms,
        },
        'blast radius explained',
      );
      return explained;
    },
  );
}
