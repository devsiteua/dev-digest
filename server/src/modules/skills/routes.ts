import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_BODY_CHARS, MAX_DESCRIPTION_CHARS, MAX_NAME_CHARS } from './constants.js';
import { SkillsService } from './service.js';

/**
 * L02 — skills module.
 *   GET    /skills                  → list (workspace-scoped)
 *   GET    /skills/:id              → one skill
 *   GET    /skills/:id/versions     → body snapshots, newest first
 *   GET    /skills/:id/stats        → usage numbers for the editor's Stats tab
 *   POST   /skills/:id/restore      → make a past snapshot the current body
 *   POST   /skills                  → create (source is forced to 'manual')
 *   PUT    /skills/:id              → update; `source` is NOT accepted
 *   DELETE /skills/:id              → delete (agent links cascade)
 *   POST   /skills/import/preview   → parse an upload into a draft; writes nothing
 *   POST   /skills/import           → persist a reviewed draft (imported_file, disabled)
 *
 * Import is split across two endpoints on purpose. "Nothing is saved until you
 * confirm" is then a property of the API — the preview endpoint has no write path
 * at all — instead of a rule the UI has to remember to follow.
 *
 * Uploads arrive as JSON rather than multipart because the browser already has to
 * read the file to show a preview, and `lib/api.ts` speaks only JSON. Archives are
 * base64; `app.ts` caps the body at 1 MB, and the client rejects anything over
 * MAX_ZIP_BYTES before sending so the user gets a sentence, not a 413.
 */

const SkillBody = z.string().min(1).max(MAX_BODY_CHARS);

const CreateSkillBody = z.object({
  name: z.string().min(1).max(MAX_NAME_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  type: SkillType.optional(),
  body: SkillBody,
  enabled: z.boolean().optional(),
});

/** No `source`: provenance is decided by the endpoint, never by the caller. */
const UpdateSkillBody = z.object({
  name: z.string().min(1).max(MAX_NAME_CHARS).optional(),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  type: SkillType.optional(),
  body: SkillBody.optional(),
  enabled: z.boolean().optional(),
});

/** Which snapshot to restore. Versions start at 1, so 0 is not a version. */
const RestoreBody = z.object({ version: z.number().int().positive() });

const ImportPreviewBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('markdown'),
    filename: z.string().min(1).max(255),
    content: z.string().min(1).max(MAX_BODY_CHARS),
  }),
  z.object({
    kind: z.literal('zip'),
    filename: z.string().min(1).max(255),
    content_base64: z.string().min(1),
  }),
]);

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.stats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  /**
   * POST rather than PUT: restoring is not idempotent — it appends a new version
   * carrying the old text, so calling it twice moves the skill forward twice.
   */
  app.post(
    '/skills/:id/restore',
    { schema: { params: IdParams, body: RestoreBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restoreVersion(workspaceId, req.params.id, req.body.version);
      if (!skill) throw new NotFoundError('Skill or version not found');
      return skill;
    },
  );

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description ?? '',
      type: body.type ?? 'custom',
      body: body.body,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  // Rate-limited below the global 120/min: this is the only endpoint that runs
  // attacker-supplied bytes through a synchronous decompressor on the event
  // loop. The size ceilings in `constants.ts` bound ONE request; this bounds the
  // rate. Same treatment as the other expensive routes (`reviews` 10/min,
  // `settings` 20/min).
  app.post(
    '/skills/import/preview',
    {
      schema: { body: ImportPreviewBody },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      await getContext(app.container, req);
      return service.preview(req.body);
    },
  );

  app.post('/skills/import', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.createFromImport(workspaceId, {
      name: body.name,
      description: body.description ?? '',
      type: body.type ?? 'custom',
      body: body.body,
    });
    reply.status(201);
    return skill;
  });
}
