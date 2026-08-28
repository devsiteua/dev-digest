import { describe, expect, it } from 'vitest';
import type { WorkingReviewResponse } from '@devdigest/shared';

import {
  CliUsageError,
  helpText,
  IMPLEMENTED_MODES,
  notImplementedMessage,
  parseArgs,
  REVIEW_MODES,
} from '../src/cli/args.js';
import {
  EXIT_BLOCKING,
  EXIT_OK,
  exitCodeFor,
  renderFindings,
  renderReport,
} from '../src/cli/render.js';

/**
 * `devdigest review` — the two things it PROMISES, tested where they are decided.
 *
 * The exit code is a documented contract a CI step branches on, and the flag
 * surface is what a saved script depends on. Neither is worth testing through a
 * spawned process: both live in pure modules for exactly that reason, and the
 * subprocess and the HTTP call around them are covered by `reviews.it.test.ts`
 * on the server, where the review actually happens.
 */

const RESULT: WorkingReviewResponse = {
  agent_name: 'Security Reviewer',
  provider: 'openai',
  model: 'gpt-4.1',
  verdict: 'request_changes',
  score: 42,
  summary: 'A live Stripe key is committed in source.',
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move it to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f2',
      severity: 'WARNING',
      category: 'bug',
      title: 'Unbounded retry loop',
      file: 'src/api/client.ts',
      start_line: 40,
      end_line: 52,
      rationale: 'The loop has no ceiling.',
      suggestion: null,
      confidence: 0.7,
      kind: 'finding',
    },
  ],
  blocking: 1,
  grounding: '2/3 passed',
  files_reviewed: 2,
  tokens_in: 4200,
  tokens_out: 380,
  cost_usd: 0.0123,
  duration_ms: 5100,
};

describe('the flag surface', () => {
  it('defaults to reviewing the working tree with whatever agent DevDigest has', () => {
    expect(parseArgs(['review'])).toEqual({
      command: 'review',
      mode: 'working',
      agent: null,
      help: false,
      json: false,
    });
  });

  it.each([
    [['review', '--mode', 'working']],
    [['review', '--mode=working']],
  ])('accepts %j', (argv) => {
    expect(parseArgs(argv).mode).toBe('working');
  });

  it('reads --agent in both spellings', () => {
    expect(parseArgs(['review', '--agent', 'security-reviewer']).agent).toBe('security-reviewer');
    expect(parseArgs(['review', '--agent=security-reviewer']).agent).toBe('security-reviewer');
  });

  it('parses the modes it does not implement, rather than rejecting them', () => {
    // Declared, not implemented. A flag rejected as UNKNOWN would teach a user
    // that the mode does not exist, which is a different and wrong lesson.
    for (const mode of REVIEW_MODES) {
      expect(parseArgs(['review', '--mode', mode]).mode).toBe(mode);
    }
    expect(IMPLEMENTED_MODES).toEqual(['working']);
    expect(notImplementedMessage('staged')).toContain('not implemented yet');
    expect(notImplementedMessage('branch')).toContain('--mode working');
  });

  it('rejects a mode that is not one of the three', () => {
    expect(() => parseArgs(['review', '--mode', 'wip'])).toThrow(CliUsageError);
    expect(() => parseArgs(['review', '--mode', 'wip'])).toThrow(/working, staged, branch/);
  });

  it('rejects a flag with no value, an unknown flag and an unknown command', () => {
    expect(() => parseArgs(['review', '--agent'])).toThrow(/needs a value/);
    expect(() => parseArgs(['review', '--agent', '--json'])).toThrow(/needs a value/);
    expect(() => parseArgs(['review', '--wat'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['audit'])).toThrow(/Unknown command/);
    expect(() => parseArgs([])).toThrow(/Missing command/);
  });

  it('accepts --help with no command at all', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('--help states what is NOT reviewed', () => {
  it('says untracked files are excluded, and how to include one', () => {
    // The one way this command can quietly review less than a user believes.
    const text = helpText();
    expect(text).toContain('UNTRACKED FILES ARE EXCLUDED');
    expect(text).toContain('git add -N');
    expect(text).toContain('git diff HEAD');
  });

  it('documents all three exit codes', () => {
    const text = helpText();
    expect(text).toContain('0  the review ran and found nothing blocking');
    expect(text).toContain('1  the review ran and found at least one blocking finding');
    expect(text).toContain('2  the review could not run at all');
  });
});

describe('the exit code is the server\'s judgement, not a second opinion', () => {
  it('is 1 when the server counted a blocking finding', () => {
    expect(exitCodeFor(RESULT)).toBe(EXIT_BLOCKING);
  });

  it('is 0 when it counted none, however many findings there are', () => {
    // Two findings, none blocking under this agent's `ci_fail_on`. A CLI that
    // re-derived "blocking" from severity would disagree with the studio the
    // first time somebody changed that threshold.
    expect(exitCodeFor({ ...RESULT, blocking: 0 })).toBe(EXIT_OK);
  });

  it('is 0 for an empty review', () => {
    expect(exitCodeFor({ blocking: 0 })).toBe(EXIT_OK);
  });
});

describe('the printed report', () => {
  it('prints severity, path:line and title, one finding per line', () => {
    expect(renderFindings(RESULT)).toEqual([
      'CRITICAL   src/config.ts:11  Hardcoded Stripe secret key',
      'WARNING    src/api/client.ts:40-52  Unbounded retry loop',
    ]);
  });

  it('names who reviewed, what it cost, and that nothing was saved', () => {
    const report = renderReport(RESULT);
    expect(report).toContain('Security Reviewer (openai/gpt-4.1) — 2 files reviewed');
    expect(report).toContain('2 findings, 1 blocking');
    expect(report).toContain('grounding 2/3 passed');
    expect(report).toContain('$0.0123');
    expect(report).toContain('Not saved');
  });

  it('says "No findings." rather than printing an empty list', () => {
    const report = renderReport({ ...RESULT, findings: [], blocking: 0 });
    expect(report).toContain('No findings.');
  });

  it('says unpriced rather than $0.0000 when the model has no known price', () => {
    // null means "no price for this model", which is a different fact from free.
    expect(renderReport({ ...RESULT, cost_usd: null })).toContain('unpriced');
  });
});
