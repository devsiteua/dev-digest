/**
 * Pure helpers of the intent layer (L03).
 *
 * The two that carry real risk are `extractPlanPaths` — the only thing between a
 * PR body and `git.readFile`, which joins its argument straight onto the clone
 * path — and `settleTier`, which is what stops a model raising its own
 * confidence. Both are tested by rule, not by example.
 */
import { describe, it, expect } from 'vitest';
import {
  buildIntentPrompt,
  clampEvidence,
  extractLinkedIssue,
  extractPlanPaths,
  isSubstantiveBody,
  renderIntentForPrompt,
  scoreForTier,
  settleTier,
  substantiveBodyText,
  tierFromSources,
} from '../src/modules/intent/helpers.js';
import { MIN_SUBSTANTIVE_BODY_CHARS } from '../src/modules/intent/constants.js';

describe('extractPlanPaths', () => {
  it('finds a repo-relative doc path in prose and in backticks', () => {
    expect(extractPlanPaths('Implements the plan in specs/L03-intent-layer.md.')).toEqual([
      'specs/L03-intent-layer.md',
    ]);
    expect(extractPlanPaths('See `docs/architecture.md` for the flow.')).toEqual([
      'docs/architecture.md',
    ]);
  });

  // Each of these would be a filesystem read outside the clone if it survived.
  it.each([
    ['absolute', '/etc/passwd.md'],
    ['parent traversal', '../secrets.md'],
    ['traversal mid-path', 'a/../../b.md'],
    ['home-relative', '~/notes.md'],
    ['backslash', 'a\\..\\b.md'],
  ])('rejects a %s path', (_label, path) => {
    expect(extractPlanPaths(`Plan: ${path}`)).toEqual([]);
  });

  it('never turns a remote URL into a local file read', () => {
    // Left unstripped, this yields the token `plan.md` — a valid repo-relative
    // path pointing at an entirely different file than the link did.
    expect(extractPlanPaths('Plan: https://evil.example/plan.md')).toEqual([]);
    expect(extractPlanPaths('Plan: http://evil.example/a/b/spec.md')).toEqual([]);
  });

  it('ignores paths outside the prose allow-list', () => {
    expect(extractPlanPaths('Changed src/server.ts and config.yaml and a.exe')).toEqual([]);
  });

  it('de-duplicates and caps how many documents one derivation may read', () => {
    const body = 'a.md b.md c.md d.md a.md';
    const paths = extractPlanPaths(body);
    expect(paths.length).toBeLessThanOrEqual(2);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('returns the same answer when called twice on the same body', () => {
    // The module-level regex is global; a shared `lastIndex` would make the
    // second call start mid-string and find nothing.
    const body = 'Plan: specs/plan.md';
    expect(extractPlanPaths(body)).toEqual(extractPlanPaths(body));
    expect(extractPlanPaths(body)).toEqual(['specs/plan.md']);
  });

  it('treats an empty body as no paths', () => {
    expect(extractPlanPaths(undefined)).toEqual([]);
    expect(extractPlanPaths(null)).toEqual([]);
    expect(extractPlanPaths('')).toEqual([]);
  });
});

describe('extractLinkedIssue', () => {
  const REPO = 'acme/payments-api';

  it.each([
    ['Closes #471', 471],
    ['closes #471', 471],
    ['Fixed #12', 12],
    ['resolves #7', 7],
    ['Closes acme/payments-api#471', 471],
    ['Fixes https://github.com/acme/payments-api/issues/99', 99],
  ])('accepts %s', (body, expected) => {
    expect(extractLinkedIssue(body, REPO)).toBe(expected);
  });

  it('requires a closing keyword — a bare mention is not a link', () => {
    expect(extractLinkedIssue('See #5 for background.', REPO)).toBeUndefined();
    expect(extractLinkedIssue('Related to #5.', REPO)).toBeUndefined();
  });

  it('discards a cross-repo reference instead of fetching the wrong issue', () => {
    // getIssue() takes THIS repo's ref, so honouring this would fetch issue 12
    // of the wrong project under the right number.
    expect(extractLinkedIssue('Closes other/repo#12', REPO)).toBeUndefined();
    expect(
      extractLinkedIssue('Fixes https://github.com/other/repo/issues/12', REPO),
    ).toBeUndefined();
  });

  it('matches the repository case-insensitively', () => {
    expect(extractLinkedIssue('Closes ACME/Payments-API#471', REPO)).toBe(471);
  });

  it('returns the same answer when called twice', () => {
    const body = 'Closes #471';
    expect(extractLinkedIssue(body, REPO)).toBe(471);
    expect(extractLinkedIssue(body, REPO)).toBe(471);
  });
});

describe('substantiveBodyText / isSubstantiveBody', () => {
  it('drops HTML comments — a template instructs, it does not describe', () => {
    expect(substantiveBodyText('<!-- Describe your change -->Real prose.')).toBe('Real prose.');
  });

  it('drops unticked checklist rows and keeps ticked ones', () => {
    const body = '- [ ] I added tests\n- [x] I ran the linter\nReal prose.';
    const out = substantiveBodyText(body);
    expect(out).not.toContain('I added tests');
    expect(out).toContain('I ran the linter');
    expect(out).toContain('Real prose.');
  });

  it('scores an untouched template as not substantive', () => {
    const template =
      '<!-- Explain what and why. Link the issue. Delete this comment. -->\n' +
      '- [ ] Tests\n- [ ] Docs\n- [ ] Changelog\n';
    expect(isSubstantiveBody(template)).toBe(false);
  });

  it('uses the documented threshold', () => {
    expect(isSubstantiveBody('x'.repeat(MIN_SUBSTANTIVE_BODY_CHARS - 1))).toBe(false);
    expect(isSubstantiveBody('x'.repeat(MIN_SUBSTANTIVE_BODY_CHARS))).toBe(true);
  });
});

describe('tierFromSources', () => {
  it('rates documentation the author pointed at highest', () => {
    expect(tierFromSources(['plan_file', 'pr_title'])).toBe('high');
    expect(tierFromSources(['linked_issue'])).toBe('high');
  });

  it('rates the author’s own prose in the middle', () => {
    expect(tierFromSources(['pr_body', 'commits'])).toBe('medium');
  });

  it('rates signals derived from the change itself lowest', () => {
    expect(tierFromSources(['pr_title', 'commits', 'branch', 'file_paths'])).toBe('low');
    expect(tierFromSources([])).toBe('low');
  });
});

describe('settleTier', () => {
  it('lets the model lower the tier', () => {
    expect(settleTier('high', 'low')).toBe('low');
    expect(settleTier('medium', 'low')).toBe('low');
  });

  it('never lets the model raise it', () => {
    expect(settleTier('low', 'high')).toBe('low');
    expect(settleTier('medium', 'high')).toBe('medium');
  });

  it('ignores a suggestion it does not recognise, in either direction', () => {
    expect(settleTier('medium', 'very-high')).toBe('medium');
    expect(settleTier('medium', undefined)).toBe('medium');
    expect(settleTier('medium', null)).toBe('medium');
  });
});

describe('scoreForTier', () => {
  it('lands each tier inside ConfidenceNum’s own colour bands', () => {
    // ConfidenceNum paints >= 0.85 ok, >= 0.65 warn, else muted. These values are
    // what let the card render confidence with no conditional of its own.
    expect(scoreForTier('high')).toBeGreaterThanOrEqual(0.85);
    expect(scoreForTier('medium')).toBeGreaterThanOrEqual(0.65);
    expect(scoreForTier('medium')).toBeLessThan(0.85);
    expect(scoreForTier('low')).toBeLessThan(0.65);
  });
});

describe('clampEvidence', () => {
  it('caps the number of rows and the length of each', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      source: 'pr_body' as const,
      ref: `ref-${i}`,
      quote: 'q'.repeat(1000),
    }));
    const out = clampEvidence(many);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out.every((e) => e.quote.length <= 240)).toBe(true);
  });

  it('treats a missing list as no evidence', () => {
    expect(clampEvidence(undefined)).toEqual([]);
  });
});

