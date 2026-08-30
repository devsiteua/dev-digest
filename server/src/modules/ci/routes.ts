import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CiExportInput, type CiExport, type CiFile } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';

/**
 * Export to CI.
 *   POST /agents/:id/export-ci         → commit the bundle and open a pull request
 *   GET  /agents/:id/export-ci/preview → the same file list, read-only
 *
 * `:id` and not `:agentId`: `modules/agents/routes.ts` already owns
 * `/agents/:id/skills`, and a second parameter NAME at the same path position
 * makes Fastify reject the whole route tree at boot.
 */

/**
 * The body the export accepts.
 *
 * `action` is narrowed to `'open_pr'`, so the contract's other member is a 422
 * before the handler runs rather than a branch that quietly does nothing —
 * returning the files without opening a pull request is out of scope for this
 * pass, and the schema is where that is said.
 */
const CiExportBody = CiExportInput.extend({
  action: z.literal('open_pr').default('open_pr'),
});

/**
 * The preview's querystring, derived from the same contract so the two paths
 * cannot drift: it is `CiExportInput` minus the fields that only matter once
 * something is written, plus the array coercion a querystring needs (Fastify
 * yields a bare string for `?triggers=opened` and an array for two of them).
 */
const CiPreviewQuery = CiExportInput.pick({ repo: true, post_as: true }).extend({
  triggers: z
    .preprocess(
      (v) => (v === undefined || Array.isArray(v) ? v : [v]),
      z.array(z.string()),
    )
    .default(['opened', 'synchronize', 'reopened']),
});

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);

  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportBody } },
    async (req): Promise<CiExport> => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.exportToCi(workspaceId, req.params.id, req.body);

      req.log.info(
        {
          agentId: req.params.id,
          repo: req.body.repo,
          files: result.files.length,
          installationId: result.installation.id,
          prUrl: result.pr_url,
        },
        'agent exported to CI',
      );
      return result;
    },
  );

  /**
   * Read-only, and that is a criterion rather than an implementation detail: it
   * calls no GitHub port and writes no row (AC-34). It is also where a missing
   * runner build surfaces, which is the point of having it — at Install the user
   * has already committed to the action.
   */
  app.get(
    '/agents/:id/export-ci/preview',
    { schema: { params: IdParams, querystring: CiPreviewQuery } },
    async (req): Promise<CiFile[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.buildBundle(workspaceId, req.params.id, {
        post_as: req.query.post_as,
        triggers: req.query.triggers,
      });
    },
  );
}
