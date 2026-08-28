import {
  InMemoryTransport,
  type JSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import type { ConventionCandidate, PrMeta, Repo, ReviewRunResponse } from '@devdigest/shared';

import { ApiClient, type FetchLike, type HttpResponse } from '../src/api/client.js';
import { loadConfig, type McpConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { slugify } from '../src/shape/agents.js';

/**
 * The live lane — the three tools driven against a **running** DevDigest API.
 *
 * Run with `pnpm test:live` (`vitest.live.config.ts`); `pnpm test` never picks
 * this file up. What it is for: the hermetic lane proves the tools behave
 * correctly against the responses we *believe* the API sends, and this one
 * proves those beliefs. Because every call goes through `createServer` and the
 * SDK validates a result's `structuredContent` against the tool's declared
 * `outputSchema`, a real response that no longer fits the published shape fails
 * here — which is the closest thing this package has to the CI coverage it does
 * not have.
 *
 * **It self-skips when `GET /health` is unreachable**, mirroring how `server/`'s
 * `*.it.test.ts` lane skips without Docker (`TESTING.md`). A live lane that goes
 * red when the stack is simply not running teaches everyone to ignore it.
 *
 * **Nothing here spends money.** Two tools are read-only, and the third —
 * `run_agent_on_pr` — is exercised on its timeout branch with the ONE call that
 * costs money intercepted (see the suite's own note). A full paid review is a
 * manual acceptance step, for the same reason `server/INSIGHTS.md` 2026-08-01
 * gives about run-related UI: it needs a real key and a real bill.
 */

const HEALTH_TIMEOUT_MS = 2_000;

/** Seed literals. `server/src/db/seed.ts` owns them; a live DB may not carry them. */
const SEEDED_REPO = 'acme/payments-api';
const SEEDED_PR = 482;
const SEEDED_AGENT_SLUG = 'general-reviewer';

/** Read through the same variable the server does, so both look at one API. */
const baseUrl = loadConfig(process.env).apiBaseUrl;

/** A GET against the live API that answers `null` instead of throwing. */
async function probe<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Preconditions, probed once at collection time — the same shape as the
// server's `const hasDocker = await dockerAvailable()`.
// ---------------------------------------------------------------------------

const apiUp = (await probe<{ status: string }>('/health')) !== null;

if (!apiUp) {
  // stderr, and worded so nobody has to open this file to learn what to do.
  console.warn(
    `[mcp live] SKIPPED — no DevDigest API answered GET ${baseUrl}/health within ` +
      `${HEALTH_TIMEOUT_MS}ms. Start the stack with ./scripts/dev.sh (or point ` +
      `DEVDIGEST_API_URL somewhere else) and run pnpm test:live again.`,
  );
}

const repos = apiUp ? ((await probe<Repo[]>('/repos')) ?? []) : [];
const firstRepo = repos[0] ?? null;

/**
 * A repository whose extracted conventions include nothing accepted — the
 * "empty list is not an empty answer" case the plan's test plan asks for. On a
 * freshly seeded DB that is the demo repo, which carries three `pending`
 * candidates and no accepted one.
 */
const repoWithNothingAccepted = await findRepoWithNothingAccepted();

async function findRepoWithNothingAccepted(): Promise<string | null> {
  for (const repo of repos) {
    const candidates = await probe<ConventionCandidate[]>(
      `/repos/${encodeURIComponent(repo.id)}/conventions`,
    );
    if (candidates && !candidates.some((candidate) => candidate.status === 'accepted')) {
      return repo.full_name;
    }
  }
  return null;
}

/** The seeded pull request, resolved through the very route `resolvePull` uses. */
const seededPull = apiUp
  ? await probe<PrMeta>(
      `/pulls/lookup?repo=${encodeURIComponent(SEEDED_REPO)}&number=${SEEDED_PR}`,
    )
  : null;

const live = apiUp ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Harness: the real server, over an in-memory transport, over the real network.
// ---------------------------------------------------------------------------

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
}

interface CallToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface JsonRpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * A `fetch` that reaches the real API and records every request on the way.
 *
 * The recording is what turns "this tool never spends money" from a claim into
 * an assertion: the list of requests is inspected afterwards, so a POST that
 * should not exist is visible even when it succeeded quietly.
 *
 * `intercept` may answer a request instead of sending it — used by exactly one
 * suite below, for exactly one endpoint, and documented there.
 */
function liveFetch(
  recorded: RecordedRequest[],
  intercept?: (method: string, url: string) => unknown | undefined,
): FetchLike {
  return async (url, init) => {
    const method = init?.method ?? 'GET';
    recorded.push({ method, url });

    const stubbed = intercept?.(method, url);
    if (stubbed !== undefined) return jsonResponse(200, stubbed);

    return fetch(url, init as RequestInit);
  };
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

/** Drive one tool through the real server and the real MCP result validation. */
async function callTool(
  deps: { api: ApiClient; config: McpConfig },
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const mcp = createServer(deps);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = rpcClient(clientSide);
  await mcp.connect(serverSide);
  await clientSide.start();

  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'mcp-live-test', version: '0.0.0' },
  });
  await client.notify('notifications/initialized');
  const response = await client.request('tools/call', { name, arguments: args });
  await mcp.close();
  return (response.result ?? {}) as CallToolResult;
}

