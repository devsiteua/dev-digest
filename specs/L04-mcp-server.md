# L04 — `devdigest-mcp`: a local MCP server over the DevDigest API

Status: draft
Owner: devsiteua
Packages touched: mcp (new) · server

## Goal

An agent running in Claude Code (or any MCP client) can, without a browser and
without knowing a single DevDigest UUID, ask *"run the Security Reviewer over
acme/payments-api#482 and tell me what it found"* and get back a short structured
verdict with findings — one tool call, waited to completion. It can also list the
configured reviewer agents, re-read a finished run's findings, and read the repo's
extracted conventions. Blast radius is declared, addressable, and honestly
not-implemented.

## Context

Everything the five tools need is already served by `@devdigest/api` on :3001.
This lesson adds a **delivery adapter in its own process**, not a second backend.

What exists and is being wrapped:

- `GET /agents`, `GET /agents/:id` — `server/src/modules/agents/routes.ts:74`. The
  `Agent` contract carries `id` (uuid), `name`, `description`, `provider`, `model`,
  `enabled` — **no slug column**
  (`server/src/vendor/shared/contracts/knowledge.ts:363`).
- `POST /pulls/:id/review` with `{ agentId }` or `{ all: true }` —
  `server/src/modules/reviews/routes.ts:27`. **Fire-and-forget**: it creates the
  `agent_runs` rows, returns `{ pr_id, runs, reviews: [] }` immediately, and
  `ReviewService.runReview` (`service.ts:103`) fires `executor.executeRuns` in the
  background. Rate limited to 10/min. The empty `reviews` array is correct and must
  not be "fixed" (`server/CLAUDE.md` § Gotchas; `server/INSIGHTS.md` 2026-08-01).
- `GET /pulls/:id/runs` → `RunSummary[]` (`contracts/trace.ts:114`) with `status`
  (`running | done | failed | cancelled`), `error`, `score`, `blockers`,
  `findings_count`. Described in the service as the *server-side source of truth*
  (`service.ts:63,69`). `GET /pulls/:id/runs/active` is the in-flight subset.
- `GET /runs/:id/events` — SSE, `GET /runs/:id/trace` — the persisted trace doc.
- `GET /pulls/:id/reviews` → `ReviewRecord[]` with `findings[]`
  (`reviews/routes.ts:129`), ordered `desc(created_at)` **and nothing else**
  (`repository/review.repo.ts:66`).
- `GET /repos` → `Repo[]` carrying `owner`, `name`, `full_name`
  (`contracts/platform.ts:143`) — resolves `owner/name` → repo id with **no GitHub
  call**.
- `GET /repos/:id/pulls` — resolves a PR number, but **calls GitHub on every
  request** and backfills diff stats (`pulls/routes.ts:33-118`). Local-first, but
  slow and network-dependent.
- `GET /repos/:id/conventions` — the L02 extractor's stored candidates
  (`conventions/routes.ts:55`), all statuses, ordered
  `desc(created_at), desc(confidence), asc(id)` (`conventions/repository.ts:81`).
  `POST /repos/:id/conventions/extract` **spends money** and is rate limited.
- Auth is `LocalNoAuthProvider`: one seeded workspace, no token, no login
  (`server/src/modules/_shared/context.ts:10-22`). The MCP server needs **no
  credentials**.
- Error envelope is stable: `{ error: { code, message, details } }`
  (`contracts/platform.ts:279`, `platform/errors.ts`).
- `repo-intel` and `server/src/db/schema/repo-intel.ts` exist and are untouched here;
  the real blast radius reads them in a later pass.

**There is no endpoint that resolves `owner/name` + PR number → internal pull id.**
Closing that gap is Step 3, and it is the one step designed to be droppable.

Design reference: not applicable. This lesson creates no UI surface, so the
`design-reference` skill is not routed to any step.

## In scope

- A new top-level package **`mcp/`** (`@devdigest/mcp`), stdio transport, a thin
  HTTP client of the running API at `DEVDIGEST_API_URL` (default
  `http://localhost:3001`). No DB connection, no Drizzle, no secrets, no migrations.
- **Exactly five tools**, no more and no fewer:

  | Tool | Arguments (all flat scalars) | Returns |
  |---|---|---|
  | `list_agents` | — | `{ agents: [{ id, name, slug, provider, model, enabled, description }] }` |
  | `run_agent_on_pr` | `repo`, `pr`, `agent`, `response_format?` | create-run → wait → `{ verdict, score, summary, findings[], run }` |
  | `get_findings` | `repo`, `pr`, `agent?`, `response_format?`, `limit?` | the same projection for an already-finished run |
  | `get_conventions` | `repo`, `response_format?`, `limit?` | `{ repo, accepted, pending, rejected, conventions[] }` |
  | `get_blast_radius` | `repo`, `pr` | `isError: true` + `{ status: "not_implemented", … }` |

- The tool-surface discipline: `outputSchema` + `structuredContent` on every tool,
  a serialized JSON text block alongside for backwards compatibility, annotations
  (`readOnlyHint: true` on the four reads; `run_agent_on_pr` is
  `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true`), one short
  `instructions` paragraph on the server, dense keyword-rich descriptions each
  carrying 1–5 inline usage examples.
- The **wait**: polling `GET /pulls/:id/runs` until the run's row is terminal, with
  a bounded timeout that reports the run's real state rather than a verdict.
- One small **read-only** server endpoint resolving `owner/name#number` → pull id
  (Step 3, droppable).
- **A launch that is independent of `./scripts/dev.sh`.** The MCP server is started by
  its own client (Claude Code, or the Inspector), never by the repo's dev script. `dev.sh`
  brings up Postgres → migrate → seed → API + web (`scripts/dev.sh:5,105-113`) and must end
  this lesson unchanged.
- **Verification through the MCP Inspector before Claude Code.** `pnpm dlx
  @modelcontextprotocol/inspector` (v2.4.0, bin `mcp-inspector`) drives the server over stdio
  with no LLM in the loop, so a protocol fault is separated from a model's judgement. It is
  the first gate; the Claude Code session is the second.
- `.mcp.json` at the repo root (project scope), `mcp/README.md`, `mcp/CLAUDE.md`,
  `mcp/INSIGHTS.md`, and the repo maps that would otherwise omit a fifth package.
- Tests in two lanes: hermetic unit + protocol tests, and `*.live.test.ts` that need
  a running API and self-skip without one.

## Out of scope

- **Real blast-radius computation.** `get_blast_radius` is a declared stub. No
  `repo-intel` read, no new server module, no `BlastRadius` contract change
  (`contracts/brief.ts:113` already exists and stays untouched).
- **HTTP / SSE / remote transport and any auth.** stdio only. Adding a second
  transport means an auth story, and `LocalNoAuthProvider` has none.
- **MCP resources and prompts.** Tools only in this pass.
- **`list_repos` and `list_prs`.** Deliberate, and for a reason worth writing down: that
  data is already reachable through `gh` and the official GitHub MCP server. Duplicating it
  would add two schemas — paid for in every session that loads them — and no new capability.
  `list_agents` survives the same test because the reviewer configuration exists **only** in
  DevDigest. The `GET /pulls/lookup` route of Step 3 is not a counter-example: it is an
  internal id resolution, not a listing tool, and it is never exposed as one.
- **A sixth tool.** In particular: nothing that triggers
  `POST /repos/:id/conventions/extract` (it spends money) and nothing that imports a
  repo or a PR. `get_conventions` reads what the extractor already stored.
