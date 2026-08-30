/**
 * Scoring — the three numbers, and the one property that makes them worth
 * printing: nothing in this file needs a model, a container or a database.
 *
 * The risk here is not a crash. It is a metric that looks reasonable and counts
 * the wrong population — a vacuous `1` read as a perfect score, a scope-gate drop
 * charged to citation accuracy, an off-by-one at a range boundary that quietly
 * halves recall. So each case names the population it is asserting about.
 */
import { describe, it, expect } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import { groundFindings } from '@devdigest/reviewer-core';
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import {
  citationAccuracy,
  matches,
  rangesOverlap,
  ratio,
  scoreBatch,
  scoreCase,
} from './scoring.js';

const expectation = (over: Partial<EvalExpectation> = {}): EvalExpectation => ({
  kind: 'must_find',
  file: 'src/middleware/ratelimit.ts',
  start_line: 10,
  end_line: 20,
  ...over,
});

const at = (file: string, start: number, end: number) => ({
  file,
  start_line: start,
  end_line: end,
});

describe('rangesOverlap (AC-18)', () => {
  it.each([
    ['identical ranges', 10, 20, 10, 20, true],
    ['edges touching at the top', 10, 20, 20, 30, true],
    ['edges touching at the bottom', 10, 20, 1, 10, true],
    ['nested inside', 10, 20, 13, 14, true],
    ['nested outside', 13, 14, 10, 20, true],
    ['partial overlap', 10, 20, 18, 25, true],
    ['adjacent but disjoint, above', 10, 20, 21, 30, false],
    ['adjacent but disjoint, below', 10, 20, 1, 9, false],
    ['far apart', 10, 20, 900, 950, false],
    ['a single line inside', 10, 20, 15, 15, true],
    ['a single line just outside', 10, 20, 21, 21, false],
  ])('%s', (_name, aStart, aEnd, bStart, bEnd, expected) => {
    expect(
      rangesOverlap({ start_line: aStart, end_line: aEnd }, { start_line: bStart, end_line: bEnd }),
    ).toBe(expected);
  });

  it('normalises a range handed over backwards rather than answering false', () => {
    expect(rangesOverlap({ start_line: 20, end_line: 10 }, { start_line: 15, end_line: 15 })).toBe(
      true,
    );
  });
});

describe('matches (AC-18)', () => {
  it('needs the same file, not merely an overlapping range', () => {
    expect(matches(at('src/other.ts', 10, 20), expectation())).toBe(false);
  });

  it('matches on file equality plus range overlap', () => {
    expect(matches(at('src/middleware/ratelimit.ts', 19, 40), expectation())).toBe(true);
  });

  it('does not compare severity, title or wording — only location', () => {
    const wordy = { ...at('src/middleware/ratelimit.ts', 15, 15), title: 'completely different' };
    expect(matches(wordy, expectation())).toBe(true);
  });
});

describe('scoreCase', () => {
  it('must_find passes when a finding lands on the range', () => {
    const s = scoreCase(expectation(), [at('src/middleware/ratelimit.ts', 12, 12)]);
    expect(s).toMatchObject({ pass: true, matchedCount: 1, expectedCount: 1, correctCount: 1 });
  });

  it('must_find fails, and still contributes 1 to recall’s denominator', () => {
    const s = scoreCase(expectation(), [at('src/middleware/ratelimit.ts', 90, 95)]);
    expect(s).toMatchObject({ pass: false, matchedCount: 0, expectedCount: 1, correctCount: 0 });
    expect(s.reportedCount).toBe(1);
  });

  it('must_not_flag passes on silence and asserts nothing about recall', () => {
    const s = scoreCase(expectation({ kind: 'must_not_flag' }), []);
    expect(s).toMatchObject({ pass: true, matchedCount: 0, expectedCount: 0, reportedCount: 0 });
  });

  it('must_not_flag fails when the forbidden range is flagged, and that finding is a false positive', () => {
    const s = scoreCase(expectation({ kind: 'must_not_flag' }), [
      at('src/middleware/ratelimit.ts', 15, 16),
    ]);
    expect(s).toMatchObject({ pass: false, expectedCount: 0, correctCount: 0, reportedCount: 1 });
  });
});