function rpcClient(transport: Transport) {
  const pending = new Map<number, (message: JsonRpcResponse) => void>();
  let nextId = 1;
  transport.onmessage = (message) => {
    const response = message as unknown as JsonRpcResponse;
    if (response.id === undefined) return;
    pending.get(response.id)?.(response);
    pending.delete(response.id);
  };
  return {
    async request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
      const id = nextId++;
      const answered = new Promise<JsonRpcResponse>((resolve) => pending.set(id, resolve));
      await transport.send({ jsonrpc: '2.0', id, method, params } as unknown as JSONRPCMessage);
      return answered;
    },
    notify(method: string): Promise<void> {
      return transport.send({ jsonrpc: '2.0', method } as unknown as JSONRPCMessage);
    },
  };
}

/** Everything a tool needs, built over the live API. */
function liveDeps(recorded: RecordedRequest[], env: Record<string, string> = {}) {
  const config = loadConfig({ ...process.env, ...env });
  return {
    api: new ApiClient({ baseUrl: config.apiBaseUrl, fetch: liveFetch(recorded) }),
    config,
  };
}

function textOf(result: CallToolResult): string {
  return (result.content ?? []).map((block) => block.text ?? '').join('\n');
}

// ---------------------------------------------------------------------------

live('list_agents against the running workspace', () => {
  it('returns the configured agents with the slug this package mints', async () => {
    const recorded: RecordedRequest[] = [];
    const result = await callTool(liveDeps(recorded), 'list_agents');

    expect(result.isError, textOf(result)).toBeFalsy();
    expect(recorded).toEqual([{ method: 'GET', url: `${baseUrl}/agents` }]);

    const agents = (result.structuredContent as { agents?: unknown[] } | undefined)?.agents ?? [];
    expect(agents.length, 'the workspace has at least one reviewer agent').toBeGreaterThan(0);

    for (const agent of agents as Array<Record<string, unknown>>) {
      // The slug is derived here and owned by nobody on the server (D8), so the
      // live check is that what a caller is handed really is the kebab-cased
      // name it will be matched by.
      expect(agent.slug).toBe(slugify(String(agent.name)));
      expect(typeof agent.enabled).toBe('boolean');
    }

    const slugs = (agents as Array<{ slug: string }>).map((agent) => agent.slug);
    expect(new Set(slugs).size, 'two agents must not share a slug').toBe(slugs.length);
    expect(
      slugs,
      `the seeded ${SEEDED_AGENT_SLUG} is missing — run pnpm db:seed in server/`,
    ).toContain(SEEDED_AGENT_SLUG);

    // The JSON text block and the structured payload are the same answer.
    expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
  });
});

