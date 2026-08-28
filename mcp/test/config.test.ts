import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ApiClient,
  classifyStatus,
  describeTransportFailure,
  isConnectionRefused,
  type FetchLike,
  type HttpResponse,
} from '../src/api/client.js';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_RUN_TIMEOUT_MS,
  ENV_API_URL,
  ENV_RUN_TIMEOUT_MS,
  loadConfig,
} from '../src/config.js';
import { DevDigestApiError, isDevDigestApiError } from '../src/errors.js';

/**
 * Step 1's surface: the one environment reader, and the one module that speaks
 * HTTP. Later steps add a file per concern; these two ship together because the
 * client's classification is only meaningful against the config it was handed.
 */

const BASE_URL = 'http://localhost:3001';

/** A stub `fetch` that answers once with the given status and body. */
function respondWith(status: number, body: unknown): FetchLike {
  return async () => jsonResponse(status, body);
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  };
}

function client(fetchImpl: FetchLike): ApiClient {
  return new ApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });
}

async function captureError(run: () => Promise<unknown>): Promise<DevDigestApiError> {
  try {
    await run();
  } catch (error) {
    if (isDevDigestApiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to reject with a DevDigestApiError');
}

describe('loadConfig', () => {
  it('defaults to the local API and a two-minute run ceiling', () => {
    expect(loadConfig({})).toEqual({
      apiBaseUrl: DEFAULT_API_BASE_URL,
      runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS,
    });
    expect(DEFAULT_API_BASE_URL).toBe('http://localhost:3001');
    expect(DEFAULT_RUN_TIMEOUT_MS).toBe(120_000);
  });

  it('treats an empty or blank variable as unset', () => {
    expect(loadConfig({ [ENV_API_URL]: '', [ENV_RUN_TIMEOUT_MS]: '   ' })).toEqual({
      apiBaseUrl: DEFAULT_API_BASE_URL,
      runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS,
    });
  });

  it('reads both variables when they are set', () => {
    expect(
      loadConfig({
        [ENV_API_URL]: 'https://devdigest.internal:8443',
        [ENV_RUN_TIMEOUT_MS]: '45000',
      }),
    ).toEqual({ apiBaseUrl: 'https://devdigest.internal:8443', runTimeoutMs: 45_000 });
  });

  it('strips trailing slashes so a joined path never doubles them', () => {
    const { apiBaseUrl } = loadConfig({ [ENV_API_URL]: 'http://localhost:3001//' });
    expect(apiBaseUrl).toBe('http://localhost:3001');
    expect(`${apiBaseUrl}/agents`).toBe('http://localhost:3001/agents');
  });

  it('accepts a timeout of 1 ms — the degraded path drives the timeout branch with it', () => {
    expect(loadConfig({ [ENV_RUN_TIMEOUT_MS]: '1' }).runTimeoutMs).toBe(1);
  });

  it('rejects a malformed timeout instead of silently using the default', () => {
    for (const bad of ['120s', '0', '-1', '1.5', 'null']) {
      expect(() => loadConfig({ [ENV_RUN_TIMEOUT_MS]: bad })).toThrow(ENV_RUN_TIMEOUT_MS);
    }
    expect(() => loadConfig({ [ENV_RUN_TIMEOUT_MS]: '120s' })).toThrow(/positive whole number/);
  });

  it('rejects a URL that is not an absolute http origin', () => {
    for (const bad of ['localhost:3001', '/api', 'ftp://localhost:3001']) {
      expect(() => loadConfig({ [ENV_API_URL]: bad })).toThrow(ENV_API_URL);
    }
  });

  it('accepts the real environment as its source', () => {
    // The type-level half of the D11 ring rule: `process.env` is the default
    // argument, so no other module ever needs to reach for it.
    const fromProcess = loadConfig();
    expect(typeof fromProcess.apiBaseUrl).toBe('string');
    expect(typeof fromProcess.runTimeoutMs).toBe('number');
  });
});

describe('ApiClient — the happy path', () => {
  it('joins the base URL with the path and returns the parsed body', async () => {
    const seen: Array<{ url: string; method: string | undefined }> = [];
    const api = client(async (url, init) => {
      seen.push({ url, method: init?.method });
      return jsonResponse(200, [{ id: 'a1', name: 'General Reviewer' }]);
    });

    await expect(api.get('/agents')).resolves.toEqual([{ id: 'a1', name: 'General Reviewer' }]);
    expect(seen).toEqual([{ url: 'http://localhost:3001/agents', method: 'GET' }]);
  });

  it('sends a POST body as JSON with the matching content type', async () => {
    let body: string | undefined;
    let contentType: string | undefined;
    const api = client(async (_url, init) => {
      body = init?.body;
      contentType = init?.headers?.['content-type'];
      return jsonResponse(200, { pr_id: 'p1', runs: ['r1'], reviews: [] });
    });

    await api.post('/pulls/p1/review', { agentId: 'a1' });
    expect(body).toBe('{"agentId":"a1"}');
    expect(contentType).toBe('application/json');
  });

  it('sends no body and no content type on a GET', async () => {
    let init: { body?: string; headers?: Record<string, string> } | undefined;
    const api = client(async (_url, received) => {
      init = received;
      return jsonResponse(200, {});
    });

    await api.get('/agents');
    expect(init?.body).toBeUndefined();
    expect(init?.headers?.['content-type']).toBeUndefined();
  });
});

describe('ApiClient — status classification', () => {
  it('maps the four statuses the plan names, and everything else to api_error', () => {
    expect(classifyStatus(404)).toBe('not_found');
    expect(classifyStatus(429)).toBe('rate_limited');
    expect(classifyStatus(500)).toBe('api_error');
    expect(classifyStatus(503)).toBe('api_error');
    expect(classifyStatus(422)).toBe('bad_request');
    expect(classifyStatus(400)).toBe('bad_request');
  });

  it('does not let 429 fall into the generic 4xx bucket', async () => {
    const error = await captureError(() =>
      client(respondWith(429, { error: { code: 'rate_limited', message: 'Too many requests' } })).get(
        '/agents',
      ),
    );
    expect(error.code).toBe('rate_limited');
    expect(error.status).toBe(429);
  });

  it('carries the API envelope through onto the error', async () => {
    const error = await captureError(() =>
      client(
        respondWith(404, {
          error: { code: 'not_found', message: 'Repo not found', details: { repo: 'acme/nope' } },
        }),
      ).get('/repos/acme%2Fnope'),
    );

    expect(error.code).toBe('not_found');
    expect(error.apiCode).toBe('not_found');
    expect(error.details).toEqual({ repo: 'acme/nope' });
    expect(error.message).toContain('Repo not found');
  });

  it('still classifies when the failing response carries no envelope at all', async () => {
    const api = client(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
      text: async () => '<html>bad gateway</html>',
    }));

    const error = await captureError(() => api.get('/agents'));
    expect(error.code).toBe('api_error');
    expect(error.status).toBe(502);
    expect(error.apiCode).toBeNull();
  });

  it('reports a 200 with an unparseable body as an api_error, not as data', async () => {
    const api = client(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
      text: async () => '',
    }));

    const error = await captureError(() => api.get('/agents'));
    expect(error.code).toBe('api_error');
  });
});