describe('empty denominators (AC-20)', () => {
  it('ratio returns 1 and keeps the denominator', () => {
    expect(ratio(0, 0)).toEqual({ value: 1, numerator: 0, denominator: 0 });
  });

  it('a batch with no cases at all reports three vacuous 1s over three zero denominators', () => {
    const b = scoreBatch([], []);
    expect(b.recall).toEqual({ value: 1, numerator: 0, denominator: 0 });
    expect(b.precision).toEqual({ value: 1, numerator: 0, denominator: 0 });
    expect(b.citationAccuracy).toEqual({ value: 1, numerator: 0, denominator: 0 });
  });

  it('a set of only must_not_flag cases leaves recall vacuous while precision is real', () => {
    const cases = [
      scoreCase(expectation({ kind: 'must_not_flag' }), []),
      scoreCase(expectation({ kind: 'must_not_flag', start_line: 40, end_line: 44 }), [
        at('src/middleware/ratelimit.ts', 41, 41),
      ]),
    ];
    const b = scoreBatch(cases, []);
    expect(b.recall).toEqual({ value: 1, numerator: 0, denominator: 0 });
    expect(b.precision).toEqual({ value: 0, numerator: 0, denominator: 1 });
  });
});

describe('scoreBatch', () => {
  it('sums recall over must_find expectations and precision over reported findings', () => {
    const cases = [
      // found it
      scoreCase(expectation(), [at('src/middleware/ratelimit.ts', 11, 11)]),
      // missed it, and reported something else instead
      scoreCase(expectation({ start_line: 60, end_line: 70 }), [
        at('src/middleware/ratelimit.ts', 200, 201),
      ]),
    ];
    const b = scoreBatch(cases, []);
    expect(b.recall).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
    expect(b.precision).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });
});

// ---------------------------------------------------------------- AC-19

/** A one-file, one-hunk diff covering lines 10-12 of `src/a.ts`. */
const diff: UnifiedDiff = {
  raw: '',
  files: [
    {
      path: 'src/a.ts',
      additions: 3,
      deletions: 0,
      hunks: [
        {
          file: 'src/a.ts',
          oldStart: 10,
          oldLines: 0,
          newStart: 10,
          newLines: 3,
          newLineNumbers: [10, 11, 12],
        },
      ],
    },
  ],
};

const finding = (file: string, line: number): Finding => ({
  id: `f-${file}-${line}`,
  severity: 'WARNING',
  category: 'bug',
  title: 't',
  file,
  start_line: line,
  end_line: line,
  rationale: 'r',
  confidence: 0.9,
});

describe('citationAccuracy (AC-19)', () => {
  it('is computed off a real groundFindings result', () => {
    const result = groundFindings(
      [finding('src/a.ts', 11), finding('src/a.ts', 99), finding('src/nowhere.ts', 1)],
      diff,
    );
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(2);

    expect(citationAccuracy({ findings: result.kept, dropped: result.dropped, scopeDropped: [] })).toEqual(
      { value: 1 / 3, numerator: 1, denominator: 3 },
    );
  });

  /**
   * The case that goes RED under the wrong reading. A review passes through two
   * gates; `review.findings` is what survived both. A scope-gate drop was
   * grounded — its file and lines were real — so it belongs on the numerator.
   * Folding it into the denominator instead gives 1/2 here, not 2/3.
   */
  it('puts scopeDropped on the numerator side, not the denominator', () => {
    const scored = citationAccuracy({
      findings: [finding('src/a.ts', 11)],
      scopeDropped: [{ finding: finding('src/a.ts', 12), reason: 'out of scope' }],
      dropped: [{ finding: finding('src/a.ts', 99), reason: 'no hunk' }],
    });
    expect(scored).toEqual({ value: 2 / 3, numerator: 2, denominator: 3 });
    expect(scored.value).not.toBe(0.5);
  });

  it('is vacuously 1 with a zero denominator when the model produced nothing', () => {
    expect(citationAccuracy({ findings: [], dropped: [], scopeDropped: [] })).toEqual({
      value: 1,
      numerator: 0,
      denominator: 0,
    });
  });
});

// ---------------------------------------------------------------- AC-17

describe('scoring calls no model (AC-17)', () => {
  /**
   * The zero-count grep in `verify:l06`'s step proves no provider is IMPORTED
   * here. This proves nothing is CALLED either: every input is handed over
   * carrying methods that throw on contact, and `scoreBatch` still returns.
   */
  it('returns even when handed an input whose every method explodes', () => {
    const explode = () => {
      throw new Error('scoring reached for a provider');
    };
    const poisoned = {
      findings: [],
      dropped: [],
      scopeDropped: [],
      complete: explode,
      completeStructured: explode,
      embed: explode,
    };

    const result = scoreBatch(
      [scoreCase(expectation(), [at('src/middleware/ratelimit.ts', 11, 11)])],
      [poisoned],
    );
    expect(result.recall.value).toBe(1);
    expect(result.citationAccuracy.denominator).toBe(0);
  });
});