live('get_conventions against the running workspace', () => {
  it('reports the stored candidates and never runs the extractor', async () => {
    if (!firstRepo) {
      throw new Error('the API answered GET /repos with no repository at all — run pnpm db:seed');
    }
    const recorded: RecordedRequest[] = [];
    // Deliberately the wrong casing: the case-insensitive match lives in
    // `api/resolve.ts`, and the answer must still be attributed to DevDigest's
    // own spelling.
    const result = await callTool(liveDeps(recorded), 'get_conventions', {
      repo: firstRepo.full_name.toUpperCase(),
    });

    expect(result.isError, textOf(result)).toBeFalsy();
    const payload = result.structuredContent as {
      repo: string;
      accepted: number;
      pending: number;
      rejected: number;
      conventions: unknown[];
    };
    expect(payload.repo).toBe(firstRepo.full_name);
    for (const count of [payload.accepted, payload.pending, payload.rejected]) {
      expect(Number.isInteger(count) && count >= 0).toBe(true);
    }
    expect(payload.conventions.length).toBeLessThanOrEqual(payload.accepted);

    // The one thing this read tool must never do: a scan costs a model call.
    expect(recorded.every((request) => request.method === 'GET')).toBe(true);
    expect(recorded.some((request) => request.url.includes('/conventions/extract'))).toBe(false);
  });

  it.skipIf(!repoWithNothingAccepted)(
    'answers a repository with nothing accepted without calling it empty',
    async () => {
      const recorded: RecordedRequest[] = [];
      const result = await callTool(liveDeps(recorded), 'get_conventions', {
        repo: repoWithNothingAccepted as string,
      });

      // Nothing failed, so this is not an error — an error would send the caller
      // looking for a broken stack.
      expect(result.isError, textOf(result)).toBeFalsy();
      const payload = result.structuredContent as { accepted: number; conventions: unknown[] };
      expect(payload.accepted).toBe(0);
      expect(payload.conventions).toEqual([]);

      // And it says which of the two empty states this is, in words.
      const text = textOf(result);
      expect(text).toMatch(/extractor/i);
      expect(text).toMatch(/pending|never run/i);
    },
  );
});

live('get_blast_radius against the running workspace', () => {
  it.skipIf(!seededPull)(
    'answers with a map or with a reason, and never with an error',
    async () => {
      const recorded: RecordedRequest[] = [];
      // Deliberately the wrong casing, for the reason `get_conventions` gives:
      // the case-insensitive match lives in `api/resolve.ts`.
      const result = await callTool(liveDeps(recorded), 'get_blast_radius', {
        repo: SEEDED_REPO.toUpperCase(),
        pr: SEEDED_PR,
      });

      // The point of the whole feature, asserted live: the answer is a RESULT
      // whatever the index turned out to know. `acme/payments-api` is seeded
      // with no clone and no index, so this is normally the degraded branch —
      // and a degraded branch is still `isError: false`, because nothing failed.
      expect(result.isError, textOf(result)).toBeFalsy();

      const payload = result.structuredContent as {
        repo: string;
        pr: number;
        status: string;
        reason: string | null;
        indexed_sha: string | null;
        changed_symbols: unknown[];
        downstream: Array<{ callers: unknown[] }>;
      };
      // DevDigest's own spelling, not the shouted one the caller passed.
      expect(payload.repo).toBe(SEEDED_REPO);
      expect(payload.pr).toBe(SEEDED_PR);
      expect(['ok', 'partial', 'degraded']).toContain(payload.status);

      // The invariant that outlived the stub: an empty map always carries a
      // reason, so it can never be read as "this pull request affects nothing".
      if (payload.changed_symbols.length === 0) {
        expect(payload.reason, 'an empty map must say why').not.toBeNull();
      }
      if (payload.status === 'degraded') {
        expect(textOf(result)).toContain('re-analyze the repository');
        expect(payload.indexed_sha).toBeNull();
      }

      // GETs and nothing else: this tool must never trigger a review or an
      // index. The wrong casing costs the extra `/repos` round-trip and a second
      // lookup, which is `api/resolve.ts`'s documented fallback, so the shape
      // asserted here is the TAIL — the map is always read through the pull id
      // the lookup resolved.
      expect(recorded.every((request) => request.method === 'GET')).toBe(true);
      expect(recorded.map((request) => request.url.replace(baseUrl, '')).slice(-2)).toEqual([
        `/pulls/lookup?repo=${encodeURIComponent(SEEDED_REPO)}&number=${SEEDED_PR}`,
        `/pulls/${seededPull!.id}/blast`,
      ]);
    },
  );
});

