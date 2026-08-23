/**
 * Pure helpers of the Smart Diff (L03): grouping, ordering and the split nudge.
 *
 * `classifyFile` is NOT tested here. Its table lives in
 * `src/modules/pulls/classifier.test.ts`, the path `pnpm verify:l03` runs — one
 * home, because two copies of a rule table is how the two drift apart.
 *
 * What is left is tested by the thing that can silently go wrong in it: the
 * ordering by its tie-breaks, the split thresholds at both of their edges, and
 * the assembled response parsed through the real contract.
 */
import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import {
  buildGroups,
  buildSplitSuggestion,
  groupFindingLines,
  type SmartDiffInputFile,
} from '../src/modules/smart-diff/helpers.js';
import {
  SPLIT_MIN_AREA_FILES,
  SPLIT_MIN_TOTAL_LINES,
} from '../src/modules/smart-diff/constants.js';

const file = (path: string, additions = 1, deletions = 0): SmartDiffInputFile => ({
  path,
  additions,
  deletions,
});

describe('buildGroups', () => {
  it('returns core, wiring, boilerplate in that order and omits the empty ones', () => {
    const groups = buildGroups([file('src/pay.ts'), file('package-lock.json')]);
    expect(groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
  });

  it('orders a group by findings, then by size, then by path', () => {
    const groups = buildGroups(
      [
        file('src/b.ts', 100, 0), // biggest, no findings
        file('src/a.ts', 1, 0), // smallest, one finding
        file('src/d.ts', 5, 5),
        file('src/c.ts', 5, 5), // same size as d.ts — path decides
      ],
      { 'src/a.ts': [12] },
    );
    expect(groups[0]!.files.map((f) => f.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.ts',
    ]);
  });

  it('attaches finding lines by path and leaves the rest empty', () => {
    const [core] = buildGroups([file('src/a.ts'), file('src/b.ts')], { 'src/a.ts': [12, 40] });
    expect(core!.files.find((f) => f.path === 'src/a.ts')!.finding_lines).toEqual([12, 40]);
    expect(core!.files.find((f) => f.path === 'src/b.ts')!.finding_lines).toEqual([]);
  });

  it('loses no file: every input path appears in exactly one group', () => {
    const paths = [
      'src/middleware/ratelimit.ts',
      'src/api/public/webhooks.ts',
      'src/api/public/index.ts',
      'src/server.ts',
      'src/config.ts',
      'src/api/users.ts',
      'test/ratelimit.test.ts',
      'package.json',
      'package-lock.json',
    ];
    const groups = buildGroups(paths.map((p) => file(p)));
    const seen = groups.flatMap((g) => g.files.map((f) => f.path));
    expect(seen.sort()).toEqual([...paths].sort());
  });

  it('never invents a pseudocode summary — this endpoint calls no model', () => {
    const [core] = buildGroups([file('src/a.ts')]);
    expect(core!.files[0]!.pseudocode_summary).toBeNull();
  });

  it('returns no groups at all for a PR whose files were never persisted', () => {
    expect(buildGroups([])).toEqual([]);
  });
});

describe('buildSplitSuggestion', () => {
  it('counts every changed line, boilerplate included', () => {
    const s = buildSplitSuggestion([file('src/a.ts', 10, 5), file('package-lock.json', 90, 20)]);
    expect(s.total_lines).toBe(125);
  });

  it('stays quiet below the size threshold, even with several areas', () => {
    const s = buildSplitSuggestion([
      file('src/api/a.ts', 10, 0),
      file('src/api/b.ts', 10, 0),
      file('src/jobs/a.ts', 10, 0),
      file('src/jobs/b.ts', 10, 0),
    ]);
    expect(s.too_big).toBe(false);
    expect(s.proposed_splits).toEqual([]);
  });

  it('stays quiet when one area carries the whole diff — that is a PR about one thing', () => {
    const s = buildSplitSuggestion([
      file('src/api/a.ts', SPLIT_MIN_TOTAL_LINES, 0),
      file('src/api/b.ts', SPLIT_MIN_TOTAL_LINES, 0),
    ]);
    expect(s.total_lines).toBeGreaterThanOrEqual(SPLIT_MIN_TOTAL_LINES);
    expect(s.too_big).toBe(false);
    expect(s.proposed_splits).toEqual([]);
  });

  it('proposes the areas, biggest first, once both conditions hold', () => {
    const s = buildSplitSuggestion([
      file('src/api/a.ts', 100, 0),
      file('src/api/b.ts', 100, 0),
      file('src/jobs/a.ts', 60, 0),
      file('src/jobs/b.ts', 60, 0),
      file('package-lock.json', 200, 0),
    ]);
    expect(s.too_big).toBe(true);
    expect(s.proposed_splits.map((p) => p.name)).toEqual(['src/api', 'src/jobs']);
    // The lock file is never proposed: it follows whichever PR moves its manifest.
    expect(s.proposed_splits.flatMap((p) => p.files)).not.toContain('package-lock.json');
  });

  it('ignores an area with fewer files than the minimum', () => {
    const lonely = Array.from({ length: SPLIT_MIN_AREA_FILES - 1 }, (_, i) =>
      file(`src/solo/f${i}.ts`, 300, 0),
    );
    const s = buildSplitSuggestion([
      ...lonely,
      file('src/api/a.ts', 100, 0),
      file('src/api/b.ts', 100, 0),
      file('src/jobs/a.ts', 100, 0),
      file('src/jobs/b.ts', 100, 0),
    ]);
    expect(s.proposed_splits.map((p) => p.name)).toEqual(['src/api', 'src/jobs']);
  });
});

describe('groupFindingLines', () => {
  it('dedupes and sorts the lines of one file', () => {
    expect(
      groupFindingLines([
        { file: 'src/a.ts', startLine: 52 },
        { file: 'src/a.ts', startLine: 12 },
        { file: 'src/a.ts', startLine: 52 },
        { file: 'src/b.ts', startLine: 3 },
      ]),
    ).toEqual({ 'src/a.ts': [12, 52], 'src/b.ts': [3] });
  });

  it('is empty when no review has run', () => {
    expect(groupFindingLines([])).toEqual({});
  });
});

describe('the assembled response', () => {
  it('is accepted by the SmartDiff contract', () => {
    const files = [
      file('src/middleware/ratelimit.ts', 84, 0),
      file('src/config.ts', 4, 0),
      file('package-lock.json', 92, 24),
    ];
    const body = {
      groups: buildGroups(files, { 'src/middleware/ratelimit.ts': [28, 52] }),
      split_suggestion: buildSplitSuggestion(files),
    };
    expect(() => SmartDiff.parse(body)).not.toThrow();
    expect(SmartDiff.parse(body).groups.map((g) => g.role)).toEqual([
      'core',
      'wiring',
      'boilerplate',
    ]);
  });
});
