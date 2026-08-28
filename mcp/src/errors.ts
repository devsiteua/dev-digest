/**
 * Pure ring — the error taxonomy and the words each code is reported with.
 *
 * Nothing here awaits, reads the environment or speaks HTTP. The infrastructure
 * ring maps a transport failure onto one of these codes; the delivery ring turns
 * the result into an MCP error content block.
 *
 * Every message leads with what to do next. A tool that says "404" has told the
 * model nothing it can act on.
 */

export const MCP_ERROR_CODES = [
  'api_unreachable',
  'not_found',
  'rate_limited',
  'bad_request',
  'api_error',
] as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

export interface ErrorTextContext {
  /** The API origin the call was aimed at. */
  readonly baseUrl: string;
  /** The request that failed, for example `GET /agents`. */
  readonly request: string;
  /** The API's own `error.message`, when it sent an envelope. */
  readonly apiMessage?: string | undefined;
  /**
   * Why the request never reached the API. Kept separate from `apiMessage`
   * because a transport failure means the API said nothing at all, and text that
   * attributes it to the API sends the reader to the wrong terminal.
   */
  readonly reason?: string | undefined;
}

/**
 * The forward-leading sentence for a code: what happened, then the next step.
 *
 * `api_unreachable` names `./scripts/dev.sh` because that is the single command
 * that brings the whole stack up; the MCP server is spawned by its client and
 * never starts the API itself.
 */
export function errorText(code: McpErrorCode, ctx: ErrorTextContext): string {
  const suffix =
    (ctx.apiMessage ? ` The API said: ${ctx.apiMessage}` : '') +
    (ctx.reason ? ` (${ctx.reason})` : '');

  switch (code) {
    case 'api_unreachable':
      return (
        `The DevDigest API at ${ctx.baseUrl} is not answering, so ${ctx.request} could not be sent. ` +
        `Start the stack with ./scripts/dev.sh from the repository root, wait for the API to report ` +
        `it is listening, then call this tool again.` +
        suffix
      );
    case 'not_found':
      return (
        `DevDigest has no record of what ${ctx.request} asked for. ` +
        `Check the repository has been imported into DevDigest and that the pull request has been ` +
        `opened in that repository's PR list, then call this tool again.` +
        suffix
      );
    case 'rate_limited':
      return (
        `DevDigest rate-limited ${ctx.request}. ` +
        `Wait a few seconds and repeat the same call — do not start a second review, which would ` +
        `spend another model call.` +
        suffix
      );
    case 'bad_request':
      return (
        `DevDigest rejected ${ctx.request} as invalid. ` +
        `Check the arguments against the tool's description; the values are wrong, not the stack.` +
        suffix
      );
    case 'api_error':
      return (
        `The DevDigest API failed while handling ${ctx.request}. ` +
        `Read the API's terminal output for the cause, then call this tool again once it is fixed.` +
        suffix
      );
  }
}

/**
 * A failure of a call to the DevDigest API, already classified and already
 * carrying the text a caller should be shown.
 */
export class DevDigestApiError extends Error {
  readonly code: McpErrorCode;
  /** The HTTP status, or `null` when the request never reached the API. */
  readonly status: number | null;
  /** The API's own `error.code`, when it sent an envelope. */
  readonly apiCode: string | null;
  /** The API's own `error.details`, passed through untouched. */
  readonly details: unknown;

  constructor(args: {
    code: McpErrorCode;
    message: string;
    status?: number | null;
    apiCode?: string | null;
    details?: unknown;
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = 'DevDigestApiError';
    this.code = args.code;
    this.status = args.status ?? null;
    this.apiCode = args.apiCode ?? null;
    this.details = args.details;
  }
}

export function isDevDigestApiError(value: unknown): value is DevDigestApiError {
  return value instanceof DevDigestApiError;
}
