/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

/**
 * The `skills` slot (L02). The engine already accepted it; the studio server
 * started filling it. These tests pin the two properties the rest of the feature
 * is built on: the section renders where the contract says it does, and an agent
 * with no skills gets EXACTLY the prompt it got before skills existed.
 */
describe('assemblePrompt — ## Skills / rules', () => {
  const BASE = { system: 'sys', diff: 'DIFF' } as const;

  /**
   * The prompt an agent WITHOUT skills must produce, written out in full.
   *
   * Pinned as a literal on purpose. Comparing `assemblePrompt` to itself would
   * be self-referential: a change that always emitted `## Skills / rules` with an
   * empty body would move both sides equally and the assertion would still pass,
   * which is exactly the regression this test exists to catch.
   */
  const PROMPT_WITHOUT_SKILLS =
    '## Diff to review\n<untrusted source="diff">\nDIFF\n</untrusted>';

  it('is byte-identical to the pre-skills prompt when the slot is unused', () => {
    // The three ways the server can end up "without skills": key absent, the
    // spread evaluating to undefined, and an agent whose links resolved to none.
    for (const parts of [
      { ...BASE },
      { ...BASE, skills: undefined },
      { ...BASE, skills: [] },
    ]) {
      const { messages, assembly } = assemblePrompt(parts);
      expect(messages[1]!.content).toBe(PROMPT_WITHOUT_SKILLS);
      // Belt and braces: the heading must not appear even empty.
      expect(messages[1]!.content).not.toContain('## Skills / rules');
      expect(assembly.skills ?? null).toBeNull();
      expect(assembly.user).toBe(PROMPT_WITHOUT_SKILLS);
    }
  });

  it('leaves the system message alone whether or not skills are present', () => {
    const bare = assemblePrompt({ ...BASE }).messages[0]!.content;
    const withSkills = assemblePrompt({ ...BASE, skills: ['S'] }).messages[0]!.content;
    expect(withSkills).toBe(bare);
    expect(bare.startsWith('sys')).toBe(true);
  });

  it('renders the bodies joined by a blank line, in the order given', () => {
    const user = userOf({ ...BASE, skills: ['FIRST-SKILL', 'SECOND-SKILL'] });
    expect(user).toContain('## Skills / rules\nFIRST-SKILL\n\nSECOND-SKILL');
    expect(user.indexOf('FIRST-SKILL')).toBeLessThan(user.indexOf('SECOND-SKILL'));
  });

  it('keeps the contracted section order: PR description → skills → diff', () => {
    const user = userOf({
      ...BASE,
      prDescription: 'PR-BODY',
      skills: ['SKILL'],
      memory: ['MEM'],
    });
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Skills / rules'));
    expect(user.indexOf('## Skills / rules')).toBeLessThan(user.indexOf('## Relevant memory'));
    expect(user.indexOf('## Skills / rules')).toBeLessThan(user.indexOf('## Diff to review'));
  });

  it('records the assembled block for the run trace', () => {
    const { assembly } = assemblePrompt({ ...BASE, skills: ['A', 'B'] });
    expect(assembly.skills).toBe('A\n\nB');
  });

  it('passes an already-wrapped body through untouched (the server wraps, not the engine)', () => {
    // Imported skills are delimiter-wrapped upstream, in the server's
    // renderSkillBlocks. The engine must not double-wrap or unwrap them.
    const wrapped = '<untrusted source="skill:third-party">\nBODY\n</untrusted>';
    expect(userOf({ ...BASE, skills: [wrapped] })).toContain(wrapped);
  });
});
