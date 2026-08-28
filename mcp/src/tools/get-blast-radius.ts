import type { McpServer } from '@modelcontextprotocol/server';

import { TOOL_DESCRIPTIONS } from '../copy.js';
import { getBlastRadiusInput, getBlastRadiusOutput } from '../schemas.js';

/**
 * Delivery ring — the honest stub (D13).
 *
 * `get_blast_radius` is declared now so its name and its two arguments stay
 * stable when the real implementation lands, and it **fails loudly** until then:
 *
 * - it makes **no HTTP request at all** — there is no `ApiClient` in this module,
 *   which is what makes "it calls nothing" a fact of the file rather than a claim
 *   in a test;
 * - it returns `isError: true`, so no client can mistake the answer for a result;
 * - it emits **no** `changed_symbols` and **no** `downstream` key, not even as
 *   empty arrays. An empty array is the exact lie this tool exists to avoid: it
 *   reads as "this pull request affects nothing", which is a claim nobody has
 *   checked.
 */
export const BLAST_RADIUS_LESSON = 'L04 part two';

const NOT_IMPLEMENTED_MESSAGE =
  'get_blast_radius is not implemented yet: DevDigest cannot currently compute what a pull ' +
  "request's changes reach downstream, and this tool will not guess. Do not read this failure " +
  'as "the pull request affects nothing" — nothing was analysed. To judge impact today, run a ' +
  'reviewer agent with run_agent_on_pr and read its findings.';

export function registerGetBlastRadius(server: McpServer): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Blast radius (not implemented)',
      description: TOOL_DESCRIPTIONS.get_blast_radius,
      inputSchema: getBlastRadiusInput,
      outputSchema: getBlastRadiusOutput,
      annotations: { readOnlyHint: true },
    },
    () => {
      const payload = {
        status: 'not_implemented' as const,
        implemented_in: BLAST_RADIUS_LESSON,
        message: NOT_IMPLEMENTED_MESSAGE,
      };
      return {
        content: [
          { type: 'text', text: NOT_IMPLEMENTED_MESSAGE },
          { type: 'text', text: JSON.stringify(payload, null, 2) },
        ],
        structuredContent: payload,
        isError: true,
      };
    },
  );
}
