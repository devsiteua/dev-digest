import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrBriefRecord, PrBriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { BriefService } from './service.js';

/**
 * L05 — the PR Brief.
 *   GET  /pulls/:id/brief → the stored brief, whether it is still fresh, and the
 *                           Why Timeline. 404 when none was ever generated.
 *   POST /pulls/:id/brief → generate one. The only model call this feature makes.
 *
 * The GET carries NO rate-limit override, on the same reasoning as
 * `GET /pulls/:id/blast` and `GET /pulls/:id/smart-diff`: those caps exist where
 * a held-down button is a bill, and this one spends queries. It is not free — it
 * re-assembles the whole input to recompute `state_key`, because that is what
 * `stale` is defined against — but it never reaches a model. The global 120/min
 * limit still applies. The POST does spend money and is capped accordingly.
 *
 * The service is constructed here rather than brokered on `Container`, which is
 * what `modules/smart-diff/routes.ts` does and for the reason `modules/blast`
 * used to: nothing else consumes a brief. The day something does — a review run
 * that wants the brief in its prompt is the obvious candidate, and it is out of
 * scope on purpose — it moves to the container, exactly as the blast map just
 * did.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req): Promise<PrBriefResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      const startedAt = Date.now();
      const brief = await service.read(workspaceId, req.params.id);
      // 404 means one thing and only one thing: no brief has ever been generated
      // for this pull request. A generated brief is 200 forever after (AC-03).
      if (!brief) throw new NotFoundError('No brief has been generated for this pull request');

      // `llmCalls: 0` is a literal on purpose, and it is the line AC-02 is read
      // against: the day someone adds a model call on this path, this line
      // becomes a lie a reviewer can catch by reading one route.
      req.log.info(
        {
          prId: req.params.id,
          stale: brief.stale,
          riskLevel: brief.risk_level,
          risks: brief.risks.length,
          focus: brief.review_focus.length,
          history: brief.history.length,
          llmCalls: 0,
          durationMs: Date.now() - startedAt,
        },
        'pr brief served',
      );
      return brief;
    },
  );

  /**
   * The one model call this feature makes, behind an explicit button.
   *
   * Rate-limited on the same budget as `POST /pulls/:id/intent` and
   * `POST /pulls/:id/blast/explain`: it spends money, so a held-down button is a
   * bill. Synchronous for the same reason those two are — one call to a cheap
   * model, one step, and no partial output worth streaming.
   */
  app.post(
    '/pulls/:id/brief',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<PrBriefRecord> => {
      const { workspaceId } = await getContext(app.container, req);
      const brief = await service.generate(workspaceId, req.params.id);

      // `llmCalls: 1` here against the `0` above is the pair AC-01 and AC-02 are
      // read against, and both are literals that go wrong the moment either
      // route changes shape — which is the point.
      //
      // `trimmed`, `missingInputs` and `droppedRefs` are here because AC-13
      // obliges every budget drop to reach BOTH channels: the route's log and
      // the stored record. A drop that is only in the row is invisible to
      // whoever is watching the server, and a drop that is only in the log is
      // invisible to whoever reads the brief later.
      req.log.info(
        {
          prId: req.params.id,
          riskLevel: brief.risk_level,
          risks: brief.risks.length,
          focus: brief.review_focus.length,
          provider: brief.provider,
          model: brief.model,
          inputTokens: brief.input_tokens,
          tokensIn: brief.tokens_in,
          tokensOut: brief.tokens_out,
          costUsd: brief.cost_usd,
          trimmed: brief.trimmed,
          missingInputs: brief.missing_inputs,
          droppedRefs: brief.dropped_refs,
          llmCalls: 1,
          durationMs: brief.duration_ms,
        },
        'pr brief generated',
      );
      return brief;
    },
  );
}
