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
        { type: 'text', text: JSON.stringify(result) },
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

/**
 * An error result carries NO `structuredContent`, and that is deliberate.
 *
 * This tool advertises `getFindingsOutput` — the shape of a successful review
 * read. An error payload cannot satisfy it. The SDK lets that pass, because
 * `validateToolOutput` returns early when `isError` is true, so every unit test
 * here is green either way. A CLIENT does not skip it: the MCP Inspector
 * validates `structuredContent` against the published `outputSchema` with ajv
 * and rejects the WHOLE result, so the caller gets a schema complaint instead of
 * the sentence naming `list_agents` or `./scripts/dev.sh` — losing exactly the
 * guidance the error exists to deliver.
 *
 * So the machine-readable payload rides in a second text block, where no schema
 * governs it and every client can still read it. There is NO exception:
 * `get_blast_radius` routes its errors through this helper too. It used to be
 * one, back when its `outputSchema` was the not-implemented error shape; that
 * schema is now its success shape, and a `structuredContent` on one of its
 * errors is exactly what the Inspector's ajv pass would reject.
 */
export function errorContent(code: string, message: string): CallToolResult {
  return {
    content: [
      { type: 'text', text: message },
      { type: 'text', text: JSON.stringify({ status: 'error', code, message }) },
    ],
    isError: true,
  };
}

function errorResult(code: string, message: string): CallToolResult {
  return errorContent(code, message);
}
