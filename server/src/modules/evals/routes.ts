import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseFromFindingInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * L06 — the eval pipeline.
 *   POST   /eval-cases              → 201, one case frozen from a decided finding
 *   GET    /agents/:id/eval-cases   → that agent's case set
 *   DELETE /eval-cases/:id          → 204 (its eval_runs cascade)
 *
 * The body schema validates SHAPE only, and that is the whole of what 422 covers
 * here. Three rejections carry other statuses — an undecided finding (409), a
 * review with no agent to own the case (409) and a diff over the frozen-input
 * limit (413) — and a Zod route schema has no vocabulary for any of them, so
 * they are thrown from the service as `AppError`s that carry their own status.
 * See the class comment in `service.ts`; this is the documented exception to
 * `server/CLAUDE.md`'s "invalid input is 422 before the handler runs", not a
 * licence for the next module to reach for `AppError` in place of a schema.
 */
/**
 * The two batch ids to compare. Declared here rather than in `@devdigest/shared`
 * for the same reason `PullLookupQuery` is (`modules/pulls/routes.ts`): a query
 * string is a delivery detail with no consumer on the other side of the wire.
 */
const CompareQuery = z.object({
  a: z.string().uuid(),
  b: z.string().uuid(),
});

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.post('/eval-cases', { schema: { body: EvalCaseFromFindingInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const created = await app.container.evals.createCaseFromFinding(
      workspaceId,
      req.body.finding_id,
    );
    req.log.info(
      { findingId: req.body.finding_id, caseId: created.id, ownerId: created.owner_id },
      'eval case created from finding',
    );
    reply.status(201);
    return created;
  });

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.evals.listCasesForAgent(workspaceId, req.params.id);
  });

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await app.container.evals.deleteCase(workspaceId, req.params.id);
    reply.status(204);
  });

  /**
   * Start a run. Returns 202 with the batch, NOT the results: the batch is
   * executed in the background and read back through the two GETs below. A real
   * eight-case run is minutes, so a synchronous answer would be a timeout.
   */
  app.post('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const batch = await app.container.evals.startRun(workspaceId, req.params.id);
    req.log.info(
      { agentId: req.params.id, batchId: batch.id, casesTotal: batch.cases_total },
      'eval run started',
    );
    reply.status(202);
    return batch;
  });

  /**
   * Registered BEFORE `/eval-runs/:id`, because `IdParams` requires a uuid and
   * "compare" is not one — without the order, a request for the comparison would
   * be matched by the id route and answered with a 422 about a malformed uuid.
   */
  app.get('/eval-runs/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.evals.compare(workspaceId, req.query.a, req.query.b);
  });

  app.get('/eval-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.evals.getBatch(workspaceId, req.params.id);
  });

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.evals.listBatchesForAgent(workspaceId, req.params.id);
  });


  app.get('/evals/dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.evals.dashboard(workspaceId);
  });
}