- **Any `client/` change.** No UI shows the MCP server.
- **Changing the review engine**, the prompt, `reviewer-core`, or the run executor.
- **A GitHub Actions workflow for `mcp/`.** The four suites in `TESTING.md` are
  path-filtered per package and `mcp/` type-checks against `server/src/vendor/shared`
  — wiring that filter correctly is its own change. Named in Risks; not built here.
- **Consuming the SSE stream.** Decided against (see Decisions), not deferred.
- **Turning `POST /pulls/:id/review` synchronous.** The wait lives in `mcp/`.

## Decisions taken

Each decision is recorded with the repo fact that forced it.

**D1 — `mcp/` borrows `@devdigest/shared`; it does NOT get a third copy.**
`reviewer-core/tsconfig.json:21-24` already aliases `@devdigest/shared` to
`../server/src/vendor/shared/index.ts` and pins its own `zod` alongside;
`reviewer-core/vitest.config.ts:6-9` does the same for the test run. `mcp/` copies
that pattern exactly. Root `CLAUDE.md` § Gotchas records that the two existing copies
have already drifted — a third would be a third drift front, and
`scripts/pr-self-review-checks.sh` `check:contract-mirror` only knows about two.

**D2 — `mcp/` imports the contracts as TYPES ONLY.**
`import type { Agent, ReviewRecord, RunSummary, ConventionCandidate, Repo, PrMeta }
from '@devdigest/shared'`. Type-only imports are erased, so at runtime `mcp/` never
resolves the alias and never loads the server's `zod`. Three reasons, all from this
repo: (a) `server/CLAUDE.md` § Gotchas records that duplicate `zod` module instances
already make `instanceof z.ZodError` unreliable — a second cross-package zod instance
would extend that trap into a new package; (b) the shared module lives under
`server/src/`, so a runtime import resolves `zod` from `server/node_modules`, making
`mcp/` silently depend on the server package being installed; (c) `tsc` emits `dist/`
with no trace of the alias, so a build needs no path-rewriting step.
The cost, stated plainly: **`mcp/` does not re-validate API responses at runtime.**
The guard is `cd mcp && pnpm typecheck`, which compiles against the server's contract
source in the same repository — a shape change breaks it. `mcp/`'s own `zod`
dependency is used only for MCP tool input/output schemas, which are shapes `mcp/`
owns. Enforced structurally: `verbatimModuleSyntax: true` in `mcp/tsconfig.json`, and
a grep in the Step 1 verification.

**D3 — pnpm, and vitest.**
Root `CLAUDE.md` names pnpm as the primary manager and `scripts/dev.sh:39` hard-fails
without it, so pnpm is already a prerequisite of running this repo at all.
`reviewer-core`/`e2e` use npm because they are, respectively, a type-checked-only
library and a thin runner; `mcp/` is a long-running process with real dependencies
and a lockfile that matters — the same shape as `server/`, which uses pnpm. Test
runner is vitest, which every package in the repo already uses.

**D4 — the wait polls `GET /pulls/:id/runs`; it does not consume SSE.**
Three reasons: (a) `RunBus` is in-memory and a restart loses the live log
(`server/CLAUDE.md` § Gotchas), so an SSE consumer can block forever on a run whose
process died — `server/INSIGHTS.md` 2026-08-01 records exactly that failure, and its
answer is "check `agent_runs.status` in the DB"; (b) the run row is described in code
as the source of truth that survives reload (`reviews/service.ts:63,69`); (c) the
repo's own integration tests already wait this way — `server/test/helpers/runs.ts`
`waitForPrRuns` polls `agent_runs` for a terminal status. Polling also needs nothing
beyond `fetch`, where SSE needs a stream parser in the dependency tree.

**D5 — `run_agent_on_pr` blocks; poll cadence 2 s for the first 60 s, then 5 s;
default ceiling 120 s.**
The tool is deliberately **blocking** — one call in, a finished verdict out (the
"outcome, not operation" principle). `server/src/app.ts:96` registers a **global**
rate limit of 120 requests/minute, so a 1 s poll would spend half of it. This cadence
is ≤ 30 req/min, and a full 120 s wait costs ~42 requests. Ceiling is
`DEVDIGEST_MCP_RUN_TIMEOUT_MS` (default **120000**) — an env constant, not a tool
argument, so the tool keeps three semantic scalars and no speculative optional field.

Two consequences of 120 s that the implementer must design *for*, not around:

