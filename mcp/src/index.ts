#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { ApiClient } from './api/client.js';
import { loadConfig } from './config.js';
import { log } from './log.js';
import { createServer } from './server.js';

/**
 * Composition — wire stdio, and nothing else.
 *
 * Deliberately not: starting the API, checking that it is up, or reading a
 * configuration file. The MCP server is spawned by its client (Claude Code, or
 * the Inspector) and must come up whether or not `./scripts/dev.sh` is running —
 * an unreachable API is a tool-level error with a next step in it, never a
 * startup crash that leaves the client showing no server at all.
 *
 * Every line this process writes to stdout is JSON-RPC. Diagnostics go through
 * `log()` to stderr (D12).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  // The platform's global satisfies `FetchLike` as-is (asserted at compile time
  // in `test/config.test.ts`), and handing over the reference rather than calling
  // it keeps the delivery ring free of HTTP: the only module that speaks it is
  // `api/client.ts`.
  const api = new ApiClient({ baseUrl: config.apiBaseUrl, fetch: globalThis.fetch });

  const server = createServer({ api, config });
  await server.connect(new StdioServerTransport());

  log(`connected over stdio; DevDigest API at ${config.apiBaseUrl}`);
}

main().catch((error: unknown) => {
  log('failed to start', error);
  process.exitCode = 1;
});
