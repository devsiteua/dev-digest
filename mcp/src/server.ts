import { McpServer } from '@modelcontextprotocol/server';

import type { ApiClient } from './api/client.js';
import type { McpConfig } from './config.js';
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from './copy.js';
import {
  getConventionsInput,
  getConventionsOutput,
  getFindingsInput,
  getFindingsOutput,
  runAgentOnPrInput,
  runAgentOnPrOutput,
} from './schemas.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerListAgents } from './tools/list-agents.js';

/**
 * Delivery ring — the server itself: one `instructions` paragraph and exactly
 * five tools.
 *
 * "Exactly five" is a property of this file and is asserted over the wire in
 * `test/tool-surface.test.ts`. Three of them (`run_agent_on_pr`, `get_findings`,
 * `get_conventions`) are registered here with their **final** description, input
 * schema, output schema and annotations, and a handler that says it is not wired
 * up yet — steps 4 to 6 of `specs/L04-mcp-server.md` replace those handlers with
 * modules under `src/tools/`. Registering them now rather than later is what
 * keeps the published surface stable: a client that has already approved this
 * server does not see the tool list change under it, and a model that reads the
 * descriptions gets the real ones.
 *
 * The handler bodies say so out loud rather than returning an empty result,
 * for the reason `get_blast_radius` exists to demonstrate: a tool that answers
 * "nothing" when it means "nobody looked" is worse than one that fails.
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
  registerRunAgentOnPr(server);
  registerGetFindings(server);
  registerGetConventions(server);
  registerGetBlastRadius(server);

  return server;
}

// ---------------------------------------------------------------------------
// The three tools whose handlers land in steps 4 to 6. Everything a client can
// SEE about them is already final; only the body is missing.
// ---------------------------------------------------------------------------

function registerRunAgentOnPr(server: McpServer): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      title: 'Run a reviewer agent on a pull request',
      description: TOOL_DESCRIPTIONS.run_agent_on_pr,
      inputSchema: runAgentOnPrInput,
      outputSchema: runAgentOnPrOutput,
      // Not read-only: it starts a run that spends a real model call. Not
      // destructive: it adds a review, it never removes or overwrites one. Open
      // world: the reviewed pull request lives outside DevDigest.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    () => notWiredYet('run_agent_on_pr', 'step 5'),
  );
}

function registerGetFindings(server: McpServer): void {
  server.registerTool(
    'get_findings',
    {
      title: 'Read an existing review',
      description: TOOL_DESCRIPTIONS.get_findings,
      inputSchema: getFindingsInput,
      outputSchema: getFindingsOutput,
      annotations: { readOnlyHint: true },
    },
    () => notWiredYet('get_findings', 'step 4'),
  );
}

function registerGetConventions(server: McpServer): void {
  server.registerTool(
    'get_conventions',
    {
      title: 'Read a repository’s extracted conventions',
      description: TOOL_DESCRIPTIONS.get_conventions,
      inputSchema: getConventionsInput,
      outputSchema: getConventionsOutput,
      annotations: { readOnlyHint: true },
    },
    () => notWiredYet('get_conventions', 'step 6'),
  );
}

/**
 * The placeholder answer: an error that names itself, the step that fills it in,
 * and the fact that nothing was read and nothing was spent.
 *
 * `status` is deliberately NOT `not_implemented`: that value belongs to
 * `get_blast_radius`, which is a declared gap rather than a half-built tool, and
 * the two must stay tellable apart.
 */
function notWiredYet(tool: string, step: string) {
  const message =
    `${tool} is registered but not wired up yet in this build of devdigest-mcp. Its arguments, ` +
    `its description and the shape of its result are final; the implementation lands in ${step} ` +
    `of specs/L04-mcp-server.md. Nothing was read and nothing was spent.`;
  const payload = { status: 'not_wired_yet' as const, implemented_in: step, message };
  return {
    content: [
      { type: 'text' as const, text: message },
      { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
    ],
    structuredContent: payload,
    isError: true,
  };
}
