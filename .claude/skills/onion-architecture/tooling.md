# Tool rules — how each backend tool sits in the onion

Read after `SKILL.md`. Every rule below is the dependency rule applied to one tool we actually
use: Fastify 5, Drizzle 0.38 + Postgres, Zod 3 contracts, the adapter/port set, vitest 2.

## Fastify — ring 4, delivery only

A handler does three things: resolve context, call inward, return a DTO.

```ts
app.post('/things/:id/do', { schema: { params: IdParams, body: DoThingBody } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  return service.doThing(workspaceId, req.params.id, req.body);
});
```

- `FastifyRequest` / `FastifyReply` never cross into a service. Pass primitives and DTOs. When
  a service needs to log, it takes a narrow `Logger` port (`run-executor.ts` already does), not
  `req.log` typed as a Fastify object.
- No business branching in the handler. `if (finding.severity === 'blocker')` belongs inward;
  `if (!row) throw new NotFoundError()` is fine — that is translation, not a decision.
- Dependencies come off `app.container`. `new OctokitGitHubClient(...)` inside a module means
  `ContainerOverrides` can no longer swap it and the test needs a network.
- Errors are `AppError` subclasses from `platform/errors.ts`. HTTP status codes are known by
  the error handler only — never by a service.
- Plugin encapsulation *is* an architectural boundary: a module is one plugin registered by
  one line in `modules/index.ts`; helmet/cors/rate-limit/SSE and the error handler register
  before modules so every module inherits them.
- Expensive endpoints carry their own `config.rateLimit`; SSE routes set `rateLimit: false`.

## Drizzle + Postgres — ring 3, the data layer

- `eq/and/desc/inArray`, `db.select`, `db.insert`, `db.transaction` appear **only** in
  `repository*.ts` (or `queries.ts` in a thin module). A route that queries directly is the
  single most common violation in this repo — see the frozen baseline.
- Never hand `db`, a `tx`, or a query builder outward. If two repositories must share a
  transaction, pass the handle as an opaque parameter; callers must not import Drizzle to type it.
- Translate database failures into domain errors at the repository edge (`NotFoundError`,
  `ConflictError`), so no caller needs to know a Postgres error code.
- Every query is scoped by `workspaceId`. It is an invariant of the data layer, not an
  optional argument the caller may forget.
- Row types (`AgentRow`, `PullRow`, …) live in `src/db/rows.ts` and may circulate inside the
  server. They stop at two borders: the HTTP response (map to a DTO in `helpers.ts`) and
  `vendor/shared` / `reviewer-core` (never).
- Schema changes: edit `src/db/schema/<domain>.ts`, then `pnpm db:generate`. Never hand-edit
  `src/db/migrations/**`. The schema serves the domain model; it does not define it.

## Zod + `@devdigest/shared` — rings 0–1, the vocabulary

- A contract is both request validation and response serialization. Declare it in
  `vendor/shared/contracts/**`, reference it from the route schema, and let invalid input fail
  with 422 before the handler body runs.
- Validate exactly once, at the edge. Inside rings 0–2 the data is already trusted — a second
  `.parse()` is duplicated truth, not extra safety.
- Ports are plain TypeScript interfaces in `vendor/shared/adapters.ts`. A service imports the
  interface; only `Container` imports the implementation.
- Editing a contract in `server/src/vendor/shared` requires the mirror edit in
  `client/src/vendor/shared`. The copies have drifted before — diff before committing.

## Adapters and secrets — ring 3 behind ring 1

Adding an outbound call is always four steps:

1. Declare or reuse the port in `vendor/shared/adapters.ts`.
2. Implement it in `src/adapters/<domain>/`.
3. Expose it as a lazy getter on `Container`, `overrides` checked first.
4. Add a mock to `src/adapters/mocks.ts` — never hand-roll one in a test file.

Secrets resolve through `SecretsProvider` inside the getter and throw `ConfigError` when
missing. `process.env` outside `platform/config.ts` is a violation the linter cannot see, so
check it by eye in review.

## reviewer-core — ring 0, the centre

Zero I/O. No `node:fs`, `node:child_process`, no Fastify, Drizzle, Octokit, or database. Its
only side effect is the injected `LLMProvider`. It is consumed as **source** through a tsconfig
alias by the server today and by the CI runner later, which is exactly why purity is not
optional — the guard checks it in the same cruise as the server.

## vitest — the layering's proof

- A service test that needs Docker means infrastructure leaked into the service. Fix the
  layering; do not rename the file to `*.it.test.ts`.
- Unit lane (`--exclude '**/*.it.test.ts'`): rings 0–2, wired with `adapters/mocks.ts` and
  `ContainerOverrides`. Integration lane (`.it.test.ts`): ring 3 against real Postgres.
- Hard-to-test code is an architecture report, not a testing problem. If a test needs three
  mocks to reach one assertion, the unit under test is probably sitting in the wrong ring.

## Review checklist for a backend diff

1. Does any non-repository file import `drizzle-orm` or `src/db/schema`?
2. Does a service import a concrete adapter instead of taking a port off `container`?
3. Did a Fastify type, `req`, or `reply` cross inward?
4. Is there business branching in a route handler?
5. Is every new query scoped by `workspaceId`?
6. Does a new outbound call have a port, a container getter, and a mock?
7. Do row types stop before the HTTP response and before `vendor/shared`?
8. Is a contract change mirrored into `client/src/vendor/shared`?
9. Does `pnpm arch:check` still exit 0?
