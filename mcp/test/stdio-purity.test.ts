import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * stdout is the JSON-RPC channel **of `src/index.ts`** (D12).
 *
 * One `console.log` on a path this entry point reaches writes a non-JSON line
 * into the middle of the protocol stream and the client drops the connection — a
 * server that "does not appear", with the cause visible only on stderr. A grep
 * catches the obvious form; this test catches the rest, including a dependency
 * that decides to print something and a stack trace escaping onto the wrong
 * stream.
 *
 * The scope is a PROCESS, not the package, and `MCP_ENTRY` below is where that
 * is decided. `src/` will grow a second entry point — a CLI whose whole job is
 * to print to stdout — and the rule that protects the transport must not be read
 * as forbidding that. Anything the CLI reaches that this entry point ALSO
 * reaches is still covered here, which is the part that matters: the rule
 * follows the reachable set, not the directory.
 *
 * So: spawn the MCP entry point, drive it through a handshake, a good call, a
 * failing call and an unknown method, and assert that **every** line it wrote to
 * stdout parses as a JSON-RPC message — while the diagnostics we do emit are all
 * on stderr.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The MCP server's entry point — the one process this rule protects. */
const MCP_ENTRY = `${PACKAGE_ROOT}src/index.ts`;

/** A port nothing is listening on, so the failing call fails fast and locally. */
const DEAD_API = 'http://127.0.0.1:1';

interface Captured {
  stdout: string;
  stderr: string;
}

async function driveServer(): Promise<Captured> {
  const child = spawn(`${PACKAGE_ROOT}node_modules/.bin/tsx`, [MCP_ENTRY], {
    cwd: PACKAGE_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEVDIGEST_API_URL: DEAD_API },
  });

  const captured: Captured = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    captured.stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    captured.stderr += chunk;
  });

  const send = (message: Record<string, unknown>) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

  send({
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-purity-test', version: '0.0.0' },
    },
  });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  // A call that reaches the API layer and fails there: the error path logs, and
  // the log must not land on stdout.
  send({ id: 3, method: 'tools/call', params: { name: 'list_agents', arguments: {} } });
  // A second call through the API layer against the same dead port, so more
  // than one error path is exercised on one process.
  send({
    id: 4,
    method: 'tools/call',
    params: { name: 'get_blast_radius', arguments: { repo: 'acme/payments-api', pr: 482 } },
  });
  // A protocol-level failure, so the JSON-RPC error branch is exercised too.
  send({ id: 5, method: 'no/such/method' });

  // Wait until every request has been answered, then shut the process down.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const answered = captured.stdout.split('\n').filter((line) => line.trim().length > 0).length;
    if (answered >= 5) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.stdin.end();
  child.kill();
  return captured;
}

describe('stdout is the JSON-RPC channel and carries nothing else', () => {
  it('writes only parseable JSON-RPC messages to stdout', async () => {
    const { stdout } = await driveServer();
    const lines = stdout.split('\n').filter((line) => line.trim().length > 0);

    expect(lines.length, 'the server answered every request').toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      let message: { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        throw new Error(`stdout carried a line that is not JSON: ${JSON.stringify(line)}`);
      }
      expect(message.jsonrpc, `on line ${JSON.stringify(line.slice(0, 80))}`).toBe('2.0');
      expect(
        'result' in message || 'error' in message || 'method' in message,
        `on line ${JSON.stringify(line.slice(0, 80))}`,
      ).toBe(true);
    }
  }, 30_000);

  it('puts its own diagnostics on stderr, prefixed, and never on stdout', async () => {
    const { stdout, stderr } = await driveServer();

    expect(stderr).toContain('[devdigest-mcp]');
    expect(stderr).toContain('connected over stdio');
    // The failing list_agents call logs; the log belongs on stderr.
    expect(stderr).toContain('list_agents failed');
    expect(stdout).not.toContain('[devdigest-mcp]');
  }, 30_000);

  it('stays alive and answers after a tool has failed', async () => {
    // The degraded-path rule: an unreachable API is a tool error, not a crash.
    // Request 5 is sent after the failing request 3, so an answer to it proves
    // the process survived.
    const { stdout } = await driveServer();
    const ids = stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => (JSON.parse(line) as { id?: number }).id);

    expect(ids).toContain(3);
    expect(ids).toContain(5);
  }, 30_000);
});