describe('buildIntentPrompt', () => {
  const BASE = {
    title: 'Add rate limiting',
    branch: 'feat/rate-limit',
    planFiles: [],
    commitMessages: [],
    changedPaths: [],
  };

  it('wraps every author-controlled block', () => {
    const prompt = buildIntentPrompt({
      ...BASE,
      body: 'BODY',
      planFiles: [{ path: 'specs/p.md', text: 'PLAN' }],
      issue: { number: 471, title: 'ISSUE-TITLE', body: 'ISSUE-BODY' },
      commitMessages: ['COMMIT'],
      changedPaths: ['src/a.ts'],
    });
    for (const untrusted of ['PLAN', 'ISSUE-BODY', 'BODY', 'COMMIT', 'src/a.ts']) {
      const at = prompt.indexOf(untrusted);
      const openedBefore = prompt.lastIndexOf('<untrusted', at);
      const closedBefore = prompt.lastIndexOf('</untrusted>', at);
      expect(openedBefore).toBeGreaterThan(closedBefore);
    }
  });

  it('puts the strongest evidence first', () => {
    const prompt = buildIntentPrompt({
      ...BASE,
      body: 'BODY',
      planFiles: [{ path: 'specs/p.md', text: 'PLAN' }],
      issue: { number: 471, title: 'T', body: 'ISSUE-BODY' },
    });
    expect(prompt.indexOf('PLAN')).toBeLessThan(prompt.indexOf('ISSUE-BODY'));
    expect(prompt.indexOf('ISSUE-BODY')).toBeLessThan(prompt.indexOf('BODY'));
  });

  it('omits a section it has no input for', () => {
    const prompt = buildIntentPrompt({ ...BASE });
    expect(prompt).not.toContain('## PR description');
    expect(prompt).not.toContain('## Linked issue');
    expect(prompt).not.toContain('## Changed files');
  });
});

