/**
 * L07-A — the pure half of Multi-Agent Review: which findings describe the same
 * place, where the agents disagree, and what the next run is likely to cost.
 *
 * All three are functions of their arguments alone — no database, no clock, no
 * model — which is why the unit lane is their gate. The properties asserted here
 * are the ones the read path cannot restate: grouping is a PARTITION (AC-16) and
 * it is deterministic (AC-17); no member's text is rewritten (AC-15); an agent
 * that never finished produces no take at all (AC-19); and an estimate with no
 * sample answers `null` rather than `0` (AC-22, AC-23).
 */
import { describe, it, expect } from 'vitest';
import type { AgentColumn, FindingGroup } from '@devdigest/shared';
import {
  detectConflicts,
  estimateFor,
  groupFindings,
  type EstimatableRun,
  type GroupableFinding,
} from '../src/modules/multi-agent/helpers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let findingSeq = 0;

/** One persisted finding. Everything not named is a value nothing asserts on. */
function finding(over: Partial<GroupableFinding> = {}): GroupableFinding {
  findingSeq += 1;
  return {
    finding_id: `f-${findingSeq}`,
    agent_id: 'agent-sec',
    agent_name: 'Security Reviewer',
    run_id: 'run-sec',
    file: 'src/config.ts',
    start_line: 12,
    end_line: 12,
    title: 'Hardcoded Stripe secret key committed to the repository',
    rationale: 'Line 12 holds a literal live Stripe secret key.',
    suggestion: 'Read it from the environment and rotate the exposed key.',
    severity: 'CRITICAL',
    confidence: 0.95,
    ...over,
  };
}

/** A column, reduced to what `detectConflicts` reads: the agent and its status. */
function column(over: Partial<AgentColumn> & Pick<AgentColumn, 'agent_id'>): AgentColumn {
  return {
    run_id: `run-${over.agent_id}`,
    agent_name: over.agent_id,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    status: 'done',
    error: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings: [],
    ...over,
  };
}

const idsOf = (groups: readonly FindingGroup[]): string[][] =>
  groups.map((g) => g.members.map((m) => m.finding_id));

// ---------------------------------------------------------------------------
// groupFindings
// ---------------------------------------------------------------------------

