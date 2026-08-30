/**
 * The pure half of the eval pipeline: what a decided finding asserts, what a
 * frozen input looks like, and the two limits that are refusals rather than
 * silent truncations.
 *
 * `serializeDiff` gets the most attention because its determinism is load-bearing
 * twice over: the seed and the service both call it, and AC-11 asserts a seeded
 * case and a created case built from the same PR are the same bytes.
 */
import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { MAX_CASES_PER_RUN, MAX_INPUT_DIFF_CHARS } from './constants.js';
import {
  assertInputDiffWithinLimit,
  caseSetForRun,
  expectationFromFinding,
  serializeDiff,
} from './helpers.js';

const decided = (over: Record<string, unknown> = {}) => ({
  file: 'src/middleware/ratelimit.ts',
  startLine: 28,
  endLine: 31,
  acceptedAt: null as Date | null,
  dismissedAt: null as Date | null,
  ...over,
});

describe('expectationFromFinding (AC-02, AC-03)', () => {
  it('an accepted finding becomes must_find', () => {
    expect(expectationFromFinding(decided({ acceptedAt: new Date() }))).toEqual({
      kind: 'must_find',
      file: 'src/middleware/ratelimit.ts',
      start_line: 28,
      end_line: 31,
    });
  });

  it('a dismissed finding becomes must_not_flag', () => {
    expect(expectationFromFinding(decided({ dismissedAt: new Date() })).kind).toBe('must_not_flag');
  });

  it('an undecided finding is refused — there is no judgement to encode', () => {
    expect(() => expectationFromFinding(decided())).toThrow(AppError);
    try {
      expectationFromFinding(decided());
    } catch (e) {
      expect((e as AppError).code).toBe('eval_case_not_decided');
      expect((e as AppError).statusCode).toBe(409);
    }
  });

  it('an accept following a dismiss reads as must_find', () => {
    expect(
      expectationFromFinding(decided({ acceptedAt: new Date(), dismissedAt: new Date() })).kind,
    ).toBe('must_find');
  });
});

// ---------------------------------------------------------------- serializeDiff

const block = (path: string, body: string) =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, body].join('\n');

/**
 * Build a UnifiedDiff whose `raw` carries the given paths in the given ORDER.
 * The body is a function of the path, never of the position, so re-ordering the
 * argument changes only the sequence — which is the variable under test.
 */
const rawDiff = (paths: string[]): UnifiedDiff => ({
  raw: paths.map((p) => block(p, `@@ -1,1 +1,2 @@\n context\n+added in ${p}`)).join('\n'),
  files: paths.map((p) => ({ path: p, additions: 1, deletions: 0, hunks: [] })),
});

describe('serializeDiff (AC-05, AC-11)', () => {
  it('is byte-identical across two calls on the same input', () => {
    const d = rawDiff(['src/b.ts', 'src/a.ts', 'README.md']);
    expect(serializeDiff(d)).toBe(serializeDiff(d));
  });

  /**
   * The regression this exists to catch. `getPrFiles` has no `orderBy`, so the
   * same PR can be assembled in two different file orders — and if determinism
   * lived in the query rather than here, two runs of the same case would hash to
   * two different snapshots.
   */
  it('is byte-identical when the same files arrive in a different order', () => {
    const a = serializeDiff(rawDiff(['src/b.ts', 'src/a.ts', 'README.md']));
    const b = serializeDiff(rawDiff(['README.md', 'src/b.ts', 'src/a.ts']));
    expect(a).toBe(b);
  });

  it('emits files sorted by path', () => {
    const out = serializeDiff(rawDiff(['src/b.ts', 'src/a.ts', 'README.md']));
    const order = out
      .split('\n')
      .filter((l) => l.startsWith('diff --git '))
      .map((l) => l.split(' b/')[1]);
    expect(order).toEqual(['README.md', 'src/a.ts', 'src/b.ts']);
  });

  it('passes each file’s body through unchanged, so it parses back the same way', () => {
    const out = serializeDiff(rawDiff(['src/a.ts']));
    expect(out).toContain('@@ -1,1 +1,2 @@');
    expect(out).toContain('+added in src/a.ts');
  });

  it('drops nothing and invents nothing on an empty diff', () => {
    expect(serializeDiff({ raw: '', files: [] })).toBe('');
  });
});

// ---------------------------------------------------------------- the two limits

describe('assertInputDiffWithinLimit (AC-06)', () => {
  it('accepts a diff exactly at the limit', () => {
    expect(() => assertInputDiffWithinLimit('x'.repeat(MAX_INPUT_DIFF_CHARS))).not.toThrow();
  });

  it('refuses one character over, and names the limit rather than truncating', () => {
    try {
      assertInputDiffWithinLimit('x'.repeat(MAX_INPUT_DIFF_CHARS + 1));
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('eval_case_diff_too_large');
      expect((e as AppError).statusCode).toBe(413);
      expect((e as AppError).message).toContain(String(MAX_INPUT_DIFF_CHARS));
    }
  });
});

describe('caseSetForRun (AC-16, AC-28)', () => {
  const set = (n: number, ownerKind: 'agent' | 'skill' = 'agent') =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, ownerKind }));

  it('keeps agent-owned cases only', () => {
    const mixed = [...set(2, 'agent'), ...set(3, 'skill')];
    expect(caseSetForRun(mixed)).toHaveLength(2);
    expect(caseSetForRun(mixed).every((c) => c.ownerKind === 'agent')).toBe(true);
  });

  it('accepts a set exactly at the limit', () => {
    expect(caseSetForRun(set(MAX_CASES_PER_RUN))).toHaveLength(MAX_CASES_PER_RUN);
  });

  it('refuses one case over the limit rather than taking the first 50', () => {
    try {
      caseSetForRun(set(MAX_CASES_PER_RUN + 1));
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('eval_run_too_many_cases');
      expect((e as AppError).message).toContain(String(MAX_CASES_PER_RUN));
    }
  });

  it('counts only agent-owned cases towards the limit', () => {
    const mixed = [...set(MAX_CASES_PER_RUN, 'agent'), ...set(10, 'skill')];
    expect(() => caseSetForRun(mixed)).not.toThrow();
  });

  it('an empty set is an empty set, not a refusal', () => {
    expect(caseSetForRun([])).toEqual([]);
  });
});