describe('renderIntentForPrompt', () => {
  const RECORD = {
    intent: 'Rate-limit the public API.',
    in_scope: ['middleware', '429 + Retry-After'],
    out_of_scope: ['auth changes'],
    kind: 'feature' as const,
    confidence_tier: 'low' as const,
    sources: ['pr_title', 'commits'] as const,
  };

  it('renders the distillation and nothing else', () => {
    // The sources are absent by construction: this function is not given the
    // body, the issue or the plan file, so it cannot leak them into a prompt
    // that already carries the description in its own section.
    const { intent } = renderIntentForPrompt({ ...RECORD, sources: [...RECORD.sources] });
    expect(intent).toContain('Kind: feature');
    expect(intent).toContain('Intent: Rate-limit the public API.');
    expect(intent).toContain('- middleware');
    expect(intent).toContain('- auth changes');
    expect(intent.length).toBeLessThan(400);
  });

  it('states the confidence and that the intent is only a claim', () => {
    const { note } = renderIntentForPrompt({ ...RECORD, sources: [...RECORD.sources] });
    expect(note).toContain('confidence low');
    expect(note).toMatch(/claims about itself/i);
    expect(note).toMatch(/never narrows what you review/i);
  });

  it('omits an empty scope list rather than printing an empty heading', () => {
    const { intent } = renderIntentForPrompt({
      ...RECORD,
      sources: [...RECORD.sources],
      in_scope: [],
      out_of_scope: [],
    });
    expect(intent).not.toContain('Claimed in scope');
    expect(intent).not.toContain('Claimed out of scope');
  });
});