describe('groupFindings — the same place, said by several agents (AC-15 … AC-17)', () => {
  it('joins near-identical titles on the same line into one group of three', () => {
    // Three agents on `src/config.ts:12`, each phrasing the committed key its own
    // way. This is the case the seed builds the demo screen around.
    const a = finding({ agent_id: 'sec', title: 'Hardcoded Stripe secret key committed to the repository' });
    const b = finding({ agent_id: 'gen', title: 'Hardcoded Stripe secret key committed to config' });
    const c = finding({ agent_id: 'perf', title: 'Hardcoded Stripe secret key in config' });

    const groups = groupFindings([a, b, c]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((m) => m.agent_id).sort()).toEqual(['gen', 'perf', 'sec']);
  });

  it('carries every member text through byte-identically — nothing is rewritten, shortened or merged', () => {
    // AC-15's own wording: the group's `title` is a REPRESENTATIVE, and each
    // member still holds what its agent actually wrote.
    const first = finding({
      agent_id: 'sec',
      title: 'Hardcoded Stripe secret key committed to the repository',
      rationale: 'Line 12 holds a literal live Stripe secret key; rotating it is part of the fix.',
      suggestion: 'Read it from `process.env.STRIPE_SECRET_KEY` and rotate the exposed key.',
      severity: 'CRITICAL',
      confidence: 0.97,
    });
    const second = finding({
      agent_id: 'gen',
      title: 'Hardcoded Stripe secret key committed to config',
      rationale: 'A literal live Stripe secret key sits in `src/config.ts` and ships with the build.',
      suggestion: 'Move it to an environment variable and rotate it.',
      severity: 'CRITICAL',
      confidence: 0.95,
    });

    const [group] = groupFindings([first, second]);

    expect(group!.members).toHaveLength(2);
    for (const source of [first, second]) {
      const member = group!.members.find((m) => m.finding_id === source.finding_id);
      expect(member).toBeDefined();
      expect(member!.title).toBe(source.title);
      expect(member!.rationale).toBe(source.rationale);
      expect(member!.suggestion).toBe(source.suggestion);
      expect(member!.severity).toBe(source.severity);
      expect(member!.confidence).toBe(source.confidence);
      expect(member!.agent_name).toBe(source.agent_name);
      expect(member!.run_id).toBe(source.run_id);
    }
  });

  it('keeps a null suggestion null rather than filling it in', () => {
    const [group] = groupFindings([finding({ suggestion: null })]);
    expect(group!.members[0]!.suggestion).toBeNull();
  });

  it('the union of the groups is the input set and their intersections are empty (AC-16)', () => {
    // A deliberately mixed input: one trio that joins, one pair split by file,
    // one pair split by distance, one pair split by wording.
    const input = [
      finding({ agent_id: 'sec', title: 'Hardcoded Stripe secret key committed to the repository' }),
      finding({ agent_id: 'gen', title: 'Hardcoded Stripe secret key committed to config' }),
      finding({ agent_id: 'perf', title: 'Hardcoded Stripe secret key in config' }),
      // Same title, different FILE.
      finding({ agent_id: 'sec', file: 'src/other.ts' }),
      // Same file and title, far away — outside GROUP_LINE_WINDOW.
      finding({ agent_id: 'gen', start_line: 400, end_line: 400 }),
      // Same file and line, unrelated wording.
      finding({ agent_id: 'perf', title: 'N+1 query in the user list endpoint' }),
      // A finding no other agent came near: a group of one is a valid group.
      finding({ agent_id: 'sec', file: 'src/api/public/webhooks.ts', start_line: 61, end_line: 74, title: 'Webhook forwarder follows an attacker-controlled callback URL' }),
    ];

    const groups = groupFindings(input);
    const memberIds = groups.flatMap((g) => g.members.map((m) => m.finding_id));

    // Partition, both halves: every finding appears, and no finding twice.
    expect(new Set(memberIds)).toEqual(new Set(input.map((f) => f.finding_id)));
    expect(memberIds).toHaveLength(input.length);
    // And a single finding really did come back as its own group.
    expect(idsOf(groups).some((ids) => ids.length === 1)).toBe(true);
  });

  it('returns no group at all for no findings', () => {
    expect(groupFindings([])).toEqual([]);
  });

  it('is deterministic: two calls on the same input give identical groups, order included (AC-17)', () => {
    const input = [
      finding({ agent_id: 'perf', title: 'N+1 query in the user list endpoint', file: 'src/api/users.ts', start_line: 45, end_line: 52 }),
      finding({ agent_id: 'sec', title: 'Hardcoded Stripe secret key committed to the repository' }),
      finding({ agent_id: 'gen', title: 'Hardcoded Stripe secret key committed to config' }),
      finding({ agent_id: 'sec', title: 'Magic number 3600 duplicated instead of a named constant', file: 'src/middleware/ratelimit.ts', start_line: 28, end_line: 28, severity: 'WARNING' }),
    ];

    expect(groupFindings(input)).toEqual(groupFindings(input));
  });

  it('does not inherit the order it was handed: a shuffled input groups the same way (AC-17)', () => {
    // The reason `groupFindings` sorts its own inputs. `getPrFiles` and friends
    // return planner order, so a function whose determinism is load-bearing may
    // not borrow an ordering from a query it does not own.
    const input = [
      finding({ agent_id: 'sec', title: 'Hardcoded Stripe secret key committed to the repository' }),
      finding({ agent_id: 'gen', title: 'Hardcoded Stripe secret key committed to config' }),
      finding({ agent_id: 'perf', title: 'N+1 query in the user list endpoint', file: 'src/api/users.ts', start_line: 45, end_line: 52 }),
      finding({ agent_id: 'sec', title: 'Magic number 3600 duplicated instead of a named constant', file: 'src/middleware/ratelimit.ts', start_line: 28, end_line: 28, severity: 'WARNING' }),
    ];
    const reversed = [...input].reverse();

    expect(groupFindings(reversed)).toEqual(groupFindings(input));
  });

  it('groups by transitive closure: A joins B and B joins C, so all three are one group', () => {
    // Neither end is similar enough to the other on its own; the middle finding
    // is what makes them one place. Union-find is what makes this a property
    // rather than an accident of iteration order.
    const a = finding({ agent_id: 'a', start_line: 10, end_line: 10, title: 'Unbounded loop over user records' });
    const b = finding({ agent_id: 'b', start_line: 14, end_line: 14, title: 'Unbounded loop over user records' });
    const c = finding({ agent_id: 'c', start_line: 18, end_line: 18, title: 'Unbounded loop over user records' });

    const groups = groupFindings([a, b, c]);

    expect(idsOf(groups)).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(3);
  });

  it('keeps two findings on the same line apart when they describe different defects', () => {
    const key = finding({ agent_id: 'sec', title: 'Hardcoded Stripe secret key committed to the repository' });
    const perf = finding({ agent_id: 'perf', title: 'N+1 query issued inside the request handler' });

    expect(groupFindings([key, perf])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// detectConflicts
// ---------------------------------------------------------------------------

describe('detectConflicts — where the agents disagree (AC-18, AC-19, AC-37)', () => {
  const done = [column({ agent_id: 'sec' }), column({ agent_id: 'gen' }), column({ agent_id: 'perf' })];

  /** A one-place group, flagged by the named agents at the given severities. */
  const groupOf = (entries: { agent: string; severity: GroupableFinding['severity'] }[]) =>
    groupFindings(
      entries.map((e) =>
        finding({
          agent_id: e.agent,
          agent_name: e.agent,
          run_id: `run-${e.agent}`,
          severity: e.severity,
          title: 'Hardcoded Stripe secret key committed to the repository',
        }),
      ),
    );

  it('a place every finished agent flagged, at one severity, is NOT a conflict', () => {
    const groups = groupOf([
      { agent: 'sec', severity: 'CRITICAL' },
      { agent: 'gen', severity: 'CRITICAL' },
      { agent: 'perf', severity: 'CRITICAL' },
    ]);

    const { conflicts, agents_considered } = detectConflicts(groups, done);

    expect(conflicts).toEqual([]);
    expect(agents_considered).toBe(3);
  });

  it('one agent flags it and a finished agent stayed silent — a conflict, with an `ignored` take for the silent one', () => {
    const groups = groupOf([{ agent: 'perf', severity: 'WARNING' }]);

    const { conflicts } = detectConflicts(groups, done);

    expect(conflicts).toHaveLength(1);
    const takes = conflicts[0]!.takes;
    expect(takes.find((tk) => tk.agent_id === 'perf')!.verdict).toBe('WARNING');
    expect(takes.filter((tk) => tk.verdict === 'ignored').map((tk) => tk.agent_id).sort()).toEqual([
      'gen',
      'sec',
    ]);
    // The `did not flag` wording is the client's copy, so the note stays empty.
    expect(takes.find((tk) => tk.verdict === 'ignored')!.note).toBe('');
  });

  it('two agents flag the same place at different severities — a conflict even with nobody silent', () => {
    const groups = groupOf([
      { agent: 'sec', severity: 'WARNING' },
      { agent: 'gen', severity: 'SUGGESTION' },
      { agent: 'perf', severity: 'CRITICAL' },
    ]);

    const { conflicts } = detectConflicts(groups, done);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes).toHaveLength(3);
    expect(conflicts[0]!.takes.every((tk) => tk.verdict !== 'ignored')).toBe(true);
    expect(new Set(conflicts[0]!.takes.map((tk) => tk.verdict))).toEqual(
      new Set(['WARNING', 'SUGGESTION', 'CRITICAL']),
    );
  });

  it('an agent that failed, was cancelled or is still running gets no take at all (AC-19)', () => {
    // The point of the criterion: `ignored` reads as "looked and declined". An
    // agent that never finished made no such judgement.
    const columns = [
      column({ agent_id: 'sec' }),
      column({ agent_id: 'gen', status: 'failed', error: 'provider timed out' }),
      column({ agent_id: 'cancel', status: 'cancelled' }),
      column({ agent_id: 'live', status: 'running' }),
    ];
    const groups = groupOf([{ agent: 'sec', severity: 'CRITICAL' }]);

    const { conflicts, agents_considered } = detectConflicts(groups, columns);

    // With `sec` the only finished agent and nobody else able to be silent, the
    // place is unanimous among those who could look — no conflict, no takes.
    expect(conflicts).toEqual([]);
    expect(agents_considered).toBe(1);
  });

  it('an unfinished agent is absent from the takes of a conflict that does exist (AC-19)', () => {
    const columns = [
      column({ agent_id: 'sec' }),
      column({ agent_id: 'gen' }),
      column({ agent_id: 'gone', status: 'failed', error: 'provider timed out' }),
    ];
    const groups = groupOf([{ agent: 'sec', severity: 'CRITICAL' }]);

    const { conflicts, agents_considered } = detectConflicts(groups, columns);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes.map((tk) => tk.agent_id).sort()).toEqual(['gen', 'sec']);
    // AC-37's line: the block speaks for 2 of 3.
    expect(agents_considered).toBe(2);
  });

  it('a finding whose agent did not finish cannot make a place contended on its own', () => {
    // The whole group belongs to an agent that failed. Nobody who finished
    // flagged the place, so there is no stance to disagree with.
    const columns = [column({ agent_id: 'sec' }), column({ agent_id: 'gone', status: 'failed', error: 'boom' })];
    const groups = groupOf([{ agent: 'gone', severity: 'CRITICAL' }]);

    expect(detectConflicts(groups, columns).conflicts).toEqual([]);
  });

  it('carries the group\'s own file, line and title onto the conflict', () => {
    const groups = groupFindings([
      finding({
        agent_id: 'perf',
        agent_name: 'perf',
        file: 'src/api/users.ts',
        start_line: 45,
        end_line: 52,
        severity: 'WARNING',
        title: 'N+1 query in the user list endpoint',
      }),
    ]);

    const { conflicts } = detectConflicts(groups, done);

    expect(conflicts[0]!.file).toBe('src/api/users.ts');
    expect(conflicts[0]!.line).toBe(45);
    expect(conflicts[0]!.title).toBe('N+1 query in the user list endpoint');
  });
});

// ---------------------------------------------------------------------------
// estimateFor
// ---------------------------------------------------------------------------

describe('estimateFor — what a run is likely to cost, from runs that happened (AC-22, AC-23)', () => {
  const run = (over: Partial<EstimatableRun> = {}): EstimatableRun => ({
    status: 'done',
    duration_ms: 8_000,
    cost_usd: 0.004,
    ...over,
  });

  it('answers null on an empty history — never a zero (AC-22)', () => {
    expect(estimateFor([])).toEqual({
      runs_sampled: 0,
      avg_duration_ms: null,
      avg_cost_usd: null,
    });
  });

  it('answers null when every past run failed, because a failure is not a price', () => {
    const estimate = estimateFor([
      run({ status: 'failed', duration_ms: 120, cost_usd: 0 }),
      run({ status: 'cancelled' }),
      run({ status: 'running', duration_ms: null, cost_usd: null }),
    ]);

    expect(estimate.runs_sampled).toBe(0);
    expect(estimate.avg_duration_ms).toBeNull();
    expect(estimate.avg_cost_usd).toBeNull();
  });

  it('averages only the completed runs', () => {
    const estimate = estimateFor([
      run({ duration_ms: 8_000, cost_usd: 0.004 }),
      run({ duration_ms: 6_000, cost_usd: 0.002 }),
      run({ status: 'failed', duration_ms: 100, cost_usd: 9 }),
    ]);

    expect(estimate.runs_sampled).toBe(2);
    expect(estimate.avg_duration_ms).toBe(7_000);
    expect(estimate.avg_cost_usd).toBeCloseTo(0.003, 10);
  });

  it('reports a duration with a null cost when the model was unpriced — the two are different facts', () => {
    const estimate = estimateFor([run({ duration_ms: 5_000, cost_usd: null })]);

    expect(estimate.runs_sampled).toBe(1);
    expect(estimate.avg_duration_ms).toBe(5_000);
    expect(estimate.avg_cost_usd).toBeNull();
  });

  it('distinguishes a genuinely free run from an unknown price', () => {
    // 0 is a price. It must survive as 0 rather than being folded into null.
    const estimate = estimateFor([run({ cost_usd: 0 }), run({ cost_usd: 0 })]);
    expect(estimate.avg_cost_usd).toBe(0);
  });

  it('samples at most ten runs, taking the ones handed over first', () => {
    // The caller sorts newest-first, so the cap must not average in the eleventh.
    const recent = Array.from({ length: 10 }, () => run({ duration_ms: 1_000, cost_usd: 0.001 }));
    const ancient = Array.from({ length: 5 }, () => run({ duration_ms: 100_000, cost_usd: 5 }));

    const estimate = estimateFor([...recent, ...ancient]);

    expect(estimate.runs_sampled).toBe(10);
    expect(estimate.avg_duration_ms).toBe(1_000);
    expect(estimate.avg_cost_usd).toBeCloseTo(0.001, 10);
  });

  it('rounds the duration to a whole millisecond, because the contract types it as an int', () => {
    const estimate = estimateFor([run({ duration_ms: 1_000 }), run({ duration_ms: 1_001 })]);
    expect(estimate.avg_duration_ms).toBe(1_001);
    expect(Number.isInteger(estimate.avg_duration_ms)).toBe(true);
  });
});