- **120 s aligns with the client, not just with taste.** Claude Code backgrounds an
  MCP call that runs past `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (default ~2 minutes).
  A ceiling at 120 s returns on the tool's own terms instead of being backgrounded
  mid-poll. The loop must therefore return *before* crossing it: check the deadline
  **before** sleeping, never after, so the last sleep cannot overshoot.
- **The timeout path stops being an edge case.** A real multi-file LLM review can
  exceed two minutes, so `status: "still_running"` is an ordinary outcome, not a
  failure. That raises the bar on D6's text: it must read as "the run is healthy and
  still going, collect it with this exact call" — never as an error the model should
  retry by starting a second run. The unit lane asserts the wording names
  `get_findings` and does **not** name `run_agent_on_pr`.

**D6 — on timeout the tool tells the truth and hands the caller a next step.**
`server/test/helpers/runs.ts` returns the rows it has when its timeout expires, and
`server/INSIGHTS.md` 2026-08-07 records the consequence: *"when a wait helper is
allowed to return without meeting its condition, every downstream assertion becomes a
liar"*. So the timeout path returns `isError: true` with
`{ status: "still_running", run_id, waited_seconds }` and text naming the exact
follow-up call (`get_findings` with the same `repo`/`pr`/`agent`). It never returns a
verdict, and never returns an empty `findings` array.

**D7 — "latest review" is never `reviews[0]`.**
`reviewsForPull` orders by `desc(created_at)` only
(`repository/review.repo.ts:66`), and root `CLAUDE.md` § Gotchas records that
`defaultNow()` is the **transaction's** timestamp — three agents from one `all: true`
review share it to the microsecond, so the order among them is planner order.
Therefore: `run_agent_on_pr` selects its review by the `run_id` it was handed;
`get_findings` filters `kind === 'review'` (summaries excluded), narrows by `agent`
when given, and picks the newest with the tie-break `pulls/routes.ts:140` already
uses — `created_at` desc, then `id` desc. With no `agent`, it returns the newest
single review and names the agent it came from, matching the product's own
latest-review-only rule (root `INSIGHTS.md` 2026-08-02 — a third surface must pick
one on purpose).

**D8 — `agent` accepts a name, a derived slug, or a uuid; `list_agents` publishes the
slug it minted.** There is no slug column
(`contracts/knowledge.ts:363`), so the slug is derived in `mcp/` by kebab-casing
`name`. A derived identifier with no server owner is a drift risk, which is why the
tool that mints it is also the tool that returns it: the model never has to guess the
token. Matching is case-insensitive, tries exact name → slug → uuid, and an ambiguous
match is an error listing the candidates, never a silent first-match.

**D9 — `agent` is required on `run_agent_on_pr`.** `{ all: true }` exists on the
endpoint, but `server/INSIGHTS.md` 2026-08-06 records that `agents.enabled` is the
membership test for the fan-out and therefore a **per-run cost multiplier**: one
`all` call bills every enabled agent. A tool that can spend N model calls from one
under-specified argument is not a tool an agent should be handed. `list_agents`
reports `enabled` and states that a disabled agent is still runnable by name.

**D10 — `.mcp.json` at project scope, committed.** The whole repository is a course
artefact others clone and run, so the registration belongs beside the code.
Consequence to document: the Claude Code CLI shows unapproved `.mcp.json` servers as
`⏸ Pending approval` and does not connect until they are approved
(`claude mcp list --help`).

**D11 — layering inside `mcp/`, stated in the vocabulary of `onion-architecture`.**
That skill declares its scope as `server/**` and `reviewer-core/**`, so it does not
claim `mcp/**`; the pattern is read from it, the rule is written here.

| Ring | Path | May do | Must not |
|---|---|---|---|
| Delivery | `src/tools/*.ts`, `src/server.ts`, `src/index.ts` | know the MCP protocol shape — content blocks, `structuredContent`, `isError`, annotations | call `fetch`, read `process.env` |
| Infrastructure | `src/api/*.ts` | `fetch`, HTTP status → error mapping, polling | know anything about MCP |
| Pure | `src/shape/*.ts`, `src/schemas.ts`, `src/errors.ts` | transform DTOs, build error text | `await` anything |
| Composition | `src/config.ts` | the **only** `process.env` read | — |

This is the same split as `routes.ts` / `repository.ts` / `helpers.ts`, and it is
checkable by grep rather than by argument (see each step's `Verify`).

**D12 — stdout is the JSON-RPC channel.** No `console.log`, `console.info` or
`console.debug` anywhere in `mcp/src`. Logging is `console.error` (stderr) only,
behind one `log()` helper. Grep-checked and unit-tested.

**D13 — the stub is loud.** `get_blast_radius` makes **no** API call and returns
`isError: true` with `{ status: "not_implemented", implemented_in: "L04 part two",
message: … }`. It emits no `changed_symbols` / `downstream` keys at all — an empty
array would be the exact lie the tool exists to avoid. Its argument list is already
the final one (`repo`, `pr`), so implementing it later changes no signature.

**D14 — the SDK is `@modelcontextprotocol/server@2.0.0`, and `mcp/` therefore runs
Zod 4.**
Verified against the registry and the published typings, not assumed. Two packages
exist: `@modelcontextprotocol/sdk@1.30.0` (the older line, `zod: ^3.25 || ^4.0`) and
`@modelcontextprotocol/server@2.0.0`, published 2026-07-28 and the one the official
"Build an MCP server" guide now uses. Its dependency is `zod: ^4.2.0`; its exports are
`.`, `./stdio`, `./validators/ajv`, `./validators/cf-worker`, `./_shims`.

The API is settled, so Step 2 confirms rather than discovers:

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

server.registerTool(
  'calculate-bmi',
  {
    title: 'BMI Calculator',
    description: '…',
    inputSchema: z.object({ weightKg: z.number(), heightM: z.number() }),
    outputSchema: z.object({ bmi: z.number() }),
  },
  async ({ weightKg, heightM }) => {
    const output = { bmi: weightKg / (heightM * heightM) };
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
  },
);
```

`registerTool(name, { title?, description?, inputSchema?, outputSchema?, annotations?,
icons?, _meta? }, cb)` — so `outputSchema`, `structuredContent` and `annotations` are
all first-class, and every acceptance criterion that assumes them holds. Schemas are
Standard Schema (`~standard`), which **Zod 4 implements and Zod 3 does not**. The
raw-shape form (`inputSchema: { field: z.string() }`) is deprecated: always wrap in
`z.object({…})`.

**The consequence D3 did not foresee: `mcp/` is on Zod 4 while `server` and
`reviewer-core` are on `zod@^3.24.1`.** D2 is what makes that safe at runtime — no
shared schema is ever executed in `mcp/`. But it puts one thing at risk that Step 1
must settle empirically rather than by argument: the `@devdigest/shared` alias makes
`tsc` compile the server's **Zod 3** contract source while `mcp/tsconfig.json` pins
`zod` to its own **Zod 4**. If `cd mcp && pnpm typecheck` fails for that reason, in
order:

1. Drop the alias and declare, in `mcp/src/api/types.ts`, narrow local aliases for the
   six response shapes `mcp/` reads. Costs the compile-time coupling D2 was bought
   for; the live lane becomes the guard. State it in `mcp/CLAUDE.md`.
2. Or fall back to `@modelcontextprotocol/sdk@1.30.0` with `zod@^3.25`, which restores
   the `reviewer-core` pattern exactly — at the cost of building on the SDK line the
   official guide has moved off.

Do not choose between these up front. Step 1's verification decides in one command.

## Acceptance criteria

- [ ] `cd mcp && pnpm typecheck` passes, and `grep -rn "from '@devdigest/shared'"
      mcp/src` shows **only** `import type` lines (D2).
- [ ] `mcp/src/vendor/` does not exist; `find mcp -name 'shared' -type d` is empty (D1).
- [ ] `grep -rn "console\.\(log\|info\|debug\)" mcp/src` returns nothing (D12).
- [ ] `grep -rn "fetch(" mcp/src/tools mcp/src/shape` returns nothing, and
      `grep -rln "process\.env" mcp/src` returns only `mcp/src/config.ts` (D11).
- [ ] Spawning the server and sending `initialize` + `tools/list` returns **exactly
      five** tools: `list_agents`, `run_agent_on_pr`, `get_findings`,
      `get_conventions`, `get_blast_radius` — and nothing else.
- [ ] Every tool declares an `outputSchema`; every result carries both
      `structuredContent` and a JSON text block; the four read tools carry
      `readOnlyHint: true` and `run_agent_on_pr` carries `readOnlyHint: false`,
      `destructiveHint: false`, `openWorldHint: true`.
- [ ] No tool's input schema contains a nested object; every property is a string,
      number, boolean or enum.
- [ ] The server's `instructions` string is one paragraph (≤ 600 characters), and
      every tool description is non-empty, ≤ 1200 characters, and contains at least
      one worked example call.
- [ ] The `instructions` string and all five descriptions are **byte-identical to the
      Appendix** of this spec, held in `mcp/src/copy.ts`. `copy.test.ts` fails on any
      drift, whitespace included. If a string genuinely needs to change, the Appendix
      changes first and the code follows — never the other way round.
- [ ] With the stack up: `list_agents` returns the five seeded agents including
      `General Reviewer` with slug `general-reviewer`.
- [ ] With the stack up: `run_agent_on_pr(repo: "acme/payments-api", pr: 482, agent:
      "general-reviewer")` returns a `verdict` and a `findings[]` whose entries carry
      `severity`, `file`, `line`, `title` — and, in `concise` form, no `rationale`
      and no `suggestion`.
- [ ] `response_format: "detailed"` on the same call adds `rationale`, `suggestion`,
      `confidence`, `category` and `id`, and produces a materially larger payload;
      concise is the default.
- [ ] `get_findings` on the same PR immediately afterwards returns the same verdict
      without starting a run (`GET /pulls/:id/runs` shows no new row).
- [ ] **Degraded — API down.** With nothing on :3001, every tool returns
      `isError: true` and text naming `./scripts/dev.sh`. No stack trace, no unhandled
      rejection, and the process stays alive and answers the next call.
- [ ] **Degraded — unknown agent.** `agent: "securty"` returns `isError: true` with
      text that names `list_agents` and lists the available names. Not "404".
- [ ] **Degraded — unknown repo / PR.** `repo: "acme/nope"` and
      `pr: 99999` each return `isError: true` naming what to do next (add the repo in
      DevDigest / open the repo's PR list so the PR is imported).
- [ ] **Degraded — timeout.** With `DEVDIGEST_MCP_RUN_TIMEOUT_MS=1`,
      `run_agent_on_pr` returns `isError: true`, `status: "still_running"`, the real
      `run_id`, and no `verdict` and no `findings` key (D6).
- [ ] **Degraded — failed run.** A run that reaches `failed` returns `isError: true`
      carrying the row's `error` text — never an empty findings list.
- [ ] **Degraded — no conventions.** On a repo with no extracted candidates,
      `get_conventions` returns `isError: false` with `accepted: 0` and text saying
      the extractor has not run, explicitly naming that as different from "this repo
      has no conventions". It never calls `POST /repos/:id/conventions/extract`.
- [ ] **Stub.** `get_blast_radius` returns `isError: true`,
      `status: "not_implemented"`, makes no HTTP request (asserted against a stubbed
      fetch), and its structured payload contains no `changed_symbols` key.
- [ ] `limit` truncation is never silent: a response that dropped findings reports
      `total_findings` greater than the returned count.
- [ ] **Unchanged.** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
      and `pnpm exec vitest run .it.test` stay green; `pnpm arch:check` prints an
      empty violation list (read the output, not the exit code — root `INSIGHTS.md`
      2026-08-22).
- [ ] **Unchanged.** `cd client && pnpm test && pnpm typecheck` untouched and green;
      `git diff --name-only main -- client/` is **empty** — no contract was minted, so the
      mirror never had to move.
- [ ] `GET /pulls/lookup` returns a `PrMeta` that `PrMeta.parse()` accepts, built from the
      persisted row with the container's GitHub client mocked to throw if touched.
- [ ] **Independent launch.** `git diff --name-only main -- scripts/` is empty: `dev.sh`
      neither starts nor knows about `mcp/`. The server runs when a client spawns it, and
      the API being down is a tool-level error, not a startup crash.
- [ ] **Inspector gate.** `pnpm dlx @modelcontextprotocol/inspector` connects over stdio,
      lists exactly five tools with their annotations and `outputSchema`, and executes
      `list_agents`, `get_conventions` and `get_blast_radius` successfully — all before any
      Claude Code session is opened.
- [ ] **The end-to-end scenario, which is what this lesson is actually graded on.** In a
      Claude Code session, "review PR #482 in acme/payments-api with the Security Reviewer
      and tell me whether there are any critical findings" drives
      `list_agents` → `run_agent_on_pr` → `get_findings`, and the answer quotes **DevDigest's
      own findings** — same severities, same `file:line` — not the model's own reading of the
      diff. Cross-check the reply against the same PR in the web UI.
- [ ] `claude mcp get devdigest` reports the server, and after approval a session
      exposes `mcp__devdigest__list_agents`.

## Test plan

Two lanes in `mcp/`, plus one existing lane in `server/`.

| Lane | Files | Needs | Command |
|---|---|---|---|
| mcp unit | `mcp/test/*.test.ts`, `mcp/src/**/*.test.ts` | nothing — `fetch` is injected and stubbed | `cd mcp && pnpm test` |
| mcp live | `mcp/test/*.live.test.ts` | a running API on :3001 | `cd mcp && pnpm test:live` |
| server integration | `server/test/pulls-lookup.it.test.ts` | Docker | `cd server && pnpm exec vitest run .it.test` |

- **Why a new `*.live.test.ts` suffix rather than `*.it.test.ts`.** Root `CLAUDE.md`
  ties `*.it.test.ts` to "a test that touches the DB", and CI splits the `server/`
  lanes on that glob. An `mcp/` test needs a running **API**, not a database, and no
  workflow selects `mcp/**` at all. Reusing the suffix would make the repo's one
  crisp naming rule mean two things. The live lane self-skips when `GET /health` is
  unreachable, mirroring how the `.it.test` lane self-skips without Docker
  (`TESTING.md` § "What each suite covers").
- **Unit lane covers:** the slug/name/uuid agent resolver including the ambiguous
  case; the concise/detailed projections including the `limit` + `total_findings`
  rule; the latest-review selection with two reviews sharing a `created_at` (D7 —
  the fixture must reproduce the tie); error-text construction for every business
  failure; the config default; the `tools/list` surface (five names, annotations,
  `outputSchema`, description length, no nested input objects); the stub's
  "no HTTP call" assertion; and a stdout-purity test that spawns the process and
  asserts every stdout line parses as JSON-RPC.
- **Live lane covers:** `list_agents` against the seeded workspace,
  `get_conventions` on a repo with no candidates, and `run_agent_on_pr` with
  `DEVDIGEST_MCP_RUN_TIMEOUT_MS=1` to exercise the timeout branch without spending a
  model call. A full paid review is a manual acceptance step, not a CI test — the
  same reasoning `server/INSIGHTS.md` 2026-08-01 gives for run-related UI.
- **Server lane:** `pulls-lookup.it.test.ts` covers the happy path, an unknown
  `owner/name`, an un-imported PR number, and workspace scoping. It must assert the
  route makes **no** GitHub call (the container's GitHub client stays a mock that
  fails if touched — `server/src/adapters/mocks.ts`).

## Risks

- **`tsx` + a cross-package tsconfig path at runtime is unproven here.** No existing
  process resolves `@devdigest/shared` from outside `server/`. D2 removes the risk by
  making every such import type-only, but the implementer must *see* it: Step 1's
  verification runs the entry point with `server/node_modules` present and confirms
  `mcp/dist` (or the tsx run) contains no `@devdigest/shared` specifier. If a runtime
  import sneaks in, the failure mode is a module-not-found at MCP handshake — i.e. a
  server that never appears in the client, with the reason on stderr only.
- **`.mcp.json` has no `cwd` field.** The installed Claude Code build validates a
  stdio entry as `{ type, command, args, env, envHelper, envHelperTtlSec }` — there
  is no `cwd`, and `command` must be a bare name or an absolute path (no `~`, no
  `..`). So the committed entry's relative args depend on the spawn cwd being the
  project root. Step 7 verifies that empirically rather than assuming it; if it does
  not hold, the fallback is a `local`-scope registration with an absolute path plus a
  documented `claude mcp add` line in `mcp/README.md`.
- **~~The MCP SDK's API surface is not pinned~~ — resolved.** Verified against the
  registry and the published typings: `@modelcontextprotocol/server@2.0.0`,
  `registerTool` with `outputSchema` / `structuredContent` / `annotations`, Standard
  Schema over Zod 4 (D14). The residue is version drift, not ignorance: pin the exact
  version, do not float a caret into a major.
- **Zod major mismatch — now a certainty, not a possibility.** `mcp/` runs Zod 4;
  `server` and `reviewer-core` run `zod@^3.24.1`. Safe at runtime **only** because of
  D2: no shared schema is ever executed in `mcp/`. Two live consequences. (a) If D2 is
  ever relaxed, this is a correctness bug, not a nuisance — `server/CLAUDE.md` already
  records that duplicate Zod instances make `instanceof z.ZodError` unreliable, and
  across a major that gets worse. (b) At **compile** time the alias still points `tsc`
  at Zod 3 source from a Zod 4 package; D14 names the fork and Step 1 resolves it.
  `mcp/CLAUDE.md` must state the version split so nobody "aligns" it by dropping
  `mcp/` back to Zod 3 and breaking the SDK.
- **Rate limiting.** The global 120/min (`app.ts:96`) is shared with the web app. A
  human clicking around while a `run_agent_on_pr` polls can push the pair over it; the
  429 path must therefore be a first-class business error, not a generic failure.
- **CI does not cover `mcp/`.** Deliberately out of scope, but it means a server
  contract change can break `mcp/ typecheck` with nothing red. Mitigation until a
  workflow exists: `mcp/CLAUDE.md` states it, and Step 8 adds `mcp/**` to the two
  skill routing tables so `/pr-self-review` at least routes the files somewhere.
- **A slug DevDigest does not own (D8).** Renaming an agent in the UI silently changes
  its slug, so a saved prompt referencing `general-reviewer` can stop resolving. The
  error path names `list_agents`, which is the recovery; a persisted slug column is a
  later decision, recorded in Open questions.

## Open questions

- **Answered after planning — SDK API shape.** Checked against the registry and the
  published typings: `@modelcontextprotocol/server@2.0.0`, `registerTool` with
  `outputSchema`, `structuredContent` and `annotations`, Standard Schema over Zod 4.
  See D14. What replaces it as open: **whether `mcp/`'s Zod 4 can typecheck the
  server's Zod 3 contract source through the alias** — D14 lists the two fallbacks and
  Step 1 decides in one command.
- **Non-blocking — spawn cwd for `.mcp.json`.** Verified from the binary that there is
  no `cwd` field; not verified what the working directory actually is. Step 7 is
  written to find out rather than to assume.
- **Non-blocking — should `agents` grow a `slug` column?** D8's derived slug is
  correct for this pass and drifts on rename. A persisted slug is a schema change, a
  migration and a UI field — a decision for whoever next touches the agents module,
  not a consequence of this lesson.
- **Non-blocking — env var naming.** `DEVDIGEST_API_URL` follows
  `DEVDIGEST_CLONE_DIR` / `DEVDIGEST_SKIP_PR_REVIEW`, but the client calls the same
  value `NEXT_PUBLIC_API_BASE` (`client/src/lib/api.ts:6`). Two names for one URL is
  a small, deliberate inconsistency; unifying them would touch `client/`, which is
  out of scope.
- **Answered, recorded so it is not re-opened:** third `vendor/shared` copy → no (D1);
  package manager → pnpm (D3); wait mechanism → polling (D4); who owns the "latest
  review" rule → `mcp/src/shape` with the server's own tie-break (D7).

## Constraints in force

| Constraint | Source | What it forbids here |
|---|---|---|
| `@devdigest/shared` is the single source of truth, and the two copies have already drifted | root `CLAUDE.md` § Gotchas | any `mcp/src/vendor/shared` — Step 1 aliases, it does not copy |
| All I/O and persistence lives in `server/` | root `CLAUDE.md` § Map | a DB pool, Drizzle, `~/.devdigest/secrets.json` or a migration inside `mcp/` |
| Imports point inward; HTTP stops at the edge | `.claude/skills/onion-architecture/SKILL.md` § Ring map | `fetch` inside `src/tools/**`, `await` inside `src/shape/**`, `process.env` outside `src/config.ts` |
| Route schemas come from `@devdigest/shared`; no hand-rolled `.parse(req.body)` | root `CLAUDE.md` § Conventions | a hand parse in Step 3's handler. **Response** shape: reuse `PrMeta`, do not mint a new contract. **Request** shape: server-local beside `IdParams` (`modules/_shared/schemas.ts:11`), which is where every request schema in this repo already lives |
| Changing `server/src/vendor/shared` obliges the mirror edit in `client/src/vendor/shared`, and the copies have already drifted | root `CLAUDE.md` § Gotchas | any new contract for Step 3 — the whole reason it returns `PrMeta`. `client/` must end this lesson byte-identical |
| Every route starts with `getContext`, every query workspace-scoped, no exceptions | `server/CLAUDE.md` § Conventions | Step 3 reading `pull_requests` without `workspaceId` |
| A new module is `routes.ts` + one line in `modules/index.ts` | `server/CLAUDE.md` § Conventions | Step 3 inventing a new module — the lookup belongs in the existing `pulls` module |
| `src/db/migrations/**` only via `pnpm db:generate` | root `CLAUDE.md` § Do not touch | any hand-written SQL. Step 3 adds no column: `pull_requests` is already unique on `(repo_id, number)` (`db/schema/pulls.ts:31`) |
| A DB-touching test is `*.it.test.ts` | root `CLAUDE.md` · `TESTING.md` | Step 3's route test under any other name |
| `POST /pulls/:id/review` returns `reviews: []` on purpose | `server/CLAUDE.md` § Gotchas · `server/INSIGHTS.md` 2026-08-01 | "fixing" the trigger by awaiting the run |
| `defaultNow()` is the transaction's timestamp; a latest-per-group read needs a secondary sort key | root `CLAUDE.md` § Gotchas | `reviews[0]` as "the latest review" (D7) |
| Global rate limit 120/min; the review trigger 10/min | `server/src/app.ts:96`, `reviews/routes.ts:27` | a sub-2-second poll; a retry loop on 429 |
| Read `pnpm arch:check`'s **output**, never its exit code | root `INSIGHTS.md` 2026-08-22 | a `Verify:` line that trusts exit 0 |
| Routing tables are pointed at, never copied | root `INSIGHTS.md` 2026-08-21 | a second path→skills table inside `mcp/CLAUDE.md`; Step 8 edits the one table that exists |
| A deliberate gap must be named as a gap everywhere that could route to it | root `INSIGHTS.md` 2026-08-25 | `get_blast_radius` reading as an empty answer; docs that describe blast radius as shipped |
| Every user-facing and repo file is written in English | root `CLAUDE.md` § Conventions | Ukrainian in `mcp/README.md`, a tool description, or an error string |
| stdout is the JSON-RPC channel on stdio transport | MCP stdio transport | `console.log` anywhere in `mcp/src` (D12) |

## Implementation plan

### Step 1 — the package, wired to the contracts without copying them   ·   package: mcp
Files:    `mcp/package.json` (new) · `mcp/tsconfig.json` (new) · `mcp/vitest.config.ts` (new)
          · `mcp/src/config.ts` (new) · `mcp/src/api/client.ts` (new)
          · `mcp/src/errors.ts` (new) · `mcp/test/config.test.ts` (new)
          · `mcp/.env.example` (new)
Skills:   typescript-expert
Do:       Create `@devdigest/mcp` (pnpm, vitest, `type: module`, Node ≥22). `tsconfig.json`
          copies `reviewer-core/tsconfig.json:21-24` — `@devdigest/shared` →
          `../server/src/vendor/shared/index.ts` plus the local `zod` self-pin — and sets
          `verbatimModuleSyntax: true` so a value import of a contract cannot compile (D2).
          `vitest.config.ts` mirrors `reviewer-core/vitest.config.ts:6-9`.
          `config.ts` is the only `process.env` reader: `DEVDIGEST_API_URL` (default
          `http://localhost:3001`) and `DEVDIGEST_MCP_RUN_TIMEOUT_MS` (default 120000).
          `api/client.ts` is a `fetch` wrapper taking the fetch implementation as an
          injected argument (so the unit lane needs no network), parsing the
          `{ error: { code, message } }` envelope (`contracts/platform.ts:279`) and mapping
          `ECONNREFUSED` → `api_unreachable`, 404 → `not_found`, 429 → `rate_limited`,
          5xx → `api_error`. `errors.ts` holds the forward-leading text for each code —
          `api_unreachable` names `./scripts/dev.sh`. Pin
          `@modelcontextprotocol/server@2.0.0` and `zod@^4.2.0` in `package.json` (D14 —
          NOT `@modelcontextprotocol/sdk`, and NOT the repo's Zod 3).
Verify:   `cd mcp && pnpm install && pnpm typecheck && pnpm test`. **`typecheck` is also the
          D14 fork:** it compiles the server's Zod 3 contract source under `mcp/`'s Zod 4. If
          it fails for that reason, take D14's fallback 1, record it in `mcp/CLAUDE.md`, and
          continue — do not re-plan. Then
          `grep -rn "from '@devdigest/shared'" mcp/src` shows only `import type`;
          `find mcp/src -type d -name shared` is empty;
          `grep -rln "process\.env" mcp/src` prints only `mcp/src/config.ts`.
Depends:  none
Commit:   `feat(mcp): the package, wired to the contracts without copying them`

### Step 2 — the MCP process, `list_agents`, and the honest stub   ·   package: mcp
Files:    `mcp/src/index.ts` (new) · `mcp/src/server.ts` (new) · `mcp/src/schemas.ts` (new)
          · `mcp/src/copy.ts` (new — the six Appendix strings, and nothing else)
          · `mcp/test/copy.test.ts` (new)
          · `mcp/src/tools/list-agents.ts` (new) · `mcp/src/tools/get-blast-radius.ts` (new)
          · `mcp/src/shape/agents.ts` (new) · `mcp/src/log.ts` (new)
          · `mcp/test/tool-surface.test.ts` (new) · `mcp/test/agents.test.ts` (new)
          · `mcp/test/stdio-purity.test.ts` (new)
Skills:   typescript-expert, zod
Do:       Use the `registerTool` signature D14 quotes verbatim; read the installed `.d.mts` only
          to confirm it, not to discover it. `index.ts` wires stdio and does nothing else; `log.ts` is
          `console.error` only (D12). `server.ts` sets the one-paragraph `instructions`
          and registers the tools; `schemas.ts` declares the shared flat fields (`repo`,
          `pr`, `agent`, `response_format`, `limit`) once and reuses them, so no field block
          is repeated across the five schemas. Every tool declares `outputSchema` and every
          result carries `structuredContent` plus a JSON text block. The `instructions` string and all five
          descriptions are **copied verbatim from the Appendix** — do not rewrite, shorten,
          translate or "improve" them. They are already measured against the limits, already
          carry their worked example, and the description is what tool search matches on, so a
          paraphrase is a silent regression in discoverability.
          `list_agents` reads `GET /agents` and projects `{ id, name, slug, provider, model,
          enabled, description }`; `shape/agents.ts` holds the pure `slugify` + the
          name/slug/uuid resolver with its ambiguity error (D8) — no `fetch`.
          `get_blast_radius` returns the not-implemented result with **no** HTTP call (D13).
          Register the other three as declared-but-unimplemented only if that keeps the tree
          compiling; otherwise add them in their own steps.
Verify:   `cd mcp && pnpm test` — `tool-surface.test.ts` spawns the process, drives
          `initialize` + `tools/list` over stdio, and asserts exactly five names, the
          annotations of D-scope, an `outputSchema` per tool, no nested input object,
          `instructions` ≤ 600 chars and each description ≤ 1200 chars with an example;
          a `copy.test.ts` asserts each registered description is **byte-identical** to the
          Appendix string (keep the six strings in one `mcp/src/copy.ts` so the test compares
          against one source, not against prose in a spec file);
          `stdio-purity.test.ts` asserts every stdout line parses as JSON-RPC; and
          `grep -rn "console\.\(log\|info\|debug\)" mcp/src` returns nothing.
Depends:  Step 1
Commit:   `feat(mcp): the stdio server, list_agents, and a stub that fails loudly`

### Step 3 — resolve `owner/name#number` → pull id, without touching GitHub   ·   package: server
Files:    `server/src/modules/pulls/routes.ts` (edit)
          · `server/test/pulls-lookup.it.test.ts` (new)
Skills:   onion-architecture, fastify-best-practices, zod
Do:       Add one read-only route to the **existing** `pulls` module:
          `GET /pulls/lookup?repo=<owner/name>&number=<int>` → **`PrMeta`**, the contract
          `GET /repos/:id/pulls` already returns (`contracts/platform.ts:160`).
          **Reusing `PrMeta` is the point, not a shortcut:** every field it needs is a column
          on `pull_requests` (`db/schema/pulls.ts:15-28` — `number, title, author, branch,
          base, head_sha, additions, deletions, files_count, status, opened_at, updated_at`),
          so the row alone builds a complete `PrMeta` offline. A purpose-built
          `{ pull_id, … }` shape would be a NEW contract in `vendor/shared`, which obliges the
          mirror edit in `client/src/vendor/shared` (root `CLAUDE.md` § Gotchas) and opens a
          third drift front for one route. This way `client/` is not touched at all, and
          `mcp/` type-imports a contract it already knows. The review-derived optional fields
          (score, severity counts) stay absent — they are documented as list-endpoint-only.
          The **querystring** schema is server-local, following the precedent of `IdParams`
          in `server/src/modules/_shared/schemas.ts:11` — request-shape schemas already live
          there rather than in `vendor/shared`. `getContext` first, both lookups scoped by
          `workspaceId`, persisted rows only — **no `container.github()` call**, which is
          the whole point: `GET /repos/:id/pulls` hits GitHub on every request
          (`pulls/routes.ts:33-118`) and would make an offline stack unusable from MCP.
          404 with a message that names the next step ("add the repo in DevDigest" /
          "open the repo's PR list so PR #N is imported"). No schema change and no
          migration — `pull_requests` is already unique on `(repo_id, number)`.
          **This step is droppable.** If it is dropped, `mcp/src/api/resolve.ts` (Step 4)
          instead calls `GET /repos`, matches `full_name`, then `GET /repos/:id/pulls` and
          matches `number` — one file changes, and the parsed shape is the same `PrMeta`
          either way, at the cost of a GitHub round-trip per resolution and a hard failure
          offline. `get_conventions` is unaffected either
          way: it needs only `GET /repos`.
Verify:   `cd server && pnpm exec vitest run .it.test` (green, incl. the new file) and
          `pnpm exec vitest run --exclude '**/*.it.test.ts'` and
          `pnpm arch:check` printing an **empty** violation list — read the output, not the
          exit code.
