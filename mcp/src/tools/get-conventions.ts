import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { ConventionCandidate } from '@devdigest/shared';

import type { ApiClient } from '../api/client.js';
import { resolveRepo } from '../api/resolve.js';
import { TOOL_DESCRIPTIONS } from '../copy.js';
import { isDevDigestApiError } from '../errors.js';
import { log } from '../log.js';
import { errorContent } from './get-findings.js';
import { getConventionsInput, getConventionsOutput } from '../schemas.js';
import {
  buildConventionsResult,
  describeConventionsResult,
} from '../shape/conventions.js';
import type { ResponseFormat } from '../shape/findings.js';

/**
 * Delivery ring — `get_conventions`: read the house rules the L02 extractor
 * already stored, and never run it.
 *
 * **This tool makes exactly two GET requests and no other request of any kind.**
 * `POST /repos/:id/conventions/extract` spends a real model call and is rate
 * limited to 10/min (`server/src/modules/conventions/routes.ts`), so a read tool
 * that "helpfully" triggers a scan when it finds nothing would bill the user for
 * asking a question. The tool's own description promises it never does, and
 * `test/conventions.test.ts` asserts it against a stubbed fetch that records
 * every request it was handed — not merely that nothing threw.
 *
 * The empty answer is the interesting one, and it is built in
 * `shape/conventions.ts`: nothing stored and nothing accepted are two different
 * states with two different next steps, and neither of them is "this repository
 * has no conventions". Both come back with `isError: false` — nothing failed,
 * and an error would send a caller looking for a broken stack.
 */

/** What the handler needs, with the defaults `schemas.ts` publishes made optional. */
export interface GetConventionsArgs {
  readonly repo: string;
  readonly response_format?: ResponseFormat | undefined;
  readonly limit?: number | undefined;
}

export function registerGetConventions(
  server: McpServer,
  deps: { readonly api: ApiClient },
): void {
  server.registerTool(
    'get_conventions',
    {
      title: 'Read a repository’s extracted conventions',
      description: TOOL_DESCRIPTIONS.get_conventions,
      inputSchema: getConventionsInput,
      outputSchema: getConventionsOutput,
      annotations: { readOnlyHint: true },
    },
    (args: GetConventionsArgs) => runGetConventions(deps.api, args),
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
export async function runGetConventions(
  api: ApiClient,
  args: GetConventionsArgs,
): Promise<CallToolResult> {
  const responseFormat: ResponseFormat = args.response_format ?? 'concise';

  try {
    // `resolveRepo` is the case-insensitive match and the source of the "add the
    // repo in DevDigest" error text. It is also why this tool needs nothing from
    // Step 3's lookup route: conventions are keyed by repo, not by pull request.
    const repo = await resolveRepo(api, args.repo);
    const candidates = await api.get<ConventionCandidate[]>(
      `/repos/${encodeURIComponent(repo.id)}/conventions`,
    );

    const result = buildConventionsResult({
      // The repository's own casing, not the caller's — so an answer is never
      // attributed to a spelling DevDigest does not have.
      repo: repo.full_name,
      candidates,
      responseFormat,
      limit: args.limit,
    });

    return {
      content: [
        { type: 'text', text: describeConventionsResult(result) },
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  } catch (error) {
    // Every business failure is a tool-level error, never a thrown protocol
    // fault: the process has to stay alive and answer the next call even with
    // nothing listening on :3001.
    if (!isDevDigestApiError(error)) throw error;
    log('get_conventions failed', error);
    // No `structuredContent` on an error path — see `errorContent` in
    // `get-findings.ts` for why a validating client makes that mandatory.
    return errorContent(error.code, error.message);
  }
}
