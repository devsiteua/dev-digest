import type { Agent } from '@devdigest/shared';

/**
 * Pure ring — the agent projection and the name/slug/uuid resolver.
 *
 * Nothing here awaits, speaks HTTP or reads the environment: it takes the list a
 * caller already fetched and answers questions about it. That is what makes the
 * ambiguity rule testable without a server.
 */

/**
 * What `list_agents` publishes, and what every other tool resolves against.
 *
 * `Agent` also carries a `provider`, and it is deliberately NOT here. Nothing in
 * this package reads it — resolution matches on `name`, `slug` and `id`, and the
 * candidate lists print those three — so publishing it only spends context in
 * every session that calls the tool. `model` stays, because what a review will
 * cost and how capable it is are things a caller can act on.
 */
export interface AgentSummary {
  readonly id: string;
  readonly name: string;
  /** Derived here — see {@link slugify}. */
  readonly slug: string;
  readonly model: string;
  readonly enabled: boolean;
  readonly description: string;
}

/**
 * Kebab-case a name into the slug this package publishes.
 *
 * DevDigest has **no slug column** (`Agent` in `@devdigest/shared` carries `id`
 * and `name` and nothing between them), so the slug is minted here — which is
 * exactly why the tool that mints it is also the tool that returns it. A model
 * never has to guess the token: `list_agents` hands it over.
 *
 * The consequence, stated so it is not discovered the hard way: renaming an agent
 * in the DevDigest UI silently changes its slug. A saved prompt holding
 * `general-reviewer` stops resolving, and the recovery is another `list_agents` —
 * which is why {@link describeUnknownAgent} names that tool.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    // Strip combining marks so "Ávila Reviewer" slugs as "avila-reviewer" rather
    // than losing the letter entirely to the non-alphanumeric pass below.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Project one `Agent` contract row onto the six fields the tools publish. */
export function toAgentSummary(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    slug: slugify(agent.name),
    model: agent.model,
    enabled: agent.enabled,
    description: agent.description,
  };
}

export type AgentResolution =
  | { readonly ok: true; readonly agent: AgentSummary }
  | {
      readonly ok: false;
      readonly reason: 'not_found' | 'ambiguous';
      readonly message: string;
      /** The names the caller should choose between, or choose from. */
      readonly candidates: readonly string[];
    };

/**
 * Resolve what a caller wrote in `agent` onto exactly one configured agent.
 *
 * Three tiers, tried in order and case-insensitively: exact **name**, then
 * **slug**, then **uuid**. Tiers rather than one merged pass, because a name is
 * what a human typed and a slug is what this package invented — when both match,
 * what the server owns wins.
 *
 * An ambiguous match is an **error listing the candidates**, never a silent first
 * match. Two agents called "Security Reviewer" is a configuration a workspace can
 * genuinely have, and picking one of them quietly means a caller pays for a run
 * by an agent they did not choose and cannot tell apart in the answer.
 */
export function resolveAgent(query: string, agents: readonly AgentSummary[]): AgentResolution {
  const needle = query.trim().toLowerCase();

  for (const tier of ['name', 'slug', 'id'] as const) {
    const matches = agents.filter((agent) => agent[tier].toLowerCase() === needle);
    if (matches.length === 1) return { ok: true, agent: matches[0]! };
    if (matches.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous',
        message: describeAmbiguousAgent(query, tier, matches),
        candidates: matches.map((agent) => agent.name),
      };
    }
  }

  return {
    ok: false,
    reason: 'not_found',
    message: describeUnknownAgent(query, agents),
    candidates: agents.map((agent) => agent.name),
  };
}

/**
 * The text for "no such agent" — which names `list_agents` and lists what does
 * exist, because "404" tells a model nothing it can act on.
 */
export function describeUnknownAgent(query: string, agents: readonly AgentSummary[]): string {
  if (agents.length === 0) {
    return (
      `DevDigest has no reviewer agents configured, so ${JSON.stringify(query)} cannot be ` +
      `resolved. Add an agent in the DevDigest UI, then call list_agents to read back its name.`
    );
  }
  return (
    `DevDigest has no reviewer agent matching ${JSON.stringify(query)}. ` +
    `Call list_agents and use one of these names or slugs: ${agents.map(describeCandidate).join(', ')}.`
  );
}

/** The text for "more than one agent answers to that". */
export function describeAmbiguousAgent(
  query: string,
  tier: 'name' | 'slug' | 'id',
  matches: readonly AgentSummary[],
): string {
  return (
    `${JSON.stringify(query)} matches ${matches.length} reviewer agents by ${tier}: ` +
    `${matches.map(describeCandidate).join(', ')}. ` +
    `Call list_agents and pass the id of the one you mean, so the run is not attributed to ` +
    `an agent you did not choose.`
  );
}

function describeCandidate(agent: AgentSummary): string {
  return `${agent.name} (slug ${agent.slug}, id ${agent.id})`;
}
