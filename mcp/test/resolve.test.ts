import { describe, expect, it } from 'vitest';

import type { PrMeta, Repo } from '@devdigest/shared';

import { ApiClient, type HttpResponse } from '../src/api/client.js';
import { resolvePull, resolveRepo } from '../src/api/resolve.js';
import { DEFAULT_API_BASE_URL } from '../src/config.js';
import { isDevDigestApiError } from '../src/errors.js';

/**
 * The infrastructure ring's one job: `acme/payments-api#482` in, internal ids
 * out, with no GitHub round-trip anywhere in it.
 *
 * `fetch` is a scripted stub, so every branch below — including the two 404s
 * that carry the next step — runs with nothing listening on :3001.
 */

const BASE = DEFAULT_API_BASE_URL;

function repoRow(fullName: string, id = fullName): Repo {
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

function prRow(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pr-482',
    number: 482,
    title: 'Add idempotency keys',
    author: 'octocat',
    branch: 'feat/idempotency',
    base: 'main',
    head_sha: 'deadbeef',
    additions: 120,
    deletions: 14,
    files_count: 7,
    status: 'needs_review',
    opened_at: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-21T10:00:00.000Z',
    ...overrides,
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

function notFound(message: string): HttpResponse {
  return jsonResponse(404, { error: { code: 'not_found', message } });
}

/** An ApiClient over a scripted route table, recording every URL it was asked for. */
function clientOver(routes: (url: string) => HttpResponse) {
  const calls: string[] = [];
  const api = new ApiClient({
    baseUrl: BASE,
    fetch: async (url) => {
      calls.push(url.slice(BASE.length));
      return routes(url.slice(BASE.length));
    },
  });
  return { api, calls };
}

describe('resolveRepo', () => {
  const repos = [repoRow('acme/payments-api', 'r1'), repoRow('acme/web', 'r2')];

  it('matches full_name exactly', async () => {
    const { api, calls } = clientOver(() => jsonResponse(200, repos));
    expect((await resolveRepo(api, 'acme/payments-api')).id).toBe('r1');
    expect(calls).toEqual(['/repos']);
  });

  it('matches case-insensitively, because the server deliberately does not', async () => {
    const { api } = clientOver(() => jsonResponse(200, repos));
    for (const written of ['ACME/Payments-API', '  Acme/payments-api  ']) {
      expect((await resolveRepo(api, written)).full_name, written).toBe('acme/payments-api');
    }
  });

  it('prefers the exact spelling when two repos differ only in case', async () => {
    // What the server owns beats what this package inferred — the same tiering
    // `resolveAgent` uses for a name over a derived slug.
    const { api } = clientOver(() =>
      jsonResponse(200, [repoRow('Acme/Payments-API', 'upper'), repoRow('acme/payments-api', 'lower')]),
    );
    expect((await resolveRepo(api, 'acme/payments-api')).id).toBe('lower');
  });

  it('refuses to guess between two repos that differ only in case', async () => {
    const { api } = clientOver(() =>
      jsonResponse(200, [repoRow('Acme/Payments-API', 'upper'), repoRow('acme/payments-API', 'other')]),
    );
    await expect(resolveRepo(api, 'acme/payments-api')).rejects.toMatchObject({
      code: 'bad_request',
      message: expect.stringContaining('differ only in capitalisation') as unknown as string,
    });
  });

  it('reports an unknown repo by naming the next step and what does exist', async () => {
    const { api } = clientOver(() => jsonResponse(200, repos));
    const error = await resolveRepo(api, 'acme/nope').catch((e: unknown) => e);

    expect(isDevDigestApiError(error)).toBe(true);
    if (!isDevDigestApiError(error)) throw new Error('unreachable');
    expect(error.code).toBe('not_found');
    expect(error.message).toContain('Add the repo in DevDigest first');
    expect(error.message).toContain('acme/payments-api');
  });

  it('says so when nothing has been imported at all', async () => {
    const { api } = clientOver(() => jsonResponse(200, []));
    await expect(resolveRepo(api, 'acme/payments-api')).rejects.toMatchObject({
      message: expect.stringContaining('no repositories imported') as unknown as string,
    });
  });
});

describe('resolvePull', () => {
  it('resolves through GET /pulls/lookup in one request, url-encoding the slash', async () => {
    const { api, calls } = clientOver((path) =>
      path.startsWith('/pulls/lookup') ? jsonResponse(200, prRow()) : jsonResponse(200, []),
    );

    const resolved = await resolvePull(api, 'acme/payments-api', 482);

    expect(resolved.id).toBe('pr-482');
    expect(resolved.repo).toBe('acme/payments-api');
    expect(resolved.pr.title).toBe('Add idempotency keys');
    // One request: the lookup reads persisted rows and asks GitHub nothing, which
    // is the entire reason Step 3 added it.
    expect(calls).toEqual(['/pulls/lookup?repo=acme%2Fpayments-api&number=482']);
  });

  it('retries with DevDigest’s own casing when the lookup 404s on case alone', async () => {
    const { api, calls } = clientOver((path) => {
      if (path === '/repos') return jsonResponse(200, [repoRow('acme/payments-api', 'r1')]);
      if (path.includes('repo=acme%2Fpayments-api')) return jsonResponse(200, prRow());
      return notFound('Repo "ACME/Payments-API" is not in DevDigest — add the repo in DevDigest first.');
    });

    expect((await resolvePull(api, 'ACME/Payments-API', 482)).id).toBe('pr-482');
    expect(calls).toEqual([
      '/pulls/lookup?repo=ACME%2FPayments-API&number=482',
      '/repos',
      '/pulls/lookup?repo=acme%2Fpayments-api&number=482',
    ]);
  });

  it('re-throws the server’s own 404 when the casing was already right', async () => {
    // The route's message names the next step better than anything this package
    // could invent, so it is passed through rather than replaced.
    const { api, calls } = clientOver((path) => {
      if (path === '/repos') return jsonResponse(200, [repoRow('acme/payments-api', 'r1')]);
      return notFound("PR #999 of acme/payments-api has not been imported — open the repo's PR list.");
    });

    const error = await resolvePull(api, 'acme/payments-api', 999).catch((e: unknown) => e);

    expect(isDevDigestApiError(error)).toBe(true);
    if (!isDevDigestApiError(error)) throw new Error('unreachable');
    expect(error.code).toBe('not_found');
    expect(error.message).toContain('has not been imported');
    expect(calls).toHaveLength(2);
  });

  it('turns a 404 on an unknown repo into the repo-level next step', async () => {
    const { api } = clientOver((path) =>
      path === '/repos'
        ? jsonResponse(200, [repoRow('acme/payments-api', 'r1')])
        : notFound('Repo "acme/nope" is not in DevDigest — add the repo in DevDigest first.'),
    );

    await expect(resolvePull(api, 'acme/nope', 482)).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('Add the repo in DevDigest first') as unknown as string,
    });
  });

  it('does not retry a failure that is not a 404', async () => {
    const { api, calls } = clientOver(() => jsonResponse(500, { error: { code: 'x', message: 'boom' } }));
    await expect(resolvePull(api, 'acme/payments-api', 482)).rejects.toMatchObject({
      code: 'api_error',
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses a lookup answer with no internal id rather than passing undefined on', async () => {
    const { api } = clientOver(() => jsonResponse(200, prRow({ id: null })));
    await expect(resolvePull(api, 'acme/payments-api', 482)).rejects.toMatchObject({
      code: 'api_error',
      message: expect.stringContaining('no internal id') as unknown as string,
    });
  });
});
