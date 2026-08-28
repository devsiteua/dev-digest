# Testing & CI strategy

DevDigest is five independent packages (no workspace), so testing is organised
as **one suite per package**, each with its own runner and — for four of the five
— its own CI workflow and path filter. A package's suite runs only when that
package (or a package it depends on at type-check time) changes. **`mcp/` is the
gap: it has a suite and no workflow.** That is recorded below rather than left
implied.

## Philosophy — typological, not exhaustive

We do **not** chase line coverage. Each suite covers the *kinds* of things that
can break in that layer — one happy path plus the edge that actually matters per
workflow — and deliberately skips the rest. Concretely:

- **Test behaviour at the seams**, not implementation details. Routes, adapters,
  contracts, the review pipeline, the rendered component.
- **Mock the outside world.** LLMs, GitHub, and git are stubbed via
  `server/src/adapters/mocks.ts` so unit tests are hermetic and key-free.
- **One real integration per data-backed workflow**, against a real Postgres —
  not a mock DB — because the bugs there live in SQL, migrations, and wiring.
- **A few end-to-end browser flows** over the *main* user journeys, on seeded
  data, with no LLM in the loop.

If a test wouldn't catch a class of regression we care about, we don't write it.

## Suite map

| Suite | Package | Kind | Runner | Workflow | Docker? |
|-------|---------|------|--------|----------|---------|
| client | `client/` | component / unit (jsdom) | vitest | `client.yml` | no |
| server-unit | `server/` | unit (hermetic) | vitest | `server-unit.yml` | no |
| server-integration | `server/` | integration (real Postgres) | vitest | `server-integration.yml` | **yes** |
| reviewer-core | `reviewer-core/` | unit (engine) | vitest | `reviewer-core.yml` | no |
| mcp | `mcp/` | unit + protocol (hermetic) | vitest | **none yet** — gap, see below | no |
| mcp live | `mcp/` | against a running API | vitest | **none yet** — gap, see below | no (needs the API) |
| e2e web | `e2e/` | browser e2e (deterministic) | agent-browser + `run.ts` | `e2e-web.yml` | yes (stack) |

## What each suite covers

**client** — components render and react to interaction (React Testing Library
+ jsdom). `fetch` is mocked; no API, DB, or browser. Covers the PR-review
surface (list, diff, findings, run controls) and the agent editor.

**server-unit** — the DB-free majority: adapters, prompt assembly, grounding,
repo-intel ranking & indexing, pricing, route smoke. The `typecheck` job also
runs on Windows, which doubles as the `@ast-grep/napi` prebuilt gate (install
fails there if the win32 prebuilt is missing).

**server-integration** — the `*.it.test.ts` files. Each starts a real Postgres
(pgvector) via testcontainers, builds the Fastify app, migrates + seeds, and
drives routes end-to-end: reviews + run lifecycle (incl. grounding), agents CRUD,
repo-intel symbol clamping, pulls comments, settings models. They self-skip when
Docker is unavailable.

**reviewer-core** — the pure engine: `toReview` selection, prompt construction,
and a `run` with a stubbed model → grounded findings. No DB / GitHub / FS.

**mcp** — the two lanes of `@devdigest/mcp`. The hermetic lane (`cd mcp && pnpm
test`) injects `fetch`, so it needs no API and no network: the agent resolver,
the finding/convention projections, the poll-and-wait clock, the error text, and
a `tools/list` surface test that spawns the process over stdio. The live lane
(`cd mcp && pnpm test:live`, `*.live.test.ts`) needs the API on :3001 and
self-skips when `GET /health` is unreachable — the same self-skip the `.it.test`
lane does without Docker. It is a separate suffix on purpose: `*.it.test.ts`
means "touches the DB" everywhere else in this repo, and an `mcp/` test touches
an **API**, not a database.

> **No CI workflow covers `mcp/**` — that is a known gap, not an oversight.**
> The five workflows are path-filtered per package and none of them selects
> `mcp/**`. Because `mcp/` type-checks against `server/src/vendor/shared`, a
> contract change in `server/` can break it with nothing red anywhere. Until a
> workflow exists, `cd mcp && pnpm typecheck` is the only thing that notices —
> run it after any `server/src/vendor/shared` edit, not just after an `mcp/` one
> (`mcp/CLAUDE.md` § Gotchas). Wiring the filter correctly is its own change:
> the workflow has to trigger on `server/src/vendor/shared/**` as well.

**e2e web** — see `e2e/README.md`. Deterministic agent-browser flows over the
main journeys (boot → PR list → PR detail; agents) against a real seeded stack.
No `chat`, no model key.

## Running locally

```sh
# per package
cd client        && pnpm test           # + pnpm typecheck
cd reviewer-core && npm test
cd mcp           && pnpm test           # hermetic; + pnpm typecheck
cd mcp           && pnpm test:live      # needs the API on :3001 (./scripts/dev.sh)

# server — the unit/integration split (see note below)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, no Docker
cd server && pnpm exec vitest run .it.test                      # integration, needs Docker
cd server && pnpm test                                          # both

# browser e2e (needs the full stack + agent-browser CLI)
./scripts/dev.sh
npm i -g agent-browser && agent-browser install
cd e2e && npm install && npm test
```

## Conventions

- **Integration tests end in `*.it.test.ts`.** The unit lane excludes that glob
  (`vitest run --exclude '**/*.it.test.ts'`); the integration lane selects only
  it (`vitest run .it.test`). A DB-backed test that imports `test/helpers/pg.ts`
  must use the `.it.test.ts` suffix.
- **`server/package.json` is `skip-worktree`** (a local variant diverges from the
  committed file). CI therefore invokes the split with
  `pnpm exec vitest run …` rather than relying on committed `test:unit` /
  `test:integration` scripts.
- **Hermetic by default.** Reach for `src/adapters/mocks.ts` (MockLLMProvider,
  MockGitClient) rather than real network/keys.
- **E2E specs are deterministic batch JSON** (`e2e/specs/*.flow.json`) using
  only `--url` / `--text` / `find` locators — never the AI `chat` command.
- **CI is path-filtered per package.** Cross-package source aliases are encoded
  in each workflow's `paths:` (e.g. `reviewer-core/**` triggers `server-unit`
  because the server type-checks against `../reviewer-core/src`). `mcp/**` is in
  no workflow's `paths:` at all — see the gap noted above.
- **An `mcp/` test that needs the running API ends in `*.live.test.ts`**, never
  `*.it.test.ts`. The `.it.test` suffix is reserved for DB-backed tests, and the
  server lanes split on that glob.
- **`server/clones/**` is runtime data** (git-ignored) and never collected by
  any suite.
