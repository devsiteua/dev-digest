import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * L03 — the Smart Diff.
 *   GET /pulls/:id/smart-diff → the PR's files grouped by role, in review order
 *
 * No rate-limit override, unlike `POST /pulls/:id/intent`: those caps exist where
 * a held-down button is a bill, and this endpoint spends nothing but two indexed
 * reads. The global 120/min limit still applies.
 *
 * The service is instantiated here rather than brokered on `Container`. `intent`
 * has a container getter because `modules/reviews` consumes it and a cross-module
 * import would otherwise be the only way; nothing consumes the smart diff, so
 * this follows `modules/reviews/routes.ts` (`new ReviewService(container)`) and
 * keeps the container free of a dependency it has no second caller for.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SmartDiffService(app.container);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams } },
    async (req): Promise<SmartDiffResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      const startedAt = Date.now();
      const diff = await service.forPull(workspaceId, req.params.id);

      // The log line the "no new model call" criterion is read against. It says
      // what was served AND that serving it cost nothing — `llmCalls: 0` is a
      // constant on purpose: the day someone adds a call here, this line becomes
      // a lie that a reviewer can catch by reading one route.
      //
      // Logging lives in the route because a logger parameter on the service
      // would drag Fastify's types below the delivery ring.
      req.log.info(
        {
          prId: req.params.id,
          files: diff.groups.reduce((n, g) => n + g.files.length, 0),
          groups: diff.groups.map((g) => `${g.role}:${g.files.length}`),
          findingLines: diff.groups.reduce(
            (n, g) => n + g.files.reduce((m, f) => m + f.finding_lines.length, 0),
            0,
          ),
          totalLines: diff.split_suggestion.total_lines,
          tooBig: diff.split_suggestion.too_big,
          llmCalls: 0,
          durationMs: Date.now() - startedAt,
        },
        'smart diff served',
      );
      return diff;
    },
  );
}
