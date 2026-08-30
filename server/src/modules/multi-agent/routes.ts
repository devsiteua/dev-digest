import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { MultiAgentRun, RunEstimateResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError } from '../../platform/errors.js';
import { MultiAgentService } from './service.js';

/**
 * L07 — Multi-Agent Review, the read side.
 *   GET /pulls/:id/multi-agent          → the LATEST multi-agent run of this PR,
 *                                         as columns, finding groups and conflicts.
 *   GET /pulls/:id/multi-agent/estimate → what each agent's next run is likely
 *                                         to cost, from `agent_runs` alone.
 *
 * A run is STARTED by `POST /pulls/:id/review` with `agentIds`; nothing posts
 * here. That is why this module writes nothing at all.
 *
 * Neither route carries a rate-limit override, on the same reasoning as
 * `GET /pulls/:id/brief` and `GET /pulls/:id/blast`: those caps exist where a
 * held-down button is a bill, and these two spend queries, not money. The global
 * limit still applies.
 *
 * The service is constructed here rather than brokered on `Container`, which is
 * what `modules/brief` and `modules/smart-diff` do and for the same reason:
 * nothing else consumes it. It also keeps `platform/container.ts` — a file two
 * parallel streams both append to — out of this diff entirely.
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new MultiAgentService(app.container);

  app.get(
    '/pulls/:id/multi-agent',
    { schema: { params: IdParams } },
    async (req): Promise<MultiAgentRun> => {
      const { workspaceId } = await getContext(app.container, req);
      const startedAt = Date.now();
      const run = await service.read(workspaceId, req.params.id);
      // Two things can 404 here and they are told apart by their CODE, not by
      // their status: a pull request that does not exist keeps `not_found` and
      // "Pull request not found" (thrown in the service), while this one means
      // one thing only — the PR exists and has never been run through a set.
      if (!run) {
        throw new AppError(
          'no_multi_agent_run',
          'No multi-agent run has been started for this pull request',
          404,
        );
      }

      // The zero on `llmCalls` below is a literal on purpose, exactly as the PR
      // brief's GET writes it and for the same reason: it is the line this
      // route's zero-model-call criterion is read against, and the day someone
      // adds a model call here it becomes a lie a reviewer catches by reading
      // one route.
      req.log.info(
        {
          prId: req.params.id,
          multiAgentRunId: run.id,
          agents: run.agent_count,
          agentsConsidered: run.agents_considered,
          groups: run.groups.length,
          conflicts: run.conflicts.length,
          llmCalls: 0,
          durationMs: Date.now() - startedAt,
        },
        'multi-agent run served',
      );
      return run;
    },
  );

  app.get(
    '/pulls/:id/multi-agent/estimate',
    { schema: { params: IdParams } },
    async (req): Promise<RunEstimateResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.estimate(workspaceId, req.params.id);
    },
  );
}