Depends:  none
Commit:   `feat(pulls): resolve owner/name#number to a pull id without asking GitHub`

### Step 4 — resolution, and `get_findings`   ·   package: mcp
Files:    `mcp/src/api/resolve.ts` (new) · `mcp/src/shape/findings.ts` (new)
          · `mcp/src/tools/get-findings.ts` (new)
          · `mcp/test/findings.test.ts` (new) · `mcp/test/resolve.test.ts` (new)
Skills:   typescript-expert, zod
Do:       `api/resolve.ts` exposes `resolveRepo(fullName)` (via `GET /repos`, matching
          `full_name` case-insensitively) and `resolvePull(fullName, number)` (via Step 3's
          lookup) — the single place a reversal of Step 3 would touch.
          `shape/findings.ts` is pure: pick the review per D7 (`kind === 'review'`, narrow by
          agent, newest with the `created_at desc, id desc` tie-break), sort findings
          CRITICAL → WARNING → SUGGESTION, apply `limit` (default 20, max 100) and always
          report `total_findings`. Concise emits `{ severity, file, line, title }` per
          finding; detailed adds `rationale`, `suggestion`, `confidence`, `category`, `id`.
          `get_findings` composes the two and maps a PR with no review at all to a
          non-error result that says so in words.
Verify:   `cd mcp && pnpm test` with a fixture containing two reviews that share a
          `created_at` to the millisecond (the D7 tie) and one `kind: 'summary'` row that
          must be excluded; plus a truncation case asserting `total_findings > findings.length`.
