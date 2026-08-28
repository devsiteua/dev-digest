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

_None yet._

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

_None yet._
