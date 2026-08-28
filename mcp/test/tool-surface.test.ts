import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { InMemoryTransport, type JSONRPCMessage, type Transport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiClient, type FetchLike, type HttpResponse } from '../src/api/client.js';
import { DEFAULT_API_BASE_URL, DEFAULT_RUN_TIMEOUT_MS } from '../src/config.js';
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from '../src/copy.js';
import { TOOL_NAMES } from '../src/schemas.js';
import { createServer } from '../src/server.js';

/**
 * The published surface, asserted from OUTSIDE the process.
 *
 * The first half spawns `src/index.ts` exactly as a client does and drives
 * `initialize` + `tools/list` over stdio, because the thing under test is what a
 * client actually receives: the tool names, their annotations, their JSON
 * Schemas and the `instructions` paragraph. Reading those off the Zod objects
 * in-process would test our intent rather than the wire.
 *
 * The second half calls tools in-process over an in-memory transport, where the
 * `fetch` implementation can be stubbed — which is how "the stub makes no HTTP
 * request" becomes an assertion rather than a claim.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX = `${PACKAGE_ROOT}node_modules/.bin/tsx`;
const ENTRY = `${PACKAGE_ROOT}src/index.ts`;

interface JsonRpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface PublishedTool {
  name: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
}

interface JsonSchema {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  $defs?: Record<string, unknown>;
}

/** A minimal JSON-RPC client over the child's stdio — no SDK client package needed. */
class SpawnedServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: JsonRpcResponse) => void>();
  private stdout = '';
  private nextId = 1;
  stderr = '';

  constructor() {
    this.child = spawn(TSX, [ENTRY], {
      cwd: PACKAGE_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.stdout += chunk;
      let newline = this.stdout.indexOf('\n');
      while (newline !== -1) {
        const line = this.stdout.slice(0, newline);
        this.stdout = this.stdout.slice(newline + 1);
        if (line.trim().length > 0) {
          const message = JSON.parse(line) as JsonRpcResponse;
          this.pending.get(message.id)?.(message);
          this.pending.delete(message.id);
        }
        newline = this.stdout.indexOf('\n');
      }
    });
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const answered = new Promise<JsonRpcResponse>((resolve) => this.pending.set(id, resolve));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return answered;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  kill(): void {
    this.child.kill();
  }
}

let server: SpawnedServer;
let initialize: JsonRpcResponse;
let tools: PublishedTool[];

beforeAll(async () => {
  server = new SpawnedServer();
  initialize = await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'tool-surface-test', version: '0.0.0' },
  });
  server.notify('notifications/initialized');
  const listed = await server.request('tools/list');
  tools = (listed.result as { tools: PublishedTool[] }).tools;
}, 30_000);

afterAll(() => {
  server?.kill();
});

const toolNamed = (name: string): PublishedTool => {
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`tools/list did not publish ${name}`);
  return found;
};

describe('the handshake', () => {
  it('answers initialize and identifies itself as devdigest', () => {
    expect(initialize.error).toBeUndefined();
    expect(initialize.result?.serverInfo).toMatchObject({ name: 'devdigest' });
  });

  it('carries the one-paragraph instructions, under 600 characters', () => {
    const instructions = initialize.result?.instructions as string;
    expect(instructions).toBe(SERVER_INSTRUCTIONS);
    expect(instructions.length).toBeLessThanOrEqual(600);
    expect(instructions).not.toContain('\n');
  });

  it('starts without the DevDigest API running', () => {
    // Nothing on :3001 in the unit lane. The server still handshakes: an
    // unreachable API is a tool-level error, never a startup crash.
    expect(initialize.result).toBeDefined();
    expect(server.stderr).not.toContain('failed to start');
  });
});

