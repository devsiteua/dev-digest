# `@devdigest/mcp` — DevDigest as five MCP tools, and one CLI

A **Model Context Protocol** server over stdio that lets an agent — Claude Code,
the MCP Inspector, any MCP client — drive DevDigest without a browser and without
knowing a single internal UUID: *"run the Security Reviewer over
acme/payments-api#482 and tell me what it found"*, one tool call, waited to
completion.

It is a **delivery adapter in its own process, not a second backend**. Everything
it does goes over HTTP to `@devdigest/api` on `:3001`, which must already be
running. No database, no Drizzle, no secrets, no migrations — and no credentials
either: local DevDigest runs on `LocalNoAuthProvider`, one workspace, no token.

```
Claude Code ──stdio(JSON-RPC)──▶ @devdigest/mcp ──HTTP──▶ @devdigest/api :3001 ──▶ Postgres
```

## The five tools

Exactly five, no more and no fewer. Every argument is a flat scalar; `repo` is
always `owner/name` and `pr` is always the number the hosting platform shows.

| Tool | Arguments | What it does |
|---|---|---|
| `list_agents` | — | Lists the configured reviewer agents with `name`, `slug`, `provider`, `model`, `enabled`, `description`. The only source of a valid `agent` value — call it first instead of guessing. Costs nothing. |
| `run_agent_on_pr` | `repo`, `pr`, `agent`, `response_format?` | Starts one agent's review, **waits** for it, and returns the finished verdict, score and findings. One blocking call, no separate start/poll tool. **Spends a real model call.** |
| `get_findings` | `repo`, `pr`, `agent?`, `response_format?`, `limit?` | Re-reads a review that already ran. Spends nothing, starts nothing. Omit `agent` for the most recent review, whose agent is named in the answer. |
| `get_conventions` | `repo`, `response_format?`, `limit?` | Returns the **accepted** house rules the L02 extractor stored, each with its `file:line` evidence, plus the pending/rejected counts. Never runs the extractor (that spends money). |
| `get_blast_radius` | `repo`, `pr` | Returns what a pull request's diff can reach: the symbols its changed files declare, the call sites that reach them, and the endpoints and scheduled jobs downstream of those. Read from DevDigest's static index — no model call, no review started. `status`/`reason` say how far the map is to be trusted, so an empty `downstream` is never read as "this pull request affects nothing". |

`response_format` is `"concise"` (default) or `"detailed"`. Concise findings carry
`severity`, `file`, `line`, `title`; detailed adds `rationale`, `suggestion`,
`confidence`, `category` and `id`, and is materially larger. Truncation is never
silent: a response that dropped entries reports the untruncated total beside the
list (`total_findings` for a review, `accepted` for conventions). `get_blast_radius`
takes neither and truncates nothing — there is no field in its payload that could
report a dropped caller, and the server already caps the map at 20 callers per
changed symbol.

Two behaviours worth knowing before an agent surprises you with them:

- **`run_agent_on_pr` waits up to 120 s** (`DEVDIGEST_MCP_RUN_TIMEOUT_MS`). A run
  that is still going when that expires comes back as `status: "still_running"`
  with the real run id — the run is healthy and continuing, and the answer is
  collected later with `get_findings`. Calling `run_agent_on_pr` again would
  start a **second paid run**.
- **`agent` is required** on `run_agent_on_pr`, and `{ all: true }` is never
  sent. One "review with everything" call bills every enabled agent.

## Prerequisites

```sh
cd mcp && pnpm install          # once — the client spawns tsx from node_modules
./scripts/dev.sh                # from the repo root: Postgres → migrate → seed → API + web
```

`./scripts/dev.sh` does **not** start this server and does not know about it —
the MCP server is spawned by its client. It also does not have to be running when
the client starts: with nothing on `:3001` every tool returns an error naming
`./scripts/dev.sh`, and the process stays alive and answers the next call.

There is **no `build` script and no `dist/`**: `tsconfig.json` is `noEmit`, and
this package runs from TypeScript source through `tsx`, the same way `server/`
does in dev. Running it is therefore `pnpm --dir mcp exec tsx src/index.ts` from the
repository root, or `pnpm exec tsx src/index.ts` from `mcp/`.

## Configuration

Two variables, both read in `src/config.ts` and nowhere else. Nothing loads
`.env` — there is no dotenv dependency, because the **client** passes the
environment (the `env` block of `.mcp.json`, or an inline assignment).
`.env.example` documents the names; it is not read.

| Variable | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Where the DevDigest API is listening. A malformed value fails at startup rather than falling back. |
| `DEVDIGEST_MCP_RUN_TIMEOUT_MS` | `120000` | How long `run_agent_on_pr` waits before reporting the run as still running. Set it to `1` to exercise the timeout branch. |

## Registering it with Claude Code

The repository ships [`.mcp.json`](../.mcp.json) at its root — **project scope**,
committed, so anyone who clones the course repo gets the server:

```json
{
  "mcpServers": {
    "devdigest": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["--dir", "mcp", "exec", "tsx", "src/index.ts"],
      "env": { "DEVDIGEST_API_URL": "http://localhost:3001" }
    }
  }
}
```

> **Approve it on the first session.** A project-scope server from `.mcp.json`
> is not connected until you approve it — until then `claude mcp list` shows
> `devdigest` as `⏸ Pending approval` and no `mcp__devdigest__*` tool exists.
> Claude Code asks on the first session in the project; `claude mcp get devdigest`
> reports what it has.

