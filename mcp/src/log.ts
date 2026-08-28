/**
 * The one logging helper, and the reason it is a helper at all.
 *
 * On the stdio transport **stdout is the JSON-RPC channel** (D12). One line
 * printed to stdout anywhere in this package lands in the middle of the protocol
 * stream, and the client's reaction is to drop the connection — which shows up as
 * "the server does not appear", with the cause visible only on stderr. So every
 * diagnostic goes to stderr, through here, and the three stdout-writing console
 * methods are forbidden in `mcp/src` — by a grep, which is why this comment does
 * not spell their names out (root `INSIGHTS.md` 2026-08-23: a criterion written
 * as a grep over source also polices the comments).
 */

/** Prefix on every line, so the client's stderr pane says which server spoke. */
const PREFIX = '[devdigest-mcp]';

/**
 * Write one diagnostic line to stderr.
 *
 * `detail` is serialized defensively: a logger that throws while reporting a
 * failure replaces the failure with its own.
 */
export function log(message: string, detail?: unknown): void {
  console.error(detail === undefined ? `${PREFIX} ${message}` : `${PREFIX} ${message} ${describe(detail)}`);
}

function describe(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`;
  try {
    return JSON.stringify(detail) ?? String(detail);
  } catch {
    return String(detail);
  }
}
