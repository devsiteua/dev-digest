import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ConventionSkillRequest, ConventionUpdate } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * L02 — conventions extractor.
 *   POST  /repos/:id/conventions/extract  → one pass: sample, ask, verify, persist
 *   GET   /repos/:id/conventions          → the stored candidates
 *   PATCH /conventions/:id                → reword, re-file, accept/reject
 *   POST  /repos/:id/conventions/skill    → 201, one merged skill from the accepted ones
 *
 * Extraction is SYNCHRONOUS. It is a single call to a cheap model against a
 * sample that code — not the model — selected, and the screen shows a blocking
 * "Scanning…" for its duration (`client/messages/en/conventions.json`). A
 * JobRunner job or an SSE stream would add a status table and a subscription to
 * something with exactly one step and no partial output worth watching.
 *
 * Nothing here returns a sha or a URL. The client already holds the repo's
 * `full_name` and `default_branch`, and builds the GitHub link from those plus
 * `evidence_path` — the same split `FindingCard` uses, which is what keeps a
 * stale sha out of a link the user is about to click.
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // The one endpoint here that spends money, rate-limited like
  // `POST /pulls/:id/review`: a scan reads up to a dozen files into one prompt,
  // so a held-down button is a real bill rather than wasted CPU.
  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await app.container.conventions.extract(workspaceId, req.params.id);
      // The discard count is the pass's quality report, and it is the number
      // that explains a short list. It ships in the response for the screen and
      // is logged here so a run that found nothing leaves a trace on the server
      // too — the UI is not the only place this has to be answerable from.
      req.log.info(
        {
          repoId: req.params.id,
          sampled: result.sampled_files.length,
          candidates: result.candidates.length,
          discarded: result.discarded.length,
        },
        'conventions extraction finished',
      );
      return result;
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.conventions.list(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: ConventionUpdate } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const candidate = await app.container.conventions.update(
        workspaceId,
        req.params.id,
        req.body,
      );
      if (!candidate) throw new NotFoundError('Convention not found');
      return candidate;
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: ConventionSkillRequest } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await app.container.conventions.createSkill(
        workspaceId,
        req.params.id,
        req.body,
      );
      reply.status(201);
      return skill;
    },
  );
}