Notes on that entry, because both are easy to get wrong:

- A stdio entry is `{ type, command, args, env, envHelper, envHelperTtlSec }` —
  **there is no `cwd` field**, and `command` must be a bare name or an absolute
  path (no `~`, no `..`). The relative `--dir mcp` therefore relies on the spawn
  working directory being the project root.
- If that ever stops holding, do not commit a broken entry: register it locally
  with an absolute path instead —
  `claude mcp add devdigest --scope local --env DEVDIGEST_API_URL=http://localhost:3001 -- pnpm --dir /absolute/path/to/dev-digest/mcp exec tsx src/index.ts`.

## When it will not connect — start with the Inspector

The **first** debugging step is always the MCP Inspector, never a Claude Code
session: it drives the server over stdio with no model in the loop, so a protocol
fault is never diagnosed as a model mistake.

```sh
# from the repository root
pnpm dlx @modelcontextprotocol/inspector -- pnpm --dir mcp exec tsx src/index.ts
```

It should connect, list exactly five tools with their annotations and
`outputSchema`, and run `list_agents`, `get_conventions` and `get_blast_radius`.
Drive `get_blast_radius` twice: once against an indexed repository, where it must
answer `status: "ok"` with callers and endpoints, and once against a repository
with no index, where it must answer `status: "degraded"` and `isError: false` —
"nothing was analysed" is a result, not a failure. Both runs also prove the
`outputSchema` holds, because the Inspector's client validates with ajv and
rejects the whole result when it does not.

If the Inspector is happy and Claude Code is not, the problem is registration or
approval, not the server.

**Everything this server says about itself is on stderr.** On the stdio transport
stdout *is* the JSON-RPC channel, so a single stray `console.log` corrupts the
stream and the client drops the connection — a server that "does not appear",
with the reason visible only in the client's stderr pane. Diagnostics are
`console.error` through `src/log.ts`, prefixed `[devdigest-mcp]`; the Inspector
shows them, and so does `claude --debug`.

## `devdigest review` — the CLI

A **second entry point**, `src/cli.ts`, reviewing the working tree instead of a
pull request.

```sh
cd mcp
pnpm review -- --help
pnpm review -- --agent security-reviewer
```

It runs `git rev-parse --show-toplevel`, then `git diff HEAD`, posts that diff to
`POST /reviews/working` and prints `severity · path:line · title`. The server
runs the same engine and the same input builders a pull-request review runs, and
persists nothing — a working-tree review is stale the moment you save the file.

**Untracked files are excluded.** `git diff HEAD` does not show them, so a file
you have never `git add`ed is invisible to the review; `git add -N <file>` makes
it visible without staging its contents. `--help` says so, because it is the one
way this command can quietly review less than you believe.

**Exit codes are a contract:** `0` the review ran and found nothing blocking,
`1` it found at least one blocking finding, `2` it could not run at all.
"Blocking" is the server's count against the agent's `ci_fail_on` — never
re-derived here, or the CLI and the studio would disagree the first time somebody
changed that threshold.

`--mode` takes `working` (the default), `staged` or `branch`. Only `working` is
implemented; the other two parse and then fail with "not implemented", so the
spelling is fixed before the feature is.

**stdout here is a terminal, not a transport.** The no-stdout rule is scoped to
`src/index.ts` and the paths it reaches — see [`CLAUDE.md`](CLAUDE.md)
§ Conventions.

## Tests

```sh
cd mcp && pnpm test        # hermetic: fetch is injected and stubbed, no network, no stack
cd mcp && pnpm test:live   # needs the API on :3001; SKIPS cleanly when it is not there
cd mcp && pnpm typecheck   # compiles against server/src/vendor/shared — the drift guard
```

The unit lane spawns the real process for the surface and stdout-purity checks
and stubs `fetch` everywhere else. The live lane (`test/*.live.test.ts`) talks to
a running API, is excluded from the default lane by `vitest.config.ts`, and
self-skips when `GET /health` is unreachable — the same shape as `server/`'s
`*.it.test.ts` lane skipping without Docker. It deliberately never starts a paid
review: a full end-to-end review is a manual acceptance step.

`pnpm typecheck` matters more here than in most packages: **no CI workflow covers
`mcp/`**, so it is the only thing that notices when a `@devdigest/shared`
contract changes shape underneath this package.

## Layout

| Path | Ring | What |
|---|---|---|
| `src/index.ts`, `src/server.ts`, `src/tools/` | Delivery | the MCP protocol shape — tools, content blocks, `structuredContent`, annotations |
| `src/cli.ts` | Delivery | the other entry point: a terminal, an exit code, and the only stdout writes in the package |
| `src/api/`, `src/cli/git.ts` | Infrastructure | the only places that reach outside: HTTP, and two `git` subprocesses |
| `src/shape/`, `src/cli/args.ts`, `src/cli/render.ts`, `src/schemas.ts`, `src/errors.ts`, `src/copy.ts` | Pure | DTO projections, tool schemas, flag parsing, the exit-code rule, error text — nothing awaits |
| `src/config.ts` | Composition | the only `process.env` read in the package |

The rules that keep those rings honest — and the reason contracts are imported as
types only — are in [`CLAUDE.md`](CLAUDE.md).
