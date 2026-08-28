import type { CallToolResult } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import type { ConventionCandidate, Repo } from '@devdigest/shared';

import { ApiClient, type HttpRequestInit, type HttpResponse } from '../src/api/client.js';
import { DEFAULT_API_BASE_URL } from '../src/config.js';
import {
  DEFAULT_CONVENTIONS_LIMIT,
  MAX_CONVENTIONS_LIMIT,
  buildConventionsResult,
  clampConventionsLimit,
  countByStatus,
  describeConventionsResult,
  formatEvidence,
  projectConvention,
} from '../src/shape/conventions.js';
import { runGetConventions } from '../src/tools/get-conventions.js';

/**
 * `get_conventions` — the read that must never turn into a write, and the empty
 * answer that must never read as "this repository has no conventions".
 *
 * Two halves, mirroring the rings. The first drives `shape/conventions.ts` on
 * object literals, because every rule it holds is a property of the DATA. The
 * second drives the whole tool over a stubbed `fetch` that **records every
 * request it is handed**, method included — which is how "it never calls the
 * extractor" becomes an assertion about what was sent rather than about what
 * failed to throw.
 */

const BASE = DEFAULT_API_BASE_URL;

function repoRow(fullName: string, id = 'repo-1'): Repo {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    id,
    workspace_id: 'ws1',
    owner,
    name,
    full_name: fullName,
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  };
}

