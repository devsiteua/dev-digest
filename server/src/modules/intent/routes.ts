import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrIntentRecord } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * L03 — the intent layer.
 *   GET  /pulls/:id/intent  → the derived intent, 404 when it was never derived
 *   POST /pulls/:id/intent  → derive or re-derive it now
 *
 * A review derives its own intent as pre-work, so these two exist for the cases
 * a run does not cover: reading what is already stored without paying for it, and
 * re-deriving on demand after the author rewrote the description.
 *
 * Derivation is SYNCHRONOUS, for the same reason the conventions scan is: one
 * call to a cheap model, one step, no partial output worth streaming. The cost is
 * a held-open request — see `INTENT_TIMEOUT_MS`, and note that the default
 * provider caps itself at 90 s regardless.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams } },
    async (req): Promise<PrIntentRecord> => {
      const { workspaceId } = await getContext(app.container, req);
      const intent = await app.container.intent.get(workspaceId, req.params.id);
      // 404 rather than an empty body: "never derived" and "derived, and it says
      // nothing" are different answers, and the card renders them differently.
      if (!intent) throw new NotFoundError('No intent has been derived for this pull request');
      return intent;
    },
  );

  // Rate-limited on the same budget as `POST /pulls/:id/review` and the
  // conventions scan: it spends money, so a held-down button is a bill.
  app.post(
    '/pulls/:id/intent',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<PrIntentRecord> => {
      const { workspaceId } = await getContext(app.container, req);
      const intent = await app.container.intent.derive(workspaceId, req.params.id);
      // What it cost and what it was built from, on the server too — the card is
      // not the only place this has to be answerable from.
      req.log.info(
        {
          prId: req.params.id,
          sources: intent.sources,
          tier: intent.confidence_tier,
          kind: intent.kind,
          provider: intent.provider,
          model: intent.model,
          costUsd: intent.cost_usd,
          durationMs: intent.duration_ms,
        },
        'intent derived',
      );
      return intent;
    },
  );
}
