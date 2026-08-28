import { McpServer } from '@modelcontextprotocol/server';

import type { ApiClient } from './api/client.js';
import type { McpConfig } from './config.js';
import { SERVER_INSTRUCTIONS } from './copy.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';

/**
 * Delivery ring — the server itself: one `instructions` paragraph and exactly
 * five tools.
 *
 * "Exactly five" is a property of this file and is asserted over the wire in
 * `test/tool-surface.test.ts`. Each tool owns a module under `src/tools/` that
 * registers it and holds its handler, so this file is the list and nothing else:
 * what the server publishes is readable in one screen, and a sixth tool would
 * have to be added here in plain sight.
 *
 * The published surface has been stable since step 2 of
 * `specs/L04-mcp-server.md` — every description, input schema, output schema and
 * annotation was final before the handlers behind them were written, so a client
 * that approved this server never saw the tool list change under it.
 */

export interface ServerDeps {
  readonly api: ApiClient;
  readonly config: McpConfig;
}

/** Kept in step with `package.json`; reported to the client on `initialize`. */
const SERVER_VERSION = '0.0.0';

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: 'devdigest', version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  registerListAgents(server, deps);
  registerRunAgentOnPr(server, deps);
  registerGetFindings(server, deps);
  registerGetConventions(server, deps);
  registerGetBlastRadius(server);

  return server;
}
