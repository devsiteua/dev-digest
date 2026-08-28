import type { PrMeta, Repo } from '@devdigest/shared';

import { DevDigestApiError, isDevDigestApiError } from '../errors.js';
import type { ApiClient } from './client.js';

/**
 * Infrastructure ring — turning what a caller wrote (`acme/payments-api`, `482`)
 * into the internal ids the API is addressed by.
 *
 * **This file is the single place a reversal of Step 3 would touch.** Step 3 of
 * `specs/L04-mcp-server.md` added `GET /pulls/lookup`, and the plan marks it
 * droppable: if it ever goes away, {@link resolvePull} falls back to
 * `GET /repos/:id/pulls` and matches `number` there, at the cost of a GitHub
 * round-trip per resolution. Every tool calls the two functions below and never
 * an endpoint directly, so that reversal stays a one-file change — keep it that
 * way.
 *
 * The **case-insensitive** match lives here on purpose. The server compares
 * `full_name` exactly, which is right for a route that must not guess; a model
 * writing "Acme/Payments-API" is a different problem, and it is this adapter's
 * to solve.
 */

/** A pull request resolved to the id every other endpoint is keyed by. */
export interface ResolvedPull {
  /** The internal DevDigest pull id — never the number a caller passed. */
  readonly id: string;
  /** The persisted row, exactly as `GET /pulls/lookup` returned it. */
  readonly pr: PrMeta;
  /** The repository's `full_name` in DevDigest's own casing. */
  readonly repo: string;
}

/**
 * Find the repository a caller named, matching `full_name` case-insensitively.
 *
 * Exact case wins when both a case-sensitive and a case-insensitive match exist,
 * for the reason `resolveAgent` in `shape/agents.ts` tiers its own lookup: what
 * the server owns beats what this package inferred.
 */
export async function resolveRepo(api: ApiClient, fullName: string): Promise<Repo> {
  const wanted = fullName.trim();
  const repos = await api.get<Repo[]>('/repos');

  const exact = repos.filter((repo) => repo.full_name === wanted);
  if (exact.length === 1) return exact[0]!;

  const insensitive = repos.filter((repo) => sameName(repo.full_name, wanted));
  if (insensitive.length === 1) return insensitive[0]!;
  if (insensitive.length > 1) {
    throw new DevDigestApiError({
      code: 'bad_request',
      message: describeAmbiguousRepo(wanted, insensitive),
    });
  }

  throw new DevDigestApiError({
    code: 'not_found',
    message: describeUnknownRepo(wanted, repos),
  });
}

/**
 * Resolve `owner/name` + PR number onto the persisted pull request, without
 * asking GitHub anything.
 *
 * One request in the happy path. The `GET /repos` round-trip only happens after
 * a 404, where it earns its place twice: it is the case-insensitive match the
 * lookup route deliberately does not do, and when the repository genuinely is
 * absent it produces the error that names *that* as the next step rather than
 * blaming the PR number. When the casing was already right, the server's own
 * 404 text is re-thrown untouched — it already says "open the repo's PR list so
 * PR #N is imported", which is the better message.
 */
export async function resolvePull(
  api: ApiClient,
  fullName: string,
  number: number,
): Promise<ResolvedPull> {
  const wanted = fullName.trim();
  try {
    return toResolvedPull(await lookup(api, wanted, number), wanted);
  } catch (error) {
    if (!isDevDigestApiError(error) || error.code !== 'not_found') throw error;

    const repo = await resolveRepo(api, wanted);
    if (repo.full_name === wanted) throw error;
    return toResolvedPull(await lookup(api, repo.full_name, number), repo.full_name);
  }
}

function lookup(api: ApiClient, fullName: string, number: number): Promise<PrMeta> {
  const query = `repo=${encodeURIComponent(fullName)}&number=${encodeURIComponent(String(number))}`;
  return api.get<PrMeta>(`/pulls/lookup?${query}`);
}

/**
 * Narrow `PrMeta.id`, which the contract declares nullish because the same shape
 * serves `GET /pulls/:id` where the id is already in the path. A lookup answer
 * without one is unusable, and saying so here keeps every caller free of the
 * null check.
 */
function toResolvedPull(pr: PrMeta, repo: string): ResolvedPull {
  if (typeof pr.id !== 'string' || pr.id.length === 0) {
    throw new DevDigestApiError({
      code: 'api_error',
      message:
        `DevDigest resolved ${repo}#${pr.number} but returned no internal id for it, so the ` +
        `review cannot be read. Restart the API with ./scripts/dev.sh and try again; if it ` +
        `persists, the pull request row is incomplete in the database.`,
    });
  }
  return { id: pr.id, pr, repo };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The text for "no such repository" — the next step first, then what does exist.
 *
 * It names the DevDigest UI rather than a tool, because there is deliberately no
 * `list_repos` tool to point at (plan § Out of scope: that listing is already
 * reachable through `gh` and the GitHub MCP server).
 */
export function describeUnknownRepo(fullName: string, repos: readonly Repo[]): string {
  if (repos.length === 0) {
    return (
      `DevDigest has no repositories imported, so ${JSON.stringify(fullName)} cannot be ` +
      `resolved. Add the repo in DevDigest first — paste its URL on the Repos screen — then ` +
      `call this tool again.`
    );
  }
  return (
    `DevDigest has no repository called ${JSON.stringify(fullName)}. Add the repo in DevDigest ` +
    `first, or use one of the ones already imported: ${repos.map((r) => r.full_name).join(', ')}.`
  );
}

/** The text for two repositories whose names differ only in case. */
export function describeAmbiguousRepo(fullName: string, matches: readonly Repo[]): string {
  return (
    `${JSON.stringify(fullName)} matches ${matches.length} repositories in DevDigest that differ ` +
    `only in capitalisation: ${matches.map((r) => r.full_name).join(', ')}. Pass one of those ` +
    `spellings exactly, so the answer is not attributed to a repository you did not mean.`
  );
}