/** A stored candidate with only the fields under test spelled out. */
function candidate(
  overrides: Partial<ConventionCandidate> & Pick<ConventionCandidate, 'id'>,
): ConventionCandidate {
  return {
    repo_id: 'repo-1',
    rule: `Rule ${overrides.id}`,
    category: 'naming',
    evidence_path: 'src/api/users.ts',
    evidence_snippet: 'export async function listUsers(req: Request) {\n  // …\n}',
    evidence_start_line: 23,
    evidence_end_line: 31,
    confidence: 0.82,
    status: 'accepted',
    skill_id: null,
    created_at: '2026-08-28T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The three fixtures this step is specified against.
// ---------------------------------------------------------------------------

/** Mixed statuses: two accepted, two pending, one rejected. */
const MIXED: ConventionCandidate[] = [
  candidate({ id: 'a1', rule: 'Route handlers return the contract, never a DTO', status: 'accepted' }),
  candidate({ id: 'p1', rule: 'Prefix booleans with is/has', status: 'pending' }),
  candidate({ id: 'a2', rule: 'Every query is scoped by workspaceId', status: 'accepted', category: 'structure' }),
  candidate({ id: 'r1', rule: 'Use var for hoisting', status: 'rejected' }),
  candidate({ id: 'p2', rule: 'Tests colocate with the module', status: 'pending' }),
];

/** The extractor ran and nobody has reviewed a single candidate. */
const ALL_PENDING: ConventionCandidate[] = [
  candidate({ id: 'p1', status: 'pending' }),
  candidate({ id: 'p2', status: 'pending' }),
  candidate({ id: 'p3', status: 'pending' }),
];

/** The extractor has never run: nothing is stored at all. */
const EMPTY: ConventionCandidate[] = [];

const BUILD = { repo: 'acme/payments-api', responseFormat: 'concise' as const };

// ---------------------------------------------------------------------------
// Pure ring.
// ---------------------------------------------------------------------------

describe('countByStatus — the counts are over every candidate, not the returned list', () => {
  it('counts each status of the mixed fixture', () => {
    expect(countByStatus(MIXED)).toEqual({ accepted: 2, pending: 2, rejected: 1 });
  });

  it('counts an all-pending fixture as zero accepted', () => {
    expect(countByStatus(ALL_PENDING)).toEqual({ accepted: 0, pending: 3, rejected: 0 });
  });

  it('counts an empty fixture as zero of everything', () => {
    expect(countByStatus(EMPTY)).toEqual({ accepted: 0, pending: 0, rejected: 0 });
  });
});

describe('formatEvidence — the two integer columns, re-joined for a reader', () => {
  it('renders a multi-line range as path:start-end', () => {
    expect(formatEvidence(candidate({ id: 'a', evidence_start_line: 23, evidence_end_line: 31 }))).toBe(
      'src/api/users.ts:23-31',
    );
  });

  it('collapses a single-line range to path:line', () => {
    expect(formatEvidence(candidate({ id: 'a', evidence_start_line: 7, evidence_end_line: 7 }))).toBe(
      'src/api/users.ts:7',
    );
  });
});

describe('projectConvention — concise is the default, detailed carries the bulk', () => {
  const row = candidate({ id: 'a1' });

  it('concise emits exactly rule, category and evidence', () => {
    expect(Object.keys(projectConvention(row, 'concise')).sort()).toEqual([
      'category',
      'evidence',
      'rule',
    ]);
  });

  it('concise carries no evidence_snippet and no confidence', () => {
    const projected = projectConvention(row, 'concise');
    expect(projected).not.toHaveProperty('evidence_snippet');
    expect(projected).not.toHaveProperty('confidence');
  });

  it('detailed adds evidence_snippet and confidence', () => {
    expect(projectConvention(row, 'detailed')).toMatchObject({
      evidence_snippet: row.evidence_snippet,
      confidence: 0.82,
    });
  });

  it('detailed is a materially larger payload — which is the point of having it', () => {
    const concise = JSON.stringify(projectConvention(row, 'concise'));
    const detailed = JSON.stringify(projectConvention(row, 'detailed'));
    expect(detailed.length).toBeGreaterThan(concise.length);
  });
});

describe('clampConventionsLimit — 50 by default, 200 at most', () => {
  it('defaults to 50', () => {
    expect(clampConventionsLimit(undefined)).toBe(DEFAULT_CONVENTIONS_LIMIT);
    expect(DEFAULT_CONVENTIONS_LIMIT).toBe(50);
  });

  it('caps at 200', () => {
    expect(clampConventionsLimit(5_000)).toBe(MAX_CONVENTIONS_LIMIT);
    expect(MAX_CONVENTIONS_LIMIT).toBe(200);
  });

  it('floors at 1 and survives nonsense without throwing', () => {
    expect(clampConventionsLimit(0)).toBe(1);
    expect(clampConventionsLimit(-7)).toBe(1);
    expect(clampConventionsLimit(Number.NaN)).toBe(DEFAULT_CONVENTIONS_LIMIT);
  });
});

describe('buildConventionsResult — accepted rules out, every count reported', () => {
  it('returns only the accepted candidates', () => {
    const result = buildConventionsResult({ ...BUILD, candidates: MIXED });
    expect(result.conventions.map((c) => c.rule)).toEqual([
      'Route handlers return the contract, never a DTO',
      'Every query is scoped by workspaceId',
    ]);
    expect(result).toMatchObject({ accepted: 2, pending: 2, rejected: 1 });
  });

  it('never leaks a pending or rejected rule into the list', () => {
    const serialized = JSON.stringify(buildConventionsResult({ ...BUILD, candidates: MIXED }));
    expect(serialized).not.toContain('Prefix booleans');
    expect(serialized).not.toContain('Use var for hoisting');
  });

  it('preserves the order the API returned — newest pass first, most confident inside it', () => {
    // The repository orders by `desc(created_at), desc(confidence), asc(id)`; the
    // secondary keys exist because one extraction pass shares a transaction
    // timestamp. Re-sorting here would throw that grouping away.
    const ordered = [
      candidate({ id: 'z', rule: 'newest', created_at: '2026-08-28T12:00:00.000Z' }),
      candidate({ id: 'a', rule: 'oldest', created_at: '2026-08-01T09:00:00.000Z' }),
    ];
    expect(
      buildConventionsResult({ ...BUILD, candidates: ordered }).conventions.map((c) => c.rule),
    ).toEqual(['newest', 'oldest']);
  });

  it('echoes the response_format it was asked for', () => {
    const result = buildConventionsResult({
      ...BUILD,
      responseFormat: 'detailed',
      candidates: MIXED,
    });
    expect(result.response_format).toBe('detailed');
    expect(result.conventions[0]).toHaveProperty('evidence_snippet');
  });

  it('reports the repository name it was given, so the answer names what it answered about', () => {
    expect(buildConventionsResult({ ...BUILD, candidates: EMPTY }).repo).toBe('acme/payments-api');
  });
});

describe('buildConventionsResult — truncation is never silent', () => {
  const many = Array.from({ length: 120 }, (_, i) => candidate({ id: `a${i}` }));

  it('reports the full accepted count above the returned length when limit cuts', () => {
    const result = buildConventionsResult({ ...BUILD, candidates: many, limit: 10 });
    expect(result.conventions).toHaveLength(10);
    expect(result.accepted).toBe(120);
    expect(result.accepted).toBeGreaterThan(result.conventions.length);
  });

  it('says in words that it truncated, and how many there were', () => {
    const result = buildConventionsResult({ ...BUILD, candidates: many, limit: 10 });
    const text = describeConventionsResult(result);
    expect(text).toContain('10 of 120 accepted conventions');
    expect(text).toContain('raise limit');
  });

  it('applies the default limit of 50 when none is given', () => {
    const result = buildConventionsResult({ ...BUILD, candidates: many });
    expect(result.conventions).toHaveLength(50);
    expect(result.accepted).toBe(120);
  });

  it('does not truncate — and does not claim to — when everything fits', () => {
    const result = buildConventionsResult({ ...BUILD, candidates: MIXED });
    expect(result.accepted).toBe(result.conventions.length);
    expect(describeConventionsResult(result)).not.toContain('raise limit');
  });
});

describe('describeConventionsResult — an empty list is not an empty answer', () => {
  it('says the extractor has never run when nothing is stored at all', () => {
    const text = describeConventionsResult(buildConventionsResult({ ...BUILD, candidates: EMPTY }));
    expect(text).toContain('has never run');
    // The distinction the tool's own description promises, in the response
    // itself rather than only in the tool list.
    expect(text).toContain('no conventions');
    expect(text).toContain('NOT the same');
  });

  it('says the extractor HAS run when candidates exist but none is accepted', () => {
    const text = describeConventionsResult(
      buildConventionsResult({ ...BUILD, candidates: ALL_PENDING }),
    );
    expect(text).toContain('has run');
    expect(text).not.toContain('has never run');
    expect(text).toContain('3 pending');
    expect(text).toContain('0 rejected');
    // The next step differs from the never-ran case: review what is there, do
    // not scan again.
    expect(text).toContain('Accept or reject');
  });

  it('gives the two empty cases genuinely different text', () => {
    const never = describeConventionsResult(buildConventionsResult({ ...BUILD, candidates: EMPTY }));
    const unreviewed = describeConventionsResult(
      buildConventionsResult({ ...BUILD, candidates: ALL_PENDING }),
    );
    expect(never).not.toBe(unreviewed);
  });

  it('leads with the counts when there are accepted rules', () => {
    const text = describeConventionsResult(buildConventionsResult({ ...BUILD, candidates: MIXED }));
    expect(text).toContain('2 accepted conventions');
    expect(text).toContain('2 pending');
    expect(text).toContain('1 rejected');
  });
});

// ---------------------------------------------------------------------------
// The tool, over a stubbed fetch that records every request.
// ---------------------------------------------------------------------------

/** The structured payload as a plain bag of keys. */
function payloadOf(result: CallToolResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

/** The accepted rules of a tool result, as plain objects. */
function conventionsOf(result: CallToolResult): Record<string, unknown>[] {
  return (payloadOf(result).conventions ?? []) as Record<string, unknown>[];
}

/** The nth content block's text; a non-text block reads as empty rather than throwing. */
function textOf(result: CallToolResult, index = 0): string {
  const block = result.content?.[index];
  return block && 'text' in block ? String(block.text) : '';
}

interface RecordedRequest {
  readonly method: string;
  readonly path: string;
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

/**
 * An `ApiClient` over a scripted route table that records the METHOD as well as
 * the path.
 *
 * Recording the method is what makes the "never runs the extractor" assertion
 * real: `POST /repos/:id/conventions/extract` and `GET /repos/:id/conventions`
 * differ only by verb, so a recorder that kept paths alone could not tell a read
 * from a paid write.
 */
function clientOver(routes: (path: string) => HttpResponse) {
  const requests: RecordedRequest[] = [];
  const api = new ApiClient({
    baseUrl: BASE,
    fetch: async (url: string, init?: HttpRequestInit) => {
      const path = url.slice(BASE.length);
      requests.push({ method: init?.method ?? 'GET', path });
      return routes(path);
    },
  });
  return { api, requests };
}

/** The route table every tool test below shares: one repo, one candidate list. */
function conventionsApi(candidates: readonly ConventionCandidate[]) {
  return clientOver((path) => {
    if (path === '/repos') return jsonResponse(200, [repoRow('acme/payments-api')]);
    if (path === '/repos/repo-1/conventions') return jsonResponse(200, candidates);
    return jsonResponse(404, { error: { code: 'not_found', message: `no route ${path}` } });
  });
}

describe('get_conventions — the tool', () => {
  it('reads the accepted rules of the mixed fixture with two GETs and nothing else', async () => {
    const { api, requests } = conventionsApi(MIXED);
    const result = await runGetConventions(api, { repo: 'acme/payments-api' });

    expect(requests).toEqual([
      { method: 'GET', path: '/repos' },
      { method: 'GET', path: '/repos/repo-1/conventions' },
    ]);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      repo: 'acme/payments-api',
      accepted: 2,
      pending: 2,
      rejected: 1,
      response_format: 'concise',
    });
    expect(conventionsOf(result)).toHaveLength(2);
  });

  it('carries both a sentence and the JSON payload as text blocks', async () => {
    const { api } = conventionsApi(MIXED);
    const result = await runGetConventions(api, { repo: 'acme/payments-api' });

    expect(textOf(result)).toContain('2 accepted conventions');
    expect(JSON.parse(textOf(result, 1))).toEqual(result.structuredContent);
  });

  it('emits evidence as path:line and, in detailed form, the snippet and confidence', async () => {
    const { api } = conventionsApi(MIXED);
    const concise = await runGetConventions(api, { repo: 'acme/payments-api' });
    const detailed = await runGetConventions(api, {
      repo: 'acme/payments-api',
      response_format: 'detailed',
    });

    const first = conventionsOf(concise)[0];
    expect(first).toEqual({
      rule: 'Route handlers return the contract, never a DTO',
      category: 'naming',
      evidence: 'src/api/users.ts:23-31',
    });

    const firstDetailed = conventionsOf(detailed)[0];
    expect(firstDetailed).toHaveProperty('evidence_snippet');
    expect(firstDetailed).toHaveProperty('confidence', 0.82);
    expect(JSON.stringify(detailed).length).toBeGreaterThan(JSON.stringify(concise).length);
  });

  it('answers the all-pending fixture without an error, and says the extractor ran', async () => {
    const { api } = conventionsApi(ALL_PENDING);
    const result = await runGetConventions(api, { repo: 'acme/payments-api' });

    // Nothing failed, so this is not an error — an error would send the caller
    // looking for a broken stack.
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ accepted: 0, pending: 3, rejected: 0 });
    expect(conventionsOf(result)).toEqual([]);
    expect(textOf(result)).toContain('has run');
    expect(textOf(result)).toContain('none of its candidates has been accepted');
  });

  it('answers the empty fixture with accepted: 0 and "the extractor has never run"', async () => {
    const { api } = conventionsApi(EMPTY);
    const result = await runGetConventions(api, { repo: 'acme/payments-api' });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ accepted: 0, pending: 0, rejected: 0 });
    const text = textOf(result);
    expect(text).toContain('has never run');
    expect(text).toContain('NOT the same');
  });

  it('truncates at `limit` and still reports the full accepted count', async () => {
    const many = Array.from({ length: 90 }, (_, i) => candidate({ id: `a${i}` }));
    const { api } = conventionsApi(many);
    const result = await runGetConventions(api, { repo: 'acme/payments-api', limit: 3 });

    expect(conventionsOf(result)).toHaveLength(3);
    expect(payloadOf(result).accepted).toBe(90);
    expect(textOf(result)).toContain('3 of 90 accepted conventions');
  });

  it('resolves the repository case-insensitively and answers in DevDigest’s own casing', async () => {
    const { api } = conventionsApi(MIXED);
    const result = await runGetConventions(api, { repo: 'ACME/Payments-API' });
    expect(result.structuredContent).toMatchObject({ repo: 'acme/payments-api' });
  });

  it('reports an unknown repository as a tool error naming the next step', async () => {
    const { api } = clientOver((path) =>
      path === '/repos' ? jsonResponse(200, [repoRow('acme/other')]) : jsonResponse(500, {}),
    );
    const result = await runGetConventions(api, { repo: 'acme/nope' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Add the repo in DevDigest');
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
  });

  it('reports an unreachable API as a tool error naming ./scripts/dev.sh', async () => {
    const api = new ApiClient({
      baseUrl: BASE,
      fetch: async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), {
            code: 'ECONNREFUSED',
          }),
        });
      },
    });
    const result = await runGetConventions(api, { repo: 'acme/payments-api' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('./scripts/dev.sh');
    expect(result.structuredContent).toMatchObject({ code: 'api_unreachable' });
  });
});