describe('ApiClient — a stack that is not running', () => {
  it('maps a refused connection to api_unreachable and names ./scripts/dev.sh', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), {
        code: 'ECONNREFUSED',
      }),
    });

    const error = await captureError(() =>
      client(async () => {
        throw refused;
      }).get('/agents'),
    );

    expect(error.code).toBe('api_unreachable');
    expect(error.status).toBeNull();
    expect(error.message).toContain('./scripts/dev.sh');
    expect(error.message).toContain(BASE_URL);
    expect(error.message).toContain('ECONNREFUSED');
  });

  it('finds ECONNREFUSED nested in an AggregateError, where the platform hides it', () => {
    const aggregate = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new AggregateError([]), {
        errors: [
          Object.assign(new Error('connect ECONNREFUSED ::1:3001'), { code: 'ECONNREFUSED' }),
          Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), {
            code: 'ECONNREFUSED',
          }),
        ],
      }),
    });

    expect(isConnectionRefused(aggregate)).toBe(true);
    // A flat check is what makes this worth a test: the thrown error itself says
    // nothing, so a one-level look would report false and mislabel the failure.
    expect((aggregate as { code?: string }).code).toBeUndefined();
  });

  it('does not claim ECONNREFUSED for an unrelated transport failure', () => {
    const dns = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND devdigest.invalid'), {
        code: 'ENOTFOUND',
      }),
    });

    expect(isConnectionRefused(dns)).toBe(false);
    expect(describeTransportFailure(dns)).toBe('fetch failed');
  });

  it('terminates on a self-referential cause chain', () => {
    const looping: { code?: string; cause?: unknown } = {};
    looping.cause = looping;
    expect(isConnectionRefused(looping)).toBe(false);
  });

  it('reports a transport failure without attributing words to the API', async () => {
    const error = await captureError(() =>
      client(async () => {
        throw new Error('socket hang up');
      }).get('/agents'),
    );

    expect(error.code).toBe('api_unreachable');
    expect(error.message).not.toContain('The API said');
    expect(error.message).toContain('socket hang up');
  });
});

describe('the injected fetch', () => {
  it('is satisfied by the platform global, so nothing adapts in production', () => {
    // A compile-time assertion first and foremost: if `FetchLike` ever drifts
    // away from the real signature, `pnpm typecheck` fails here rather than at
    // the MCP handshake, on stderr, in a client that shows no server.
    const platformFetch: FetchLike = globalThis.fetch;
    expect(typeof platformFetch).toBe('function');
  });
});

/**
 * The client's bound and the server's wait live in two files and must stay
 * ordered, which is exactly the shape of a drift that nothing notices: raising
 * `DEVDIGEST_MCP_RUN_TIMEOUT_MS` past the client's `timeout` costs nothing at
 * startup and only shows up as a tool call that dies before it can say
 * `still_running`.
 *
 * `.mcp.json` is read from disk rather than restated here — a second copy of the
 * number would agree with itself and with nothing else.
 */
describe("the client's timeout in .mcp.json", () => {
  const entry = JSON.parse(
    readFileSync(new URL('../../.mcp.json', import.meta.url), 'utf8'),
  ).mcpServers.devdigest as { timeout?: unknown };

  it('is declared, so a client does not fall back to its own default', () => {
    expect(typeof entry.timeout, '.mcp.json → mcpServers.devdigest.timeout').toBe('number');
  });

  it('leaves room above the wait run_agent_on_pr performs on purpose', () => {
    // Strictly above: at parity the client can still win the race, and the race
    // is over which of the two messages the model reads.
    expect(entry.timeout as number).toBeGreaterThan(DEFAULT_RUN_TIMEOUT_MS);
  });
});