Depends:  Step 2, Step 3
Commit:   `feat(mcp): get_findings, and the latest-review rule it has to obey`

### Step 5 — `run_agent_on_pr`: one call, create → wait → collect   ·   package: mcp
Files:    `mcp/src/api/wait.ts` (new) · `mcp/src/tools/run-agent-on-pr.ts` (new)
          · `mcp/test/wait.test.ts` (new)
Skills:   typescript-expert, zod
Do:       `api/wait.ts` polls `GET /pulls/:id/runs`, matching the `run_id` returned by
          `POST /pulls/:id/review`, until its `status` is terminal — 2 s intervals for the
          first 60 s, then 5 s, ceiling `DEVDIGEST_MCP_RUN_TIMEOUT_MS` (D5). It returns a
          discriminated outcome (`done` / `failed` / `cancelled` / `timed_out`) and **never**
          an unmet condition dressed as success (D6).
          `run_agent_on_pr` resolves the agent (Step 2's pure resolver over `GET /agents`),
          resolves the pull (Step 4), POSTs `{ agentId }`, waits, then reuses
          `shape/findings.ts` so its payload is identical to `get_findings`. `failed` returns
          `isError: true` carrying the run row's `error`; `timed_out` returns `isError: true`
          with `status: "still_running"`, the `run_id`, `waited_seconds`, and the exact
          `get_findings` follow-up call. `429` maps to `rate_limited` with the 10/min limit
          named in the message.
Verify:   `cd mcp && pnpm test` with a stubbed fetch driving three scripted sequences —
          `running → running → done`, `running → failed`, and a clock-advanced timeout —
          asserting the timeout result has no `verdict` and no `findings` key, that the
          poll made ≤ 30 requests per simulated minute, that it never sleeps past the 120 s
          deadline, and that the still-running text names `get_findings` and not a re-run.
Depends:  Step 4
Commit:   `feat(mcp): run_agent_on_pr — one call that starts, waits and collects`

### Step 6 — `get_conventions`   ·   package: mcp
Files:    `mcp/src/shape/conventions.ts` (new) · `mcp/src/tools/get-conventions.ts` (new)
          · `mcp/test/conventions.test.ts` (new)
Skills:   typescript-expert, zod
Do:       Read `GET /repos/:id/conventions` for the resolved repo. Return
          `{ repo, accepted, pending, rejected, conventions[] }` where `conventions[]` is the
          **accepted** rules only — concise emits `{ rule, category, evidence: "path:line" }`,
          detailed adds `evidence_snippet` and `confidence` (that snippet is the payload's
          bulk, which is what makes a detailed form worth having here). `limit` defaults to 50
          and truncation reports the total. An empty accepted list is not an empty answer: it
          reports the pending/rejected counts and says the extractor has not run or nothing
          has been accepted yet — the same reasoning `ConventionExtractResult`'s own doc
          comment gives for shipping `sampled_files` and `discarded`
          (`contracts/knowledge.ts:286-295`). The tool never calls
          `POST /repos/:id/conventions/extract`.
Verify:   `cd mcp && pnpm test` with three fixtures — mixed statuses, all-pending, and empty —
          and an assertion that the stubbed fetch received no POST.
Depends:  Step 4
Commit:   `feat(mcp): get_conventions, where an empty list is not an empty answer`

### Step 7 — register it, document it, run it   ·   package: mcp
Files:    `.mcp.json` (new) · `mcp/README.md` (new) · `mcp/CLAUDE.md` (new)
          · `mcp/INSIGHTS.md` (new)
Skills:   —
Do:       `.mcp.json` at the repo root, project scope, one `devdigest` stdio entry. The
          installed Claude Code build validates a stdio entry as
          `{ type, command, args, env, envHelper, envHelperTtlSec }` — there is **no `cwd`**,
          and `command` must be a bare name or an absolute path with no `~` or `..`. So:
          `command: "pnpm"`, `args: ["--dir", "mcp", "exec", "tsx", "src/index.ts"]`,
          `env: { "DEVDIGEST_API_URL": "http://localhost:3001" }`. Verify the spawn cwd
          empirically; if the relative args do not resolve, fall back to a `local`-scope
          registration with an absolute path and document the `claude mcp add` line instead
          of committing a broken entry.
          `mcp/README.md`: what the package is, the five tools with their arguments, the
          `pnpm install` prerequisite, the "approve the project server on first session"
          note (unapproved `.mcp.json` servers show as `⏸ Pending approval`), the
          faster `pnpm build && node mcp/dist/index.js` alternative, the stderr-only
          logging rule, and the **Inspector command** as the first-line debugging tool for
          anyone whose server will not connect. `mcp/CLAUDE.md` carries the D11 ring table, D2's type-only rule, the
          stdout rule, and the fact that no CI workflow covers this package.
          `mcp/INSIGHTS.md` is created with the seven standard sections, each `_None yet._`,
          because the session protocol in root `CLAUDE.md` tells every future task to read
          `<pkg>/INSIGHTS.md` first and there must be a file to read.
Verify:   Two gates, in this order — the Inspector before the model, so a protocol fault is
          never diagnosed as a model mistake.
          **(a) Inspector.** Start the stack (`./scripts/dev.sh`), then
          `pnpm dlx @modelcontextprotocol/inspector -- pnpm --dir mcp exec tsx src/index.ts`.
          Confirm: connection over stdio, exactly five tools, annotations and `outputSchema`
          visible per tool, and a successful call of `list_agents`, `get_conventions` and
          `get_blast_radius` (the last one failing loudly, which is its pass condition).
          **(b) Claude Code.** `claude mcp get devdigest` reports the server; after approval a
          session exposes `mcp__devdigest__list_agents`, and the graded scenario —
          "review PR #482 in acme/payments-api with the Security Reviewer, are there critical
          findings?" — drives `list_agents` → `run_agent_on_pr` → `get_findings` and returns
          DevDigest's real findings, verified against the same PR in the web UI.
          Then the live lane: `cd mcp && pnpm test:live`.
          Also confirm `scripts/dev.sh` is untouched — the server is spawned by its client,
          never by the repo's dev script.
Depends:  Step 5, Step 6
Commit:   `feat(mcp): register the server, and document how to drive it`

### Step 8 — stop the repo's own maps from omitting a fifth package   ·   package: —
Files:    `CLAUDE.md` (edit) · `README.md` (edit) · `TESTING.md` (edit)
          · `specs/README.md` (edit)
          · `.claude/skills/pr-self-review/SKILL.md` (edit)
          · `.claude/skills/engineering-insights/SKILL.md` (edit)
Skills:   —
Do:       Add `mcp/` to root `CLAUDE.md` § Map and § Commands, to the package table in
          `README.md:12-18`, and to the suite map in `TESTING.md` (marked "no workflow yet",
          stated as a gap rather than left blank). Set the L04 row in `specs/README.md:34` to
          point at this spec.
          Then close the two routing gaps a new package opens, by adding **one row to each
          existing table** — never a second table (root `INSIGHTS.md` 2026-08-21):
          `.claude/skills/pr-self-review/SKILL.md` § 3 gains `mcp/src/**` → REPO lane →
          `typescript-expert, zod`, and `.claude/skills/engineering-insights/SKILL.md` § 1
          gains `mcp/**` only → `mcp/INSIGHTS.md`.
          Also widen `.claude/skills/onion-architecture/SKILL.md`'s scope line — today
          `Scope: server/** and reviewer-core/**`, which is why it did not claim `mcp/**`
          during planning (D11). Add `mcp/**` **with its limit stated in the same breath**:
          the ring rule applies by hand there, `pnpm arch:check` (dependency-cruiser) does
          **not** cover `mcp/`, and the package's ring table lives in `mcp/CLAUDE.md`. A scope
          that promises enforcement the tooling does not provide is worse than no scope at
          all. Keep the skill out of `skills-lock.json`. Both skills are hand-authored and must
          stay out of `skills-lock.json` (root `CLAUDE.md` § Do not touch) — check that they
          are still absent from it after the edit.
          Note explicitly in `TESTING.md` that `mcp/**` has no workflow, so the gap is
          recorded rather than implied.
Verify:   `grep -rn "mcp/" CLAUDE.md README.md TESTING.md specs/README.md` shows the new
          rows; `grep -c mcp skills-lock.json` returns 0;
          `bash scripts/pr-self-review-checks.sh` produces no CRITICAL on the branch.
Depends:  Step 7
Commit:   `docs(mcp): stop the repo's own maps from omitting a fifth package`


## Appendix — the exact tool copy (BINDING: copy verbatim, do not rewrite)

These are the final strings. **Step 2 copies them into `mcp/src/copy.ts` character for
character**; `mcp/test/copy.test.ts` fails the build on any drift. Do not paraphrase,
shorten, translate or re-wrap them while implementing — the description is what MCP tool
search matches on, so a "tidier" rewrite is a silent regression in discoverability, and the
error-path wording in `run_agent_on_pr` is what stops a model starting a second paid run.
Already measured against this plan's own limits: `instructions` ≤ 600 chars (505), each
description ≤ 1200 chars, each carrying a worked example call.

### Server `instructions`

```text
DevDigest is a local AI pull-request review studio. These tools drive it over its API on localhost:3001, which must already be running (./scripts/dev.sh). Address repositories as owner/name, pull requests by their number, and reviewer agents by the name or slug that list_agents returns — never by an internal UUID. If you do not already have an agent name, call list_agents first. Responses are concise by default; pass response_format "detailed" when you need each finding's rationale and suggested fix.
```

### `list_agents` — 632 chars

```text
List the reviewer agents configured in DevDigest — the AI code reviewers that can be run over a pull request. Returns each agent's name, slug, provider, model, enabled flag and a one-line description of what it looks for. This is the only source of a valid `agent` value for run_agent_on_pr and get_findings, so call it first instead of guessing a name. `enabled` is the membership test for a review-all triggered in the DevDigest UI; it does not stop you running that agent by name here. Costs nothing.
Example: list_agents() -> [{ name: "Security Reviewer", slug: "security-reviewer", model: "claude-opus-5", enabled: true }, ...]
```

### `run_agent_on_pr` — 802 chars

```text
Run one reviewer agent over one pull request and return the finished review: verdict, score and grounded findings with severity, file and line. One blocking call does all three steps — it starts the run, waits for it, and collects the result — so there is no separate start or poll tool.
This spends a real model call. Run it once per pull request per agent, and use get_findings to re-read the result instead of running it again.
It waits up to 120 seconds. If the run is still going when that expires it returns status "still_running" with the run id — the run is healthy and continuing. Collect it with get_findings using the same repo, pr and agent. Do NOT call this tool again: that starts a second paid run.
Example: run_agent_on_pr(repo: "acme/payments-api", pr: 482, agent: "security-reviewer")
```

### `get_findings` — 714 chars

```text
Read the findings of a review that has already run on a pull request, without starting a new one and without spending anything. Returns the same shape as run_agent_on_pr: a verdict plus findings carrying severity (CRITICAL, WARNING, SUGGESTION), file, line and title.
Pass `agent` to read one reviewer's pass; omit it to get the most recent review, whose agent is named in the response. Use this after a run_agent_on_pr that returned "still_running", or to re-read a review you already paid for. If no agent has reviewed the pull request yet, the response says so — it is not an empty findings list.
Example: get_findings(repo: "acme/payments-api", pr: 482, agent: "security-reviewer", response_format: "detailed")
```

### `get_conventions` — 632 chars

```text
Read the coding conventions DevDigest extracted from a repository — the accepted house rules for naming, error handling, testing and structure, each with the file:line evidence it was derived from. Use it before writing or reviewing code in that repository so the code matches the house style.
Read-only: it returns what the conventions extractor already stored and never runs the extractor, which spends a model call. If nothing has been accepted yet, the response says so and reports the pending and rejected counts — that is different from "this repository has no conventions".
Example: get_conventions(repo: "acme/payments-api")
```

### `get_blast_radius` — 592 chars

```text
NOT IMPLEMENTED YET — this tool always returns an error. Blast radius is the map of what a pull request's changes can reach downstream: calling sites, dependent modules and the tests most at risk. It ships in a later DevDigest lesson and is declared now so its name and arguments stay stable.
It fails loudly and never returns an empty result: do not read its failure as "this pull request affects nothing". To judge impact today, run a reviewer agent with run_agent_on_pr and read its findings.
Example: get_blast_radius(repo: "acme/payments-api", pr: 482) -> error, status "not_implemented"
```
## Commit plan

**One commit per step, eight in all.** The boundary is not arbitrary: every step already
ends in a command that passes or fails, and that command is the commit's gate. A step whose
`Verify` has not passed does not get committed.

| # | Step | Commit |
|---|---|---|
| 1 | package + API client | `feat(mcp): the package, wired to the contracts without copying them` |
| 2 | stdio server, `list_agents`, stub | `feat(mcp): the stdio server, list_agents, and a stub that fails loudly` |
| 3 | server lookup route | `feat(pulls): resolve owner/name#number to a pull id without asking GitHub` |
| 4 | resolution + `get_findings` | `feat(mcp): get_findings, and the latest-review rule it has to obey` |
| 5 | `run_agent_on_pr` | `feat(mcp): run_agent_on_pr — one call that starts, waits and collects` |
| 6 | `get_conventions` | `feat(mcp): get_conventions, where an empty list is not an empty answer` |
| 7 | registration + docs | `feat(mcp): register the server, and document how to drive it` |
| 8 | repo maps + skill routing | `docs(mcp): stop the repo's own maps from omitting a fifth package` |

Rules, in the house style the log already uses (`type(scope): what changed, and the second
thing it changed`):

- **Never one giant commit.** Eight steps squashed into one makes `git bisect` useless and
  makes the Step 3 reversal — the one thing this plan deliberately kept droppable —
  impossible to revert on its own.
- **Never a commit for its own sake either.** If a step turns out to be a no-op, it gets no
  commit. Eight is the ceiling, not a quota.
- **A commit never leaves the tree broken.** Tests ship with the code they cover (each step's
  `Files:` list already pairs them), and a contract change ships with its mirror in the same
  commit — split across two, the tree is broken in between (root `CLAUDE.md` § Gotchas).
- **Step 3 is its own commit precisely because it is droppable.** Different package, different
  scope, revertable with one `git revert` without touching `mcp/`.
- **`/pr-self-review` runs before the pull request, not before each commit.** A PreToolUse
  hook blocks `gh pr create` until it passes (root `CLAUDE.md` § Session protocol).
- Commit only when asked. The plan says where the boundaries are; it does not authorise
  pushing or opening a PR.

## Handoff

Plan file:      `specs/L04-mcp-server.md`
Entry point:    Step 1
Verification:   `cd mcp && pnpm typecheck && pnpm test` · `cd mcp && pnpm test:live` (stack up)
                `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
                `cd server && pnpm exec vitest run .it.test` (Docker)
                `cd server && pnpm arch:check` — read the OUTPUT, not the exit code
                `cd client && pnpm test && pnpm typecheck` (must stay untouched and green)
                `claude mcp get devdigest` after `./scripts/dev.sh`
Closing step:   after Step 8 passes, run `/engineering-insights` and set this spec's
                `Status:` to `done`, then remove its pointer from `specs/README.md`'s
                Read-when list per `specs/README.md` rule 6. That is the moment the
                planning-time hypotheses in D14 and Risks are either confirmed as
                lessons or dropped — routed to the **root** `INSIGHTS.md`, since this
                work spans `mcp/` and `server/`. Nothing goes in the journal before
                then: its entries are read as high-confidence guidance, and a hypothesis
                recorded as a lesson devalues every entry beside it.
                Commit: `docs(mcp): close the spec, and record what it taught`.
Deviation policy: stop at the step, report the divergence, finish the independent steps.
                  Step 3 is independent of Steps 1–2 and can proceed while `mcp/` is blocked.
                  Do not re-plan.