describe('tools/list', () => {
  it('publishes exactly the five tools, and nothing else', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(5);
  });

  it.each(TOOL_NAMES)('gives %s the Appendix description verbatim', (name) => {
    expect(toolNamed(name).description).toBe(TOOL_DESCRIPTIONS[name]);
  });

  it.each(TOOL_NAMES)('keeps %s description under 1200 characters with a worked example', (name) => {
    const description = toolNamed(name).description ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1200);
    expect(description).toContain('Example:');
  });

  it.each(TOOL_NAMES)('declares an outputSchema for %s', (name) => {
    const outputSchema = toolNamed(name).outputSchema;
    expect(outputSchema, `${name} outputSchema`).toBeDefined();
    expect(outputSchema?.type).toBe('object');
    expect(Object.keys(outputSchema?.properties ?? {}).length).toBeGreaterThan(0);
  });

  it('marks the four read tools read-only', () => {
    for (const name of ['list_agents', 'get_findings', 'get_conventions', 'get_blast_radius']) {
      expect(toolNamed(name).annotations, name).toMatchObject({ readOnlyHint: true });
    }
  });

  it('marks run_agent_on_pr as the one tool that changes something and reaches outside', () => {
    expect(toolNamed('run_agent_on_pr').annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });

  it.each(TOOL_NAMES)('keeps the %s input schema flat — no nested object anywhere', (name) => {
    const input = toolNamed(name).inputSchema;
    expect(input?.type).toBe('object');
    expect(input?.$defs, 'a $defs block means a reused sub-schema, i.e. nesting').toBeUndefined();

    for (const [property, schema] of Object.entries(input?.properties ?? {})) {
      const where = `${name}.${property}`;
      expect(JSON.stringify(schema), where).not.toContain('$ref');
      if (Array.isArray(schema.enum)) {
        expect(schema.type, where).toBe('string');
        continue;
      }
      expect(['string', 'number', 'integer', 'boolean'], where).toContain(schema.type);
    }
  });

  it('publishes the shared fields identically wherever they appear', () => {
    // `schemas.ts` declares each of them once; this is the wire-level proof that
    // no copy drifted.
    const repos = TOOL_NAMES.map((name) => toolNamed(name).inputSchema?.properties?.repo).filter(
      Boolean,
    );
    expect(repos).toHaveLength(4);
    expect(new Set(repos.map((schema) => JSON.stringify(schema))).size).toBe(1);

    const formats = TOOL_NAMES.map(
      (name) => toolNamed(name).inputSchema?.properties?.response_format,
    ).filter(Boolean);
    expect(formats).toHaveLength(3);
    expect(new Set(formats.map((schema) => JSON.stringify(schema))).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// In-process calls, where `fetch` is a stub.
// ---------------------------------------------------------------------------

interface CallToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Drive a server built over an injected fetch, without touching the network. */
async function callTool(
  fetchImpl: FetchLike,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const mcp = createServer({
    api: new ApiClient({ baseUrl: DEFAULT_API_BASE_URL, fetch: fetchImpl }),
    config: { apiBaseUrl: DEFAULT_API_BASE_URL, runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = rpcClient(clientSide);
  await mcp.connect(serverSide);
  await clientSide.start();

  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'in-process-test', version: '0.0.0' },
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

function jsonResponse(status: number, body: unknown): HttpResponse {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  };
}

describe('list_agents', () => {
  const seeded = [
    {
      id: 'a1',
      name: 'General Reviewer',
      description: 'Everything else.',
      provider: 'anthropic',
      model: 'claude-opus-5',
      enabled: true,
      system_prompt: 'ignored by the projection',
      version: 3,
    },
  ];

  it('projects the agents and carries both structuredContent and a JSON text block', async () => {
    const calls: string[] = [];
    const result = await callTool(async (url) => {
      calls.push(url);
      return jsonResponse(200, seeded);
    }, 'list_agents');

    expect(calls).toEqual(['http://localhost:3001/agents']);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      agents: [
        {
          id: 'a1',
          name: 'General Reviewer',
          slug: 'general-reviewer',
          provider: 'anthropic',
          model: 'claude-opus-5',
          enabled: true,
          description: 'Everything else.',
        },
      ],
    });

    const text = result.content?.find((block) => block.type === 'text')?.text ?? '';
    expect(JSON.parse(text)).toEqual(result.structuredContent);
  });

  it('reports an unreachable API as a tool error naming ./scripts/dev.sh', async () => {
    const result = await callTool(async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), {
          code: 'ECONNREFUSED',
        }),
      });
    }, 'list_agents');

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('./scripts/dev.sh');
    expect(text).not.toContain('at Object.'); // no stack trace
    expect(result.structuredContent).toMatchObject({ code: 'api_unreachable' });
  });
});

describe('get_blast_radius — the honest stub', () => {
  it('fails loudly, makes no HTTP request, and emits no empty impact lists', async () => {
    let requests = 0;
    const result = await callTool(
      async () => {
        requests += 1;
        return jsonResponse(200, {});
      },
      'get_blast_radius',
      { repo: 'acme/payments-api', pr: 482 },
    );

    expect(requests, 'the stub must not call the API at all').toBe(0);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      status: 'not_implemented',
      implemented_in: 'L04 part two',
      message: expect.stringContaining('not implemented yet') as unknown as string,
    });
    // D13: an empty array here would read as "this pull request affects nothing".
    expect(Object.keys(result.structuredContent ?? {})).not.toContain('changed_symbols');
    expect(Object.keys(result.structuredContent ?? {})).not.toContain('downstream');
    expect(JSON.stringify(result)).not.toContain('changed_symbols');
  });
});