live('run_agent_on_pr — the timeout branch, live and unpaid', () => {
  /**
   * `DEVDIGEST_MCP_RUN_TIMEOUT_MS=1` makes the wait give up after its first
   * poll, which is what puts `status: "still_running"` under test. The rest of
   * the path is genuinely live: `GET /agents` resolves the agent,
   * `GET /pulls/lookup` resolves the pull request through the route Step 3
   * added, and `GET /pulls/:id/runs` is a real poll against the real API.
   *
   * **One call is intercepted: `POST /pulls/:id/review`.** Setting the timeout
   * to 1 ms stops this tool WAITING for a run; it does not stop the run. The
   * trigger is fire-and-forget, so the API would start a real review in the
   * background and bill a real model call however quickly the tool returns —
   * "without spending a model call" is only true if the trigger never leaves
   * this process. So it is answered here with a run id that does not exist,
   * which is also what makes the poll time out deterministically instead of
   * depending on how fast a review happens to be. The full paid path is the
   * manual acceptance step, driven from a Claude Code session.
   */
  const PHANTOM_RUN_ID = '00000000-0000-4000-8000-000000000000';

  it.skipIf(!seededPull)('reports a run it stopped waiting for, and never a verdict', async () => {
    const pull = seededPull as PrMeta;
    const recorded: RecordedRequest[] = [];
    const config = loadConfig({ ...process.env, DEVDIGEST_MCP_RUN_TIMEOUT_MS: '1' });
    expect(config.runTimeoutMs).toBe(1);

    // The agent id the intercepted trigger has to echo back, read live and
    // outside the recording so the tool's own request list stays its own.
    const agents = (await probe<Array<{ id: string; name: string }>>('/agents')) ?? [];
    const seededAgent = agents.find((agent) => slugify(agent.name) === SEEDED_AGENT_SLUG);
    expect(
      seededAgent,
      `no seeded ${SEEDED_AGENT_SLUG} — run pnpm db:seed in server/`,
    ).toBeDefined();

    let triggers = 0;
    const api = new ApiClient({
      baseUrl: config.apiBaseUrl,
      fetch: liveFetch(recorded, (method, url) => {
        if (method !== 'POST' || !url.endsWith(`/pulls/${pull.id}/review`)) return undefined;
        triggers += 1;
        const response: ReviewRunResponse = {
          pr_id: String(pull.id),
          runs: [
            {
              run_id: PHANTOM_RUN_ID,
              agent_id: seededAgent?.id ?? '',
              agent_name: seededAgent?.name ?? SEEDED_AGENT_SLUG,
            },
          ],
          reviews: [],
        };
        return response;
      }),
    });

    const result = await callTool({ api, config }, 'run_agent_on_pr', {
      repo: SEEDED_REPO,
      pr: SEEDED_PR,
      agent: SEEDED_AGENT_SLUG,
    });

    expect(triggers, 'the paying call must have been intercepted exactly once').toBe(1);
    expect(result.isError).toBe(true);

    // The payload rides in the JSON text block, not `structuredContent`: a
    // still-running answer cannot satisfy `runAgentOnPrOutput`, and a validating
    // client rejects a result whose structuredContent contradicts its schema.
    expect(result.structuredContent).toBeUndefined();
    const payload = JSON.parse(String(result.content?.[1]?.text ?? '{}')) as Record<
      string,
      unknown
    >;
    expect(payload.status).toBe('still_running');
    expect(payload.run_id).toBe(PHANTOM_RUN_ID);
    // D6: not a verdict, and not an empty findings list either.
    expect(Object.keys(payload)).not.toContain('verdict');
    expect(Object.keys(payload)).not.toContain('findings');

    // D5/D6 wording: the follow-up is the free tool, never a second paid run.
    const text = textOf(result);
    expect(text).toContain('get_findings');
    expect(text).not.toContain('run_agent_on_pr(');

    // The live half: the lookup route and the run poll really were called.
    const urls = recorded.map((request) => request.url);
    expect(urls.some((url) => url.includes('/pulls/lookup?'))).toBe(true);
    expect(urls).toContain(`${baseUrl}/pulls/${pull.id}/runs`);
    // And exactly one POST, the intercepted one: nothing else wrote anything.
    expect(recorded.filter((request) => request.method === 'POST')).toHaveLength(1);
  });
});
