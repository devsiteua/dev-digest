import type { McpServer } from '@modelcontextprotocol/server';
import type { Agent } from '@devdigest/shared';

import type { ApiClient } from '../api/client.js';
import { TOOL_DESCRIPTIONS } from '../copy.js';
import { isDevDigestApiError } from '../errors.js';
import { errorContent } from './get-findings.js';
import { log } from '../log.js';
import { listAgentsInput, listAgentsOutput } from '../schemas.js';
import { toAgentSummary } from '../shape/agents.js';

/**
 * Delivery ring — `list_agents`, the tool every other tool's `agent` argument
 * depends on.
 *
 * It reads `GET /agents` and projects six of the fields the contract exposes plus
 * the slug this package mints (`shape/agents.ts`) — `provider` is left behind on
 * purpose, and `shape/agents.ts` says why. It takes no arguments and
 * costs nothing, which is why the description tells a model to call it first
 * rather than guess a name.
 */
export function registerListAgents(server: McpServer, deps: { readonly api: ApiClient }): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List reviewer agents',
      description: TOOL_DESCRIPTIONS.list_agents,
      inputSchema: listAgentsInput,
      outputSchema: listAgentsOutput,
      annotations: { readOnlyHint: true },
    },
    async () => {
      let agents: Agent[];
      try {
        agents = await deps.api.get<Agent[]>('/agents');
      } catch (error) {
        // Every business failure is a tool-level error, never a thrown protocol
        // fault: the process has to stay alive and answer the next call even
        // with nothing listening on :3001.
        if (!isDevDigestApiError(error)) throw error;
        log('list_agents failed', error);
        // Through the shared helper, not a second copy of it. The copy that used
        // to live here is how this file kept its pretty-printed payload when
        // every other tool lost one: a hand-rolled duplicate drifts silently,
        // and `errorContent` already carries the rule about `structuredContent`.
        return errorContent(error.code, error.message);
      }

      const payload = { agents: agents.map(toAgentSummary) };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );
}
