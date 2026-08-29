import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ProjectContextPatch,
  ProjectContextReorder,
  ProjectContextUpload,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * L05 — the Project Context folder.
 *   GET    /repos/:id/context        → the repo's documents, in order, no bodies
 *   GET    /context/:id              → one document, with its body
 *   POST   /repos/:id/context        → 201, one uploaded document
 *   PATCH  /context/:id              → enable / disable / retitle
 *   DELETE /context/:id              → 204
 *   PUT    /repos/:id/context/order  → the full id list, in the new order
 *
 * Upload is a JSON body, not multipart. `@fastify/multipart` is not a
 * dependency, `bodyLimit` is 1 MB against a 256 KB ceiling, and — the reason
 * that matters — a JSON body hands the service the `filename`, which is what
 * lets it answer a wrong extension with a 400 instead of parsing a stream to
 * find out. The browser reads the file with `FileReader`.
 *
 * The body schemas here are deliberately permissive. The upload's four
 * rejections carry four different statuses (400/413/409/400) and a Zod route
 * schema can only produce 422, so those decisions belong to the service; see
 * `service.ts`.
 */
export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.projectContext.list(workspaceId, req.params.id);
  });

  app.get('/context/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.projectContext.get(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/context',
    { schema: { params: IdParams, body: ProjectContextUpload } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const doc = await app.container.projectContext.upload(
        workspaceId,
        req.params.id,
        req.body,
      );
      req.log.info(
        { repoId: req.params.id, docId: doc.id, sizeBytes: doc.size_bytes },
        'project context document uploaded',
      );
      reply.status(201);
      return doc;
    },
  );

  app.patch(
    '/context/:id',
    { schema: { params: IdParams, body: ProjectContextPatch } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.patch(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/context/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await app.container.projectContext.remove(workspaceId, req.params.id);
    reply.status(204);
  });

  app.put(
    '/repos/:id/context/order',
    { schema: { params: IdParams, body: ProjectContextReorder } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.reorder(
        workspaceId,
        req.params.id,
        req.body.ids,
      );
    },
  );
}
