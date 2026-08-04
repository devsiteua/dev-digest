# Module anatomy — how to add things to the server

Recipes for the four things you will actually add: a module, a route, an adapter, a
background job. The *why* behind the layering is in `../README.md`; this file is the *how*.

## A feature module

```
src/modules/<name>/
  routes.ts       Fastify plugin (default export). HTTP + Zod schemas. No SQL.
  service.ts      Business logic. No HTTP, no SQL.
  repository.ts   Drizzle queries. Every query scoped by workspace_id.
  helpers.ts      Pure transforms (row → DTO, parsing, formatting).
  constants.ts    Literals: job kinds, limits, secret names.
```

Register it with **one import and one entry** in `src/modules/index.ts`. Registration is
static rather than filesystem autoload so tsx, the bundler, and vitest all take the same code
path (native dynamic `import()` of `.ts` is not portable).

Larger modules split `repository.ts` into a folder of per-entity repos — see
`modules/reviews/repository/`. Anything long-running moves out of the service into a
dedicated executor — see `modules/reviews/run-executor.ts`.

## A route

```ts
const app = appBase.withTypeProvider<ZodTypeProvider>();

app.post(
  '/things/:id/do',
  { schema: { params: IdParams, body: DoThingBody } },
  async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.doThing(workspaceId, req.params.id, req.body);
  },
);
```

Rules:

- The Zod schema comes from `@devdigest/shared` (or `modules/_shared/schemas.ts` for
  primitives like `IdParams`). It drives request validation **and** response serialization.
- Never call `Schema.parse(req.body)` by hand; invalid input must fail with 422 before the
  handler body runs. The one tolerated exception is a body where *every* field is optional
  and an empty body is legal — see `POST /pulls/:id/review`.
- Throw `AppError` subclasses (`NotFoundError`, `ConfigError`, …) from
  `platform/errors.ts`; the shared error handler maps them to the `{ error: { code, message,
  details } }` envelope.
- Expensive endpoints get a tighter per-route rate limit via
  `config: { rateLimit: { max, timeWindow } }`. SSE routes set `rateLimit: false`.

## An adapter

An adapter is an implementation of a port declared in `@devdigest/shared/adapters.ts`.

1. Declare or reuse the interface in the shared contracts — and mirror the change into
   `client/src/vendor/shared` if you touched the file.
2. Implement it under `src/adapters/<domain>/`.
3. Expose it as a lazy getter on `Container`, honouring `ContainerOverrides` first:

```ts
get thing(): Thing {
  if (this.overrides.thing) return this.overrides.thing;
  this._thing ??= new RealThing(this.config);
  return this._thing;
}
```

4. Add a mock to `src/adapters/mocks.ts`.

Anything needing a secret resolves it through `this.secrets.get(...)` inside the getter, never
from `process.env`, and throws `ConfigError` when the key is missing. Providers built from
secrets are cached; after a key changes, `container.invalidateSecretCaches()` must be called.

## A background job

Use `JobRunner` for work that is slow, retryable, and not tied to an open request — clone,
index, refresh, poll.

```ts
// constants.ts
export const THING_JOB_KIND = 'thing';

// service.ts — register once, at module wiring
this.container.jobs.register(THING_JOB_KIND, async (payload) => {
  await this.runThingJob(payload as ThingJobPayload);
});

// enqueue — returns immediately, row lands in `jobs`
await this.container.jobs.enqueue(workspaceId, THING_JOB_KIND, payload);
```

Concurrency is 3, timeout 120s, two retries, and status/attempts/error are mirrored into the
`jobs` table. `enqueue()` throws when no handler is registered for the kind — decide
deliberately whether that should fail the caller or be swallowed (the clone → index handoff
swallows it, because the clone already succeeded).

**Reviews are not jobs.** They are fired with `void executor.executeRuns(...)` so the runId
can be returned instantly for SSE subscription.

## Streaming progress

Inside a run, emit through `RunLogger` (`platform/run-logger.ts`), which fans one logger out
over several runIds and buffers everything for the persisted trace:

```ts
const diff = await runLog.step('Loading PR diff', () => loadDiff(...), { kind: 'tool' });
runLog.info(`Diff ready — ${diff.files.length} changed file(s)`);
```

On completion write both artifacts: the `agent_runs` row (`completeAgentRun`) **and** one
`run_traces` document. On failure or cancellation write them anyway, with the buffered log —
that record is the only way to answer "why did it fail" after a reload.

## Schema changes

Edit the domain file under `src/db/schema/`, re-export it from `schema.ts` if it is a new
table, then `pnpm db:generate` and commit the generated SQL. Never hand-edit files in
`src/db/migrations/`. Tables for future lessons already exist — extend them with columns
rather than creating parallel ones.