describe('get_conventions — it NEVER runs the extractor', () => {
  /**
   * The hard constraint of this step, asserted against what was SENT.
   *
   * `POST /repos/:id/conventions/extract` spends a real model call and is rate
   * limited to 10/min. The empty fixture is the case where a "helpful" tool
   * would be tempted to scan — nothing stored, nothing to answer with — so it is
   * the case this must be proved on, alongside the other two.
   */
  it.each([
    ['mixed statuses', MIXED],
    ['all pending', ALL_PENDING],
    ['nothing stored', EMPTY],
  ])('sends no POST and touches no extract route — %s', async (_label, candidates) => {
    const { api, requests } = conventionsApi(candidates);
    await runGetConventions(api, { repo: 'acme/payments-api' });

    expect(requests.length).toBeGreaterThan(0); // the recorder is actually wired up
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
    expect(requests.filter((request) => request.method === 'POST')).toEqual([]);
    expect(requests.some((request) => request.path.includes('/extract'))).toBe(false);
  });

  it('does not fall back to a scan when the repository lookup fails either', async () => {
    const { api, requests } = clientOver((path) =>
      path === '/repos' ? jsonResponse(200, []) : jsonResponse(500, {}),
    );
    await runGetConventions(api, { repo: 'acme/payments-api' });

    expect(requests).toEqual([{ method: 'GET', path: '/repos' }]);
  });
});
