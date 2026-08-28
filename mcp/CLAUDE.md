# @devdigest/mcp — a stdio MCP delivery adapter over the API. No I/O of its own.

Five tools (`list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`,
`get_blast_radius`) spoken over stdio to a client that spawns this process. Every
byte of data comes from `@devdigest/api` on `:3001` over HTTP. No database, no
Drizzle, no secrets, no migrations — and none of them may be added here (root
`CLAUDE.md` § Map: all I/O and persistence lives in `server/`).

## Commands

```sh
pnpm install
pnpm typecheck                          # the ONLY drift guard this package has — see Gotchas
pnpm test                               # hermetic: fetch injected and stubbed
pnpm test:live                          # needs the API on :3001; self-skips when it is down
pnpm exec tsx src/index.ts              # run it by hand (stdin/stdout are JSON-RPC)
pnpm dlx @modelcontextprotocol/inspector -- pnpm exec tsx src/index.ts   # first-line debugging
```

All of the above run **from `mcp/`**. The `.mcp.json` entry spawns the same
process from the repository root instead (`pnpm --dir mcp exec tsx src/index.ts`),
because a stdio entry has no `cwd` field to point elsewhere with.

There is no `build` script and no `dist/`: `tsconfig.json` is `noEmit` and the
process runs from source through `tsx`.

## Rings

Same split as the server's `routes.ts` / `repository.ts` / `helpers.ts`, and
checkable by grep rather than by argument. `.claude/skills/onion-architecture`
describes the pattern; **`pnpm arch:check` does not cover `mcp/`**, so this table
is enforced by hand and by the greps beside it.

| Ring | Path | May do | Must not |
|---|---|---|---|
| Delivery | `src/tools/*.ts`, `src/server.ts`, `src/index.ts` | know the MCP protocol shape — content blocks, `structuredContent`, `isError`, annotations | call `fetch`, read `process.env` |
| Infrastructure | `src/api/*.ts` | `fetch`, HTTP status → error mapping, polling | know anything about MCP |
| Pure | `src/shape/*.ts`, `src/schemas.ts`, `src/errors.ts`, `src/copy.ts` | transform DTOs, build error text | `await` anything |
| Composition | `src/config.ts` | the **only** `process.env` read | — |

```sh
grep -rn "fetch(" src/tools src/shape     # must be empty
grep -rln "process\.env" src              # must print only src/config.ts
```

## Conventions

- **Contracts are imported as types only.**
  `import type { Agent, RunSummary, … } from '@devdigest/shared'` — never a value
  import. `verbatimModuleSyntax: true` makes a value import fail to compile, and
  `vitest.config.ts` deliberately omits the alias that `tsconfig.json` declares,
  so one would also fail loudly at the first test instead of quietly pulling the
  server's Zod into this process. The cost is stated plainly: **this package does
  not re-validate API responses at runtime.** `pnpm typecheck` is the guard.
- **stdout is the JSON-RPC channel.** No `console.log` / `.info` / `.debug`
  anywhere in `src/` — one line corrupts the stream and the client drops the
  connection with the reason visible only on stderr. Every diagnostic goes
  through `log()` (`src/log.ts`), which is `console.error`.
  `test/stdio-purity.test.ts` spawns the process and asserts it.
- **A business failure is a tool result, never a thrown protocol fault.** Return
  `isError: true` with text that names the next step; the process must stay alive
  and answer the next call even with nothing on `:3001`.
- **Every tool declares an `outputSchema`**, and every **successful** result
  carries `structuredContent` plus the same payload as a JSON text block.
- **An error result carries no `structuredContent`** — its payload rides in a
  second JSON text block instead. An error shape cannot satisfy the success
  `outputSchema` the tool advertises, and while the SDK lets that pass (
  `validateToolOutput` returns early when `isError` is true, so the unit lane
  never notices), a client does not: the MCP Inspector validates with ajv and
  rejects the **whole** result, so the caller gets a schema complaint instead of
  the sentence naming `list_agents` or `./scripts/dev.sh`. `get_blast_radius` is
  the single exception, because its declared shape IS its error shape. The rule is
  pinned by `test/tool-surface.test.ts` § "error results never contradict their
  own outputSchema".
