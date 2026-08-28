import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { Agent, ReviewRecord } from '@devdigest/shared';

import type { ApiClient } from '../api/client.js';
import { resolvePull } from '../api/resolve.js';
import { TOOL_DESCRIPTIONS } from '../copy.js';
import { isDevDigestApiError } from '../errors.js';
import { log } from '../log.js';
import { getFindingsInput, getFindingsOutput } from '../schemas.js';
import { resolveAgent, toAgentSummary } from '../shape/agents.js';
import {
  buildReviewResult,
  describeReviewResult,
  type AgentRef,
  type ResponseFormat,
} from '../shape/findings.js';

/**
 * Delivery ring — `get_findings`: read a review that has already run, spend
 * nothing, start nothing.
 *
 * Two rules from the plan shape the whole handler:
 *
 * - **D7.** Which review it answers with is decided in `shape/findings.ts`, not
 *   by taking the first row the API returned. This module only fetches and
 *   reports.
 * - **A pull request nobody reviewed is not an empty findings list.** That case
 *   comes back with `isError: false` and `reviewed: false`, and the words are in
 *   the first content block. An error would be wrong (nothing failed) and an
 *   empty array would be a lie (nothing looked).
 */

/** What the handler needs, with the defaults `schemas.ts` publishes made optional. */
export interface GetFindingsArgs {
  readonly repo: string;
  readonly pr: number;
  readonly agent?: string | undefined;
  readonly response_format?: ResponseFormat | undefined;
  readonly limit?: number | undefined;
}

export function registerGetFindings(server: McpServer, deps: { readonly api: ApiClient }): void {
  server.registerTool(
    'get_findings',
    {
      title: 'Read an existing review',
      description: TOOL_DESCRIPTIONS.get_findings,
      inputSchema: getFindingsInput,
      outputSchema: getFindingsOutput,
      annotations: { readOnlyHint: true },
    },
    (args: GetFindingsArgs) => runGetFindings(deps.api, args),
  );
}

/**
 * The handler itself, exported so the unit lane can drive it with a stubbed
 * `fetch` and no MCP transport at all.
 *
 * The registration above is one line for exactly that reason: everything worth
 * testing is here, and the protocol surface is asserted once, over the wire, in
 * `test/tool-surface.test.ts`.
 */
export async function runGetFindings(
  api: ApiClient,
  args: GetFindingsArgs,
): Promise<CallToolResult> {
  const responseFormat: ResponseFormat = args.response_format ?? 'concise';

  try {
    // The agent is resolved BEFORE the pull request: a misspelled agent name is
    // the likelier mistake, and its error names `list_agents` and lists what
    // exists, which is a better answer than a repository lookup the caller did
    // not get wrong.
    let agent: AgentRef | null = null;
    if (args.agent !== undefined && args.agent.trim() !== '') {
      const agents = await api.get<Agent[]>('/agents');
      const resolution = resolveAgent(args.agent, agents.map(toAgentSummary));
      if (!resolution.ok) return errorResult(resolution.reason, resolution.message);
      agent = { id: resolution.agent.id, name: resolution.agent.name };
    }

    const pull = await resolvePull(api, args.repo, args.pr);
    const reviews = await api.get<ReviewRecord[]>(`/pulls/${pull.id}/reviews`);

    const result = buildReviewResult({
      repo: pull.repo,
      pr: args.pr,
      reviews,
      agent,
      responseFormat,
      limit: args.limit,
    });

    return {
      content: [
        { type: 'text', text: describeReviewResult(result) },
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  } catch (error) {
    // Every business failure is a tool-level error, never a thrown protocol
    // fault: the process has to stay alive and answer the next call even with
    // nothing listening on :3001.
    if (!isDevDigestApiError(error)) throw error;
    log('get_findings failed', error);
    return errorResult(error.code, error.message);
  }
}

function errorResult(code: string, message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { status: 'error', code, message },
    isError: true,
  };
}
