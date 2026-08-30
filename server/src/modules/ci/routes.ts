import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CiExportInput,
  CiIngestInput,
  type AgentCiView,
  type CiExport,
  type CiFile,
  type CiRun,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError } from '../../platform/errors.js';
import { CI_INGEST_BODY_LIMIT, MIN_CI_TOKEN_LENGTH } from './constants.js';
import { CiService } from './service.js';

/**
 * Export to CI, and the reads that show what came back.
 *   POST /agents/:id/export-ci         → commit the bundle and open a pull request
 *   GET  /agents/:id/export-ci/preview → the same file list, read-only
 *   POST /ci/ingest                    → a CI job posting its result artifact
 *   GET  /ci/runs                      → the CI Runs page
 *   GET  /agents/:id/ci                → the agent's CI tab
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

  /**
   * The one route in this module that does NOT resolve a request context.
   *
   * `server/CLAUDE.md` says every route starts by resolving one, "no
   * exceptions". This is the exception, drawn to this route alone and written
   * down here because the alternative is worse: the caller is a CI job in
   * someone else's repository, holding a shared token and no session. AC-23
   * requires the workspace to come from the installation the artifact names, so
   * resolving one from the request would either invent a workspace or offer the
   * caller a say in which one they write to. The bearer check below is the
   * authentication this route has instead.
   */
  app.post(
    '/ci/ingest',
    {
      // The whole app allows 1 MB; an artifact is a handful of counters and a
      // job URL. A smaller ceiling on the one unauthenticated-by-session route
      // is the cheapest limit there is.
      bodyLimit: CI_INGEST_BODY_LIMIT,
      // `onRequest` runs BEFORE body parsing and therefore before validation, so
      // a bad token answers 401. A schema can only ever answer 422, which would
      // tell an attacker their token was fine and their JSON was not.
      onRequest: (req) => requireCiToken(app.container, req),
      schema: { body: CiIngestInput },
    },
    async (req): Promise<CiRun> => {
      const run = await service.ingest(req.body);
      req.log.info(
        {
          repo: req.body.repo,
          prNumber: req.body.pr_number,
          commitSha: req.body.commit_sha,
          exitCode: req.body.exit_code,
          findings: req.body.result.findings_count,
          ciRunId: run.id,
        },
        'ci result ingested',
      );
      return run;
    },
  );

  app.get('/ci/runs', async (req): Promise<CiRun[]> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listRuns(workspaceId);
  });

  app.get(
    '/agents/:id/ci',
    { schema: { params: IdParams } },
    async (req): Promise<AgentCiView> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.agentCiView(workspaceId, req.params.id);
    },
  );
}

/**
 * Bearer check for `POST /ci/ingest`.
 *
 * Fails CLOSED: an unset token, or one too short to be worth anything, refuses
 * every request rather than accepting every request. That is the direction this
 * has to fail — the opposite reading of "no token configured" is an open
 * endpoint that writes rows.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first; that comparison leaks the token's length and nothing else.
 */
async function requireCiToken(container: Container, req: FastifyRequest): Promise<void> {
  const unauthorized = new AppError('unauthorized', 'Invalid or missing CI token', 401);

  const expected = await container.secrets.get('DEVDIGEST_CI_TOKEN');
  if (!expected || expected.length < MIN_CI_TOKEN_LENGTH) throw unauthorized;

  const header = req.headers.authorization ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized;
}