- **Tool inputs are flat.** String, number, boolean or enum — no nested object.
  Shared fields (`repo`, `pr`, `agent`, `response_format`, `limit`) are declared
  once in `schemas.ts` and reused.
- **The tool copy is fixed.** The `instructions` paragraph and the five
  descriptions live in `src/copy.ts` and must stay byte-identical to
  `specs/L04-mcp-server.md` § Appendix; `test/copy.test.ts` fails on any drift,
  whitespace included. If a string has to change, the Appendix changes first.
- **Never spend money on a caller's behalf without being asked.** `agent` is
  required on `run_agent_on_pr` and `{ all: true }` is never sent (one such call
  bills every enabled agent); no tool calls
  `POST /repos/:id/conventions/extract`.

## Gotchas

- **This package runs Zod 4; `server/` and `reviewer-core/` run Zod 3 — and that
  is deliberate.** The SDK (`@modelcontextprotocol/server@2.0.0`) requires
  `zod@^4.2.0` for Standard Schema, which Zod 3 does not implement. Do **not**
  "align" `mcp/` back to Zod 3: that breaks the SDK.
- **Do not add a `zod` entry to `tsconfig.json`'s `paths`.** `mcp/` and `server/`
  are separate package trees, so each resolves its own Zod by ordinary node
  resolution (`mcp/` 4.4.3, `server/` 3.25.76) and the `@devdigest/shared` alias
  compiles cleanly. Adding a `zod` self-pin — which `reviewer-core/tsconfig.json`
  has, and which the L04 plan expected to copy — forces this package's Zod 4 onto
  the server's Zod 3 contract source and fails at
  `server/src/vendor/shared/contracts/platform.ts:97`
  (`z.record(FeatureModelId, FeatureModelChoice).default({})`: Zod 4 infers an
  exhaustive `Record<K, V>` for an enum-keyed record, so `{}` is no longer a legal
  default). That third option is what keeps the compile-time coupling below; both
  fallbacks the plan named (drop the alias, or fall back to the older SDK line)
  were verified unnecessary and **not** taken.
- **No CI workflow covers `mcp/`.** The four suites in `TESTING.md` are
  path-filtered per package and none of them selects `mcp/**`, so a
  `@devdigest/shared` contract change can break this package with nothing red
  anywhere. `cd mcp && pnpm typecheck` is the only thing that notices — run it
  after any `server/src/vendor/shared` edit, not just after an `mcp/` edit.
- **The agent slug is minted here, and DevDigest does not own it.** There is no
  slug column: `shape/agents.ts` kebab-cases `name`. Renaming an agent in the UI
  silently changes its slug, so a saved prompt can stop resolving — which is why
  every resolution error names `list_agents`.
- **`POST /pulls/:id/review` is fire-and-forget** and returns `reviews: []` on
  purpose. The wait lives in `src/api/wait.ts`, polls `GET /pulls/:id/runs`, and
  checks its deadline **before** sleeping (a call that overshoots ~120 s gets
  backgrounded by Claude Code mid-poll).
- **Never `reviews[0]`.** `created_at` ties to the microsecond across one review
  fan-out; `run_agent_on_pr` selects by the `run_id` it was handed and
  `get_findings` tie-breaks `created_at desc, id desc`.
- **The API's rate limits are shared with the web app** — 120 req/min globally,
  10/min on the review trigger. No sub-2-second poll, and no retry loop on 429.

## Do not touch

- `src/copy.ts` strings without changing `specs/L04-mcp-server.md` § Appendix first
- `../server/src/vendor/shared/**` from here — it is the server's, and editing it
  obliges the mirror edit in `client/src/vendor/shared`

## Read when

- You are starting anything in this package → read `INSIGHTS.md`, then the root one
- You need how to run, register or debug the server → read `README.md`
- You are deciding which skills a change here routes to → read
  `../.claude/skills/pr-self-review/SKILL.md` § 3, the repo's one path → skills table.
  It is pointed at, never copied
- You are unsure where a piece of code belongs → skill `onion-architecture` for the
  pattern; the ring table above is the local rule, and no tooling enforces it
