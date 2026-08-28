import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { BlastRadiusResponse } from '@devdigest/shared';

import type { ApiClient } from '../api/client.js';
import { resolvePull } from '../api/resolve.js';
import { TOOL_DESCRIPTIONS } from '../copy.js';
import { isDevDigestApiError } from '../errors.js';
import { log } from '../log.js';
import { errorContent } from './get-findings.js';
import { getBlastRadiusInput, getBlastRadiusOutput } from '../schemas.js';
import { buildBlastResult, describeBlastResult } from '../shape/blast.js';

/**
 * Delivery ring — `get_blast_radius`: what a pull request's diff can reach.
 *
 * **Two GET requests and no other request of any kind.** The lookup that turns
 * `owner/name` + a number into an internal id, and the map itself. The server
 * computes that map from its static index — no AST parse, no import-graph build
 * and no model call on that path — so a caller can ask this as often as they
 * like and it stays free.
 *
 * The honest answer is the interesting one here, and it is why this tool no
 * longer refuses to speak. D13's stub returned `isError: true` with no
 * `changed_symbols` and no `downstream` key, because an empty array reads as
 * "this pull request affects nothing" and nothing had checked. The server now
 * answers that with two fields instead of with silence: `status` says whether
 * the index could speak and `reason` says why the map looks the way it does. A
 * `degraded` map comes back with `isError: false` — nothing failed, DevDigest
 * simply has no index to read — and the text block above the JSON says so in the
 * same words the stub used to.
 */
export interface GetBlastRadiusArgs {
  readonly repo: string;
  readonly pr: number;
}

export function registerGetBlastRadius(
  server: McpServer,
  deps: { readonly api: ApiClient },
): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Blast radius of a pull request',
      description: TOOL_DESCRIPTIONS.get_blast_radius,
      inputSchema: getBlastRadiusInput,
      outputSchema: getBlastRadiusOutput,
      annotations: { readOnlyHint: true },
    },
    (args: GetBlastRadiusArgs) => runGetBlastRadius(deps.api, args),
  );
}

/**
 * The handler itself, exported so the unit lane can drive it with a stubbed
 * `fetch` and no MCP transport at all — the registration above stays one line
 * for that reason, and the protocol surface is asserted once, over the wire, in
 * `test/tool-surface.test.ts`.
 */
export async function runGetBlastRadius(
  api: ApiClient,
  args: GetBlastRadiusArgs,
): Promise<CallToolResult> {
  try {
    // `resolvePull` is the case-insensitive repository match and the source of
    // the "open the repo's PR list so PR #N is imported" error text.
    const pull = await resolvePull(api, args.repo, args.pr);
    const map = await api.get<BlastRadiusResponse>(
      `/pulls/${encodeURIComponent(pull.id)}/blast`,
    );

    const result = buildBlastResult({
      // The repository's own casing, not the caller's — so an answer is never
      // attributed to a spelling DevDigest does not have.
      repo: pull.repo,
      pr: pull.pr.number,
      map,
    });

    return {
      content: [
        { type: 'text', text: describeBlastResult(result) },
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  } catch (error) {
    // Every business failure is a tool-level error, never a thrown protocol
    // fault: the process has to stay alive and answer the next call even with
    // nothing listening on :3001.
    if (!isDevDigestApiError(error)) throw error;
    log('get_blast_radius failed', error);
    // No `structuredContent` on an error path. That USED to be this tool's one
    // exemption — its declared shape was its error shape — and the exemption is
    // gone with the stub: the schema above is now the success shape, so an error
    // payload could not satisfy it and a validating client would reject the whole
    // result. See `errorContent` in `get-findings.ts`.
    return errorContent(error.code, error.message);
  }
}
