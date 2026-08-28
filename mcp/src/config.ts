/**
 * Composition ring — the ONLY module in `mcp/src` that reads the environment.
 *
 * Every other ring receives its configuration as an argument. That is what keeps
 * the tool and shape rings pure enough to unit-test without a process, and it is
 * checkable by grep rather than by argument (see `mcp/CLAUDE.md`).
 */

/** Where the DevDigest API is listening. */
export const DEFAULT_API_BASE_URL = 'http://localhost:3001';

/** How long `run_agent_on_pr` waits for a review to reach a terminal state. */
export const DEFAULT_RUN_TIMEOUT_MS = 120_000;

export const ENV_API_URL = 'DEVDIGEST_API_URL';
export const ENV_RUN_TIMEOUT_MS = 'DEVDIGEST_MCP_RUN_TIMEOUT_MS';

export interface McpConfig {
  /** Absolute origin of the API, never with a trailing slash. */
  readonly apiBaseUrl: string;
  /** Upper bound on the review wait, in milliseconds. */
  readonly runTimeoutMs: number;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Read the two variables this server understands.
 *
 * A malformed value throws rather than falling back to the default: the fallback
 * would turn a typo into a silently different timeout, and this is read once at
 * startup where the failure is deterministic and visible on stderr.
 */
export function loadConfig(env: EnvSource = process.env): McpConfig {
  return {
    apiBaseUrl: readBaseUrl(env[ENV_API_URL]),
    runTimeoutMs: readTimeoutMs(env[ENV_RUN_TIMEOUT_MS]),
  };
}

function readBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_API_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `${ENV_API_URL} is not a valid URL: ${JSON.stringify(value)}. ` +
        `Expected an absolute origin such as ${DEFAULT_API_BASE_URL}.`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `${ENV_API_URL} must be an http or https URL, got ${JSON.stringify(value)}.`,
    );
  }
  // Trailing slashes are stripped here so every caller can join paths with a
  // plain `${baseUrl}${path}` and never produce a double slash.
  return value.replace(/\/+$/, '');
}

function readTimeoutMs(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_RUN_TIMEOUT_MS;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${ENV_RUN_TIMEOUT_MS} must be a positive whole number of milliseconds, ` +
        `got ${JSON.stringify(value)}.`,
    );
  }
  // Deliberately no lower clamp: the degraded-path acceptance test drives the
  // timeout branch with a value of 1.
  return parsed;
}
