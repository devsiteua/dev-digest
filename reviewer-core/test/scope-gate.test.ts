/**
 * The scope gate — the only post-step in this engine that can REMOVE something a
 * user would otherwise have seen.
 *
 * Four properties earn it that right, and each has a test here: it is inert
 * without labels, it is inert when the caller did not activate it, it never
 * removes every CRITICAL, and it never drops silently.
 */
import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { applyScopeGate, scopeGateSummary } from '../src/scope-gate.js';

let seq = 0;
const finding = (over: Partial<Finding> = {}): Finding => ({
  id: `f-${seq++}`,
  severity: 'WARNING',
  category: 'bug',
  title: `finding ${seq}`,
  file: 'src/a.ts',
  start_line: 1,
  end_line: 2,
  rationale: 'because',
  confidence: 0.8,
  ...over,
});

describe('applyScopeGate', () => {
  it('is inert when the caller says the prompt carried no intent', () => {
    // The regression this guards: `Finding.scope` rides on the `Review` schema,
    // so its description reaches EVERY structured call and a model can label
    // `out` on a review that was never told what the change is for. An
    // intent-less run must keep exactly the findings it produced before this
    // file existed.
    const findings = [
      finding({ scope: 'out', severity: 'CRITICAL', title: 'out crit' }),
      finding({ scope: 'out', severity: 'WARNING', title: 'out warn' }),
      finding({ scope: 'in', severity: 'WARNING', title: 'in warn' }),
    ];
    const result = applyScopeGate(findings, { active: false });
    expect(result.kept).toEqual(findings);
    expect(result.dropped).toEqual([]);
  });

  it('drops out-of-scope noise and keeps exactly one serious signal', () => {
    // The brief's own shape: comments outside the scope are filtered out, but a
    // serious problem outside the PR's bounds keeps one signal.
    const inScope = finding({ scope: 'in', title: 'in-scope bug' });
    const critA = finding({ scope: 'out', severity: 'CRITICAL', confidence: 0.6, title: 'crit A' });
    const critB = finding({ scope: 'out', severity: 'CRITICAL', confidence: 0.95, title: 'crit B' });
    const warns = [
      finding({ scope: 'out', title: 'w1' }),
      finding({ scope: 'out', title: 'w2' }),
      finding({ scope: 'out', severity: 'SUGGESTION', title: 's1' }),
    ];

    const result = applyScopeGate([inScope, critA, critB, ...warns]);

    expect(result.kept.map((f) => f.title)).toEqual(['in-scope bug', 'crit B']);
    expect(result.dropped).toHaveLength(4);
    expect(scopeGateSummary(result)).toBe(
      '2/6 in scope; 1 out-of-scope CRITICAL kept as the signal',
    );
  });

  it('keeps an unlabelled finding whatever its severity', () => {
    // A model that ignores the field, an older provider, a reply that lost it in
    // repair — all produce the finding set they produced before this existed.
    const findings = [
      finding({ severity: 'CRITICAL' }),
      finding({ severity: 'WARNING' }),
      finding({ severity: 'SUGGESTION', scope: null }),
      finding({ severity: 'SUGGESTION', scope: undefined }),
    ];
    const result = applyScopeGate(findings);
    expect(result.kept).toHaveLength(4);
    expect(result.dropped).toHaveLength(0);
  });

  it('is a no-op when nothing was labelled out', () => {
    const findings = [finding({ scope: 'in' }), finding({ scope: 'in' })];
    const result = applyScopeGate(findings);
    expect(result.kept).toEqual(findings);
    expect(result.dropped).toEqual([]);
    expect(scopeGateSummary(result)).toBe('2/2 in scope');
  });

  it('never removes every CRITICAL, even when all of them are out of scope', () => {
    const result = applyScopeGate([
      finding({ scope: 'out', severity: 'CRITICAL', confidence: 0.3 }),
      finding({ scope: 'out', severity: 'CRITICAL', confidence: 0.4 }),
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.confidence).toBe(0.4);
  });

  it('breaks a confidence tie on report order, so two runs agree', () => {
    const first = finding({ scope: 'out', severity: 'CRITICAL', confidence: 0.7, title: 'first' });
    const second = finding({ scope: 'out', severity: 'CRITICAL', confidence: 0.7, title: 'second' });
    expect(applyScopeGate([first, second]).kept.map((f) => f.title)).toEqual(['first']);
  });

  it('preserves the order of the survivors, so a diff shows deletions only', () => {
    const a = finding({ scope: 'in', title: 'a' });
    const b = finding({ scope: 'out', title: 'b' });
    const c = finding({ scope: 'in', title: 'c' });
    expect(applyScopeGate([a, b, c]).kept.map((f) => f.title)).toEqual(['a', 'c']);
  });

  it('gives every drop a reason, because a silent filter is the failure', () => {
    const result = applyScopeGate([
      finding({ scope: 'out', severity: 'WARNING' }),
      finding({ scope: 'out', severity: 'CRITICAL', confidence: 0.9 }),
      finding({ scope: 'out', severity: 'CRITICAL', confidence: 0.1 }),
    ]);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped[0]!.reason).toContain('out of scope');
    expect(result.dropped[1]!.reason).toContain('already the signal');
    for (const d of result.dropped) expect(d.reason.length).toBeGreaterThan(0);
  });

  it('handles an empty finding set without inventing a signal', () => {
    const result = applyScopeGate([]);
    expect(result.kept).toEqual([]);
    expect(scopeGateSummary(result)).toBe('0/0 in scope');
  });
});
