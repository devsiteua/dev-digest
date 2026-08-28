import { describe, expect, it } from 'vitest';

import type { Agent } from '@devdigest/shared';

import {
  resolveAgent,
  slugify,
  toAgentSummary,
  type AgentSummary,
} from '../src/shape/agents.js';

/**
 * The pure ring: slug minting and the name/slug/uuid resolver.
 *
 * No process, no server, no `fetch` — `shape/` takes the list a caller already
 * has and answers questions about it, which is exactly why the ambiguity rule can
 * be pinned down here instead of in a protocol test.
 */

/** A seeded-looking agent row, with only the fields the projection reads. */
function agentRow(overrides: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent {
  return {
    description: 'Looks for problems.',
    provider: 'anthropic',
    model: 'claude-opus-5',
    enabled: true,
    ...overrides,
  } as Agent;
}

function summary(id: string, name: string, extra: Partial<AgentSummary> = {}): AgentSummary {
  return { ...toAgentSummary(agentRow({ id, name })), ...extra };
}

describe('slugify', () => {
  it('kebab-cases the seeded agent names', () => {
    expect(slugify('General Reviewer')).toBe('general-reviewer');
    expect(slugify('Security Reviewer')).toBe('security-reviewer');
    expect(slugify('API Contract Reviewer')).toBe('api-contract-reviewer');
  });

  it('collapses punctuation and runs of separators into single hyphens', () => {
    expect(slugify('SQL / Data  Reviewer')).toBe('sql-data-reviewer');
    expect(slugify('Perf & Cost')).toBe('perf-cost');
    expect(slugify('v2.1 Reviewer')).toBe('v2-1-reviewer');
  });

  it('never leaves a leading or trailing hyphen', () => {
    expect(slugify('  Security Reviewer  ')).toBe('security-reviewer');
    expect(slugify('!!Reviewer!!')).toBe('reviewer');
  });

  it('keeps an accented letter rather than dropping it', () => {
    // NFKD + combining-mark strip: without it "Ávila" would slug as "-vila",
    // which resolves to nothing and reads like a typo in the tool's output.
    expect(slugify('Ávila Reviewer')).toBe('avila-reviewer');
  });

  it('is stable under case', () => {
    expect(slugify('SECURITY REVIEWER')).toBe(slugify('security reviewer'));
  });
});

describe('toAgentSummary', () => {
  it('projects exactly the six fields list_agents publishes, and drops the provider', () => {
    const projected = toAgentSummary(
      agentRow({
        id: 'a1',
        name: 'Security Reviewer',
        description: 'Injection, authz and secrets.',
        provider: 'anthropic',
        model: 'claude-opus-5',
        enabled: false,
      }),
    );

    // `toEqual` is exact, so this is also the assertion that `provider` — set on
    // the row above — does not survive the projection. Stated twice on purpose:
    // the field is the kind that comes back by reflex when someone widens the
    // contract, and a diff that adds it should fail on a line that says so.
    expect(projected).toEqual({
      id: 'a1',
      name: 'Security Reviewer',
      slug: 'security-reviewer',
      model: 'claude-opus-5',
      enabled: false,
      description: 'Injection, authz and secrets.',
    });
    expect(projected).not.toHaveProperty('provider');
  });

  it('carries a disabled agent through — `enabled` is reported, not filtered on', () => {
    // D9: `enabled` is the membership test for a review-all in the UI. It does
    // not stop a caller running that agent by name here, so hiding it would hide
    // a runnable agent.
    expect(toAgentSummary(agentRow({ id: 'a2', name: 'Perf Reviewer', enabled: false })).enabled).toBe(
      false,
    );
  });
});

describe('resolveAgent', () => {
  const agents = [
    summary('11111111-1111-4111-8111-111111111111', 'General Reviewer'),
    summary('22222222-2222-4222-8222-222222222222', 'Security Reviewer'),
    summary('33333333-3333-4333-8333-333333333333', 'API Contract Reviewer'),
  ];

  it('resolves an exact name', () => {
    const result = resolveAgent('Security Reviewer', agents);
    expect(result.ok && result.agent.id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('resolves the slug it minted', () => {
    const result = resolveAgent('api-contract-reviewer', agents);
    expect(result.ok && result.agent.name).toBe('API Contract Reviewer');
  });

  it('resolves a uuid', () => {
    const result = resolveAgent('11111111-1111-4111-8111-111111111111', agents);
    expect(result.ok && result.agent.name).toBe('General Reviewer');
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    for (const query of ['  SECURITY REVIEWER ', 'Security-Reviewer', 'sEcUrItY-rEvIeWeR']) {
      const result = resolveAgent(query, agents);
      expect(result.ok, query).toBe(true);
      expect(result.ok && result.agent.name).toBe('Security Reviewer');
    }
  });

  it('prefers a name over a slug when both would match different agents', () => {
    // A name is what the server owns; a slug is what this package invented. When
    // the two collide, the server's own value wins rather than the derived one.
    const colliding = [
      summary('a1', 'security-reviewer'),
      summary('a2', 'Security Reviewer'),
    ];
    const result = resolveAgent('security-reviewer', colliding);
    expect(result.ok && result.agent.id).toBe('a1');
  });

  it('reports an ambiguous match with its candidates instead of picking one', () => {
    const duplicates = [
      summary('a1', 'Security Reviewer'),
      summary('a2', 'Security Reviewer'),
    ];
    const result = resolveAgent('Security Reviewer', duplicates);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('ambiguous');
    expect(result.candidates).toEqual(['Security Reviewer', 'Security Reviewer']);
    expect(result.message).toContain('a1');
    expect(result.message).toContain('a2');
    expect(result.message).toContain('list_agents');
  });

  it('reports an unknown agent by naming list_agents and listing what exists', () => {
    // The degraded-path criterion in the plan, in one assertion: `agent:
    // "securty"` must come back as a next step, not as "404".
    const result = resolveAgent('securty', agents);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not_found');
    expect(result.message).toContain('list_agents');
    expect(result.message).toContain('Security Reviewer');
    expect(result.message).toContain('security-reviewer');
    expect(result.candidates).toEqual([
      'General Reviewer',
      'Security Reviewer',
      'API Contract Reviewer',
    ]);
  });

  it('says so when the workspace has no agents at all', () => {
    const result = resolveAgent('security-reviewer', []);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('no reviewer agents configured');
    expect(result.message).toContain('list_agents');
  });
});
