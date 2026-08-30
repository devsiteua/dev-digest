# @devdigest/api — Fastify + Postgres. All of the project's I/O lives here.

## Commands

```sh
pnpm dev          # :3001
pnpm db:migrate   # never runs on boot
pnpm db:seed      # idempotent demo data
pnpm typecheck
pnpm arch:check   # onion guard (~1s) — layer violations, known ones baselined
```

Test lane split is in the root `CLAUDE.md`.

## Map

| Path | What |
|------|------|
| `src/platform/` | infrastructure: `container` (DI) · `config` · `jobs` · `sse` · `errors` |
| `src/adapters/` | outbound ports: llm · github · git · astgrep · secrets · auth · tokenizer |
| `src/adapters/mocks.ts` | use this in tests — do not hand-roll mocks |
| `src/modules/<n>/` | a feature = Fastify plugin: `routes` → `service` → `repository` |
| `src/db/schema/` | Drizzle tables by domain + `schema.ts` barrel |

## Conventions

- Layers are strict: SQL **only** in `repository.ts`, HTTP **only** in `routes.ts`, pure
  transforms in `helpers.ts`, literals in `constants.ts`.
- A new module is `modules/<name>/routes.ts` plus **one line** in `modules/index.ts`.
  Registration is static on purpose so tsx, the bundler, and vitest share one code path.
- Every route starts with `getContext(container, req)` → `workspaceId`, and every query is
  scoped by it. No exceptions.
- Take dependencies from `container`, never by importing a concrete class — otherwise tests
  cannot swap them through `ContainerOverrides`.
- Plugins (helmet, cors, rate-limit, SSE) and the error handler register **before** modules,
  so encapsulated module plugins inherit them.
- Route schemas come from `@devdigest/shared`; invalid input is rejected with 422 before the
  handler runs.
- A module written AFTER `FEATURE_MODELS` reads `featureModelOverride(ws, <slot>)` and falls
  back to its own constant — never `resolveFeatureModel`. The registry's defaults promise to
  mirror each module's constants, a promise it cannot keep for a module that did not exist
  when it was written, so its default is a model nobody chose. Seen twice: `conventions`,
  `risk_brief`.

## Gotchas

- `reapStaleRuns()` on boot kills every `running` row — it assumes **one API instance per DB**.
- `runReview()` always returns `reviews: []`. The review is fire-and-forget and the result
  arrives over SSE. Do not "fix" that empty array.
- `RunBus` (`platform/sse.ts`) holds events in memory. A restart loses the live log; that is
  why the full trace is persisted to `run_traces` even on failure and cancellation.
- repo-intel degrades silently: an unindexed repo drops prompt sections with no error. Empty
  context is not a bug.
- `platform/{prompt,grounding,structured}.ts` are re-export shims onto `reviewer-core`. Do not
  write new code against them — import `@devdigest/reviewer-core`.
- `instanceof z.ZodError` is unreliable here (duplicate zod module instances); the error
  handler also matches by shape. See `src/app.ts`.

## Do not touch

- `clones/` and `~/.devdigest/workspace` — runtime data
- `src/db/migrations/**` — only via `pnpm db:generate`

## Read when

- Adding an endpoint or a module → read `README.md` (Request & DI flow, API map)
- Unsure which layer a piece of code belongs to, or `pnpm arch:check` failed → skill
  `onion-architecture` (rings, forbidden imports, the frozen-debt baseline)
- Working on repo indexing → read `src/modules/repo-intel/README.md`
- Changing an agent's system prompt → read `../docs/agent-prompts/README.md`, and mirror the
  change into `src/db/seed-prompts.ts` (two sources, synced by hand)
- Adding routes, services, adapters, or jobs → read `docs/module-anatomy.md`
- Writing a test → read `../TESTING.md` (Conventions)
- A run or job behaves unexpectedly → read `INSIGHTS.md` first
- Starting a task → read `specs/README.md`
