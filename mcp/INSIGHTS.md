# Insights — mcp

Append-only, newest first within each section. Sections, entry format, and promotion rules:
see the root [`../INSIGHTS.md`](../INSIGHTS.md).

---

## What Works

_None yet._

## What Doesn't Work

### 2026-08-28 · The SDK skips `outputSchema` validation when `isError` is true — the CLIENT does not, and drops the whole result

Trigger:  every unit test green (197), then the MCP Inspector — the first gate, run before any
          Claude Code session — answered three of the five tools with
          `data must have required property 'repo' … data must NOT have additional properties`
          instead of the tool's error text.
Cause:    `get_findings`, `get_conventions` and `run_agent_on_pr` declare the SUCCESS shape as
          their `outputSchema`, and returned `structuredContent` of a different shape on error
          paths. Server-side that is invisible: `validateToolOutput` in
          `@modelcontextprotocol/server@2.0.0` returns early when `isError` is true. The
          Inspector's client validates with ajv and rejects the ENTIRE result — so the caller
          loses the sentence naming `list_agents` or `./scripts/dev.sh`, which is precisely
          what the degraded-path work exists to deliver. The unit lane could not catch it
          twice over: it calls handlers directly, so it never reaches the SDK's call path at
          all. `get_blast_radius` was unaffected because its declared shape IS its error shape.
Takeaway: on an error result, either carry NO `structuredContent` or carry one the tool's own
          `outputSchema` accepts — the payload rides in a second JSON text block instead, where
          no schema governs it and every client can still read it. Do not read the SDK's
          skip-on-`isError` as permission; it is a server-side shortcut, not a protocol
          guarantee. And do not "tidy" a handler by dropping `isError`: that silently subjects
          an intentionally partial payload to full validation.
Evidence: mcp/src/tools/get-findings.ts (`errorContent`, and the comment saying why);
          mcp/test/tool-surface.test.ts § "error results never contradict their own outputSchema"
Status:   resolved — the guard was proven to fire by restoring the old shape (3 tools red)
## Codebase Patterns

### 2026-08-28 · `get_blast_radius` is already wired to a contract that exists — and its `outputSchema` is the one thing that must change

Trigger:  reading L04 part two (Blast Radius) against the stub L04 shipped, to see what
          implementing it actually costs.
Cause:    two things are easy to get wrong here, and both are invisible from the stub's code.
          (a) **The contract already exists and is not `mcp/`'s to invent.**
          `server/src/vendor/shared/contracts/brief.ts:113` declares
          `BlastRadius { changed_symbols: ChangedSymbol[], downstream: DownstreamImpact[],
          summary }`, and it is already a member of `PrBrief` (:192). `DownstreamImpact` is
          `{ symbol, callers: BlastCaller[], endpoints_affected, crons_affected }` — the exact
          "symbol → callers → endpoints" shape the feature needs. Minting a new one would open
          a drift front and, being under `vendor/shared`, would oblige the mirror edit in
          `client/src/vendor/shared`. D13's rule that the stub emit **no** `changed_symbols`
          and no `downstream` keys was written against these very names: the stub is
          deliberately shaped as the absence of this contract, not as a different one.
          (b) **The stub's `outputSchema` IS its error shape.** `getBlastRadiusOutput`
          (`src/schemas.ts:227`) is `{ status: literal('not_implemented'), implemented_in,
          message }`. That is why it is the one tool allowed to keep `structuredContent` on an
          error. The moment it returns a real answer, that schema must be replaced with the
          success shape — leave it and the tool publishes a payload contradicting its own
          schema, which is exactly the fault the Inspector caught (see § What Doesn't Work,
          same date).
Takeaway: implementing it is: swap `getBlastRadiusOutput` for the real shape, return
          `isError: false`, and project `BlastRadius` rather than inventing a payload. The
          tool's ARGUMENTS (`repo`, `pr`) are already final by design, so no signature moves
          and no client re-approves the server. Re-run the Inspector afterwards, not just the
          unit lane — the unit lane calls handlers directly and cannot see a schema mismatch.
Evidence: server/src/vendor/shared/contracts/brief.ts:91-118,192; mcp/src/schemas.ts:227;
          mcp/src/tools/get-blast-radius.ts; specs/L04-mcp-server.md § D13
Status:   open — the stub is correct as shipped; this is what L04 part two has to change
## Tool & Library Notes

### 2026-08-28 · `inspector --cli` eats the server command's own flags — `--dir` made it report "Connection closed"

Trigger:  `pnpm dlx @modelcontextprotocol/inspector --cli pnpm --dir mcp exec tsx src/index.ts
          --method tools/list` returned `{"error":{"code":"error","message":"Connection
          closed"}}` — which reads exactly like a server that crashes on handshake.
Cause:    the Inspector parses `--dir` as one of ITS options, not as an argument of the
          command it is spawning, so the child is launched malformed. The server was fine:
          piping a raw `initialize` line into the identical
          `pnpm --dir mcp exec tsx src/index.ts` from the repo root returns a valid result
          with `serverInfo.name = "devdigest"`.
Takeaway: give `--cli` a FLAGLESS command — from `mcp/`, `node_modules/.bin/tsx src/index.ts`
          works. And before believing "Connection closed", spawn the same command by hand and
          pipe one `initialize` into it: that one command separates a broken server from a
          broken invocation, which is the whole reason the Inspector is the gate before the
          model. Note the CLI also writes tool results to stderr and exits non-zero when a tool
          returns `isError: true`, so `2>/dev/null` silently discards the answer you wanted.
Evidence: specs/L04-mcp-server.md § Step 7 Verify (a); mcp/README.md (the Inspector line)
Status:   resolved
## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

### 2026-08-28 · A CLI in this package will collide with the stdout rule, and the rule is written one scope too wide

Trigger:  L04 part two's optional task adds `devdigest review --mode working` **to this
          package** — a second entry point beside the MCP server.
Cause:    `CLAUDE.md` § Conventions says "No `console.log` / `.info` / `.debug` anywhere in
          `src/`", and `test/stdio-purity.test.ts` enforces it by spawning the process and
          asserting every stdout line parses as JSON-RPC. That is right for the MCP server,
          where stdout IS the transport and one stray line drops the connection. It is wrong
          for a CLI, whose whole job is to print findings to stdout for a human. The rule is
          scoped to the PACKAGE when the thing it protects is one PROCESS.
Takeaway: when the CLI lands, narrow the rule rather than deleting it — something like "no
          stdout writes on any path reachable from `src/index.ts`", with `stdio-purity`
          continuing to spawn the MCP entry point specifically and a separate entry point for
          the CLI. Both failure modes are silent and neither is caught by types: delete the
          rule and the MCP transport breaks intermittently with the reason only on stderr;
          keep it as written and the CLI cannot print anything. Decide it deliberately, in
          `CLAUDE.md`, before writing the first `console.log`.
Evidence: mcp/CLAUDE.md § Conventions (the stdout rule); mcp/test/stdio-purity.test.ts;
          mcp/src/log.ts
Status:   resolved 2026-08-28 — narrowed to "no stdout writes on any path reachable from
          `src/index.ts`" BEFORE the first `console.log` was written, and
          `stdio-purity.test.ts` now names that entry point in a constant. A module both
          entry points reach is still bound by it, which is why `src/log.ts` stays
          `console.error`.
