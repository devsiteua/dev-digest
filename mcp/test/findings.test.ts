import { describe, expect, it } from 'vitest';

import type { FindingRecord, ReviewRecord, Severity } from '@devdigest/shared';

import {
  DEFAULT_FINDINGS_LIMIT,
  MAX_FINDINGS_LIMIT,
  buildReviewResult,
  clampLimit,
  compareNewestFirst,
  describeReviewResult,
  projectFinding,
  selectLatestReview,
  sortFindings,
} from '../src/shape/findings.js';

/**
 * The pure ring: which review counts as "the latest" (D7), and what a finding
 * looks like once it leaves this package.
 *
 * Everything here runs on two object literals. That is the point of keeping the
 * rule in `shape/` — the tie D7 is about is a property of the DATA, so proving it
 * needs no database, no server and no clock.
 */

/** A persisted finding with only the fields the projection reads spelled out. */
function finding(overrides: Partial<FindingRecord> & Pick<FindingRecord, 'id'>): FindingRecord {
  return {
    review_id: 'review-1',
    accepted_at: null,
    dismissed_at: null,
    severity: 'WARNING' as Severity,
    category: 'bug',
    title: `Finding ${overrides.id}`,
    file: 'src/index.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'Because the guard is missing.',
    suggestion: 'Add the guard.',
    confidence: 0.9,
    ...overrides,
  };
}

/** A persisted review; `kind` defaults to the one D7 is about. */
function review(overrides: Partial<ReviewRecord> & Pick<ReviewRecord, 'id'>): ReviewRecord {
  return {
    pr_id: 'pr-1',
    agent_id: null,
    run_id: 'run-1',
    agent_name: 'Security Reviewer',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'Two problems worth fixing.',
    score: 72,
    model: 'claude-opus-5',
    grounding: null,
    created_at: '2026-08-28T10:00:00.000Z',
    findings: [],
    ...overrides,
  };
}

const BASE = { repo: 'acme/payments-api', pr: 482, responseFormat: 'concise' as const };

describe('selectLatestReview — D7, and why it is never reviews[0]', () => {
  /**
   * THE tie this rule exists for.
   *
   * `defaultNow()` is the TRANSACTION's timestamp, so the agents fanned out by one
   * `all: true` review share `created_at` to the microsecond. `reviewsForPull`
   * orders by `desc(created_at)` and nothing else, so among these the API's order
   * is planner order — i.e. arbitrary. The fixture reproduces that exactly: the
   * timestamps are byte-identical, so ONLY the `id` tie-break can decide, and the
   * array is deliberately handed over in the "wrong" order.
   */
  const SHARED = '2026-08-28T10:00:00.000Z';
  const tie: ReviewRecord[] = [
    review({ id: 'aaa', agent_name: 'API Contract Reviewer', created_at: SHARED }),
    review({ id: 'zzz', agent_name: 'Security Reviewer', created_at: SHARED }),
    review({ id: 'mmm', agent_name: 'General Reviewer', created_at: SHARED }),
  ];

  it('breaks a created_at tie on id desc, not on array position', () => {
    expect(tie.every((r) => r.created_at === SHARED)).toBe(true);
    expect(selectLatestReview(tie)?.id).toBe('zzz');
  });

  it('gives the same answer whatever order the API returned them in', () => {
    // Planner order is arbitrary, so the rule has to be order-independent. Every
    // permutation must land on the same review, or two identical calls can differ.
    const permutations = [
      [tie[0]!, tie[1]!, tie[2]!],
      [tie[2]!, tie[1]!, tie[0]!],
      [tie[1]!, tie[0]!, tie[2]!],
      [tie[2]!, tie[0]!, tie[1]!],
    ];
    for (const order of permutations) {
      expect(selectLatestReview(order)?.id).toBe('zzz');
    }
  });

  it('still prefers a genuinely newer review over the id tie-break', () => {
    // The id must only ever be a TIE-break: when the timestamps differ it must not
    // get a vote, or "latest" would mean "biggest id".
    const rows = [
      review({ id: 'zzz', created_at: '2026-08-28T09:00:00.000Z' }),
      review({ id: 'aaa', created_at: '2026-08-28T11:00:00.000Z' }),
    ];
    expect(selectLatestReview(rows)?.id).toBe('aaa');
  });

  it('excludes kind: "summary" rows entirely', () => {
    // A summary is the consolidated write-up across agents, not one agent's pass.
    // It sorts FIRST here on both keys, so if it were not filtered it would win.
    const rows = [
      review({ id: 'zzzz', kind: 'summary', created_at: '2026-08-28T23:00:00.000Z' }),
      review({ id: 'aaa', kind: 'review', created_at: '2026-08-28T10:00:00.000Z' }),
    ];
    const picked = selectLatestReview(rows);
    expect(picked?.id).toBe('aaa');
    expect(picked?.kind).toBe('review');
  });

  it('returns null when every row is a summary', () => {
    expect(selectLatestReview([review({ id: 'a', kind: 'summary' })])).toBeNull();
  });

  it('narrows by agent name, case-insensitively', () => {
    const rows = [
      review({ id: 'b', agent_name: 'Security Reviewer', created_at: '2026-08-28T09:00:00.000Z' }),
      review({ id: 'a', agent_name: 'General Reviewer', created_at: '2026-08-28T11:00:00.000Z' }),
    ];
    // The newest overall is the General Reviewer's; asking for Security must not
    // silently hand back the newest row instead.
    expect(selectLatestReview(rows, { name: 'security reviewer' })?.id).toBe('b');
  });

  it('prefers agent_id over agent_name when both sides carry one', () => {
    const rows = [
      review({ id: 'a', agent_id: 'uuid-1', agent_name: 'Renamed Since' }),
      review({ id: 'b', agent_id: 'uuid-2', agent_name: 'Security Reviewer' }),
    ];
    expect(selectLatestReview(rows, { id: 'uuid-1', name: 'Security Reviewer' })?.id).toBe('a');
  });

  it('returns null when the named agent has not reviewed it', () => {
    expect(selectLatestReview([review({ id: 'a' })], { name: 'Nobody' })).toBeNull();
  });

  it('compareNewestFirst is a total order — equal ids compare equal', () => {
    const a = review({ id: 'same' });
    expect(compareNewestFirst(a, a)).toBe(0);
  });
});

describe('sortFindings — worst first, so truncation cannot drop a CRITICAL', () => {
  it('orders CRITICAL then WARNING then SUGGESTION', () => {
    const rows = [
      finding({ id: 's', severity: 'SUGGESTION' }),
      finding({ id: 'c', severity: 'CRITICAL' }),
      finding({ id: 'w', severity: 'WARNING' }),
    ];
    expect(sortFindings(rows).map((f) => f.id)).toEqual(['c', 'w', 's']);
  });

  it('is stable inside one severity', () => {
    const rows = [
      finding({ id: 'w1', severity: 'WARNING' }),
      finding({ id: 'w2', severity: 'WARNING' }),
      finding({ id: 'w3', severity: 'WARNING' }),
    ];
    expect(sortFindings(rows).map((f) => f.id)).toEqual(['w1', 'w2', 'w3']);
  });

  it('sorts an unknown severity last rather than first', () => {
    // `severity` is a free-text column, so an unrecognised value must not be able
    // to displace a CRITICAL at the top of a truncated list.
    const rows = [
      finding({ id: 'x', severity: 'NONSENSE' as Severity }),
      finding({ id: 'c', severity: 'CRITICAL' }),
    ];
    expect(sortFindings(rows).map((f) => f.id)).toEqual(['c', 'x']);
  });
});

describe('projectFinding — concise is the default, detailed is bigger', () => {
  const row = finding({ id: 'f1', severity: 'CRITICAL' });

  it('concise emits exactly severity, file, line and title', () => {
    const projected = projectFinding(row, 'concise');
    expect(Object.keys(projected).sort()).toEqual(['file', 'line', 'severity', 'title']);
    expect(projected).toMatchObject({
      severity: 'CRITICAL',
      file: 'src/index.ts',
      line: 10,
      title: 'Finding f1',
    });
  });

  it('concise carries no rationale and no suggestion', () => {
    const projected = projectFinding(row, 'concise');
    expect(projected).not.toHaveProperty('rationale');
    expect(projected).not.toHaveProperty('suggestion');
  });

  it('detailed adds rationale, suggestion, confidence, category and id', () => {
    const projected = projectFinding(row, 'detailed');
    expect(projected).toMatchObject({
      id: 'f1',
      category: 'bug',
      rationale: 'Because the guard is missing.',
      suggestion: 'Add the guard.',
      confidence: 0.9,
    });
  });

  it('detailed is a materially larger payload than concise', () => {
    const concise = JSON.stringify(projectFinding(row, 'concise'));
    const detailed = JSON.stringify(projectFinding(row, 'detailed'));
    expect(detailed.length).toBeGreaterThan(concise.length);
  });

  it('projects line from start_line, not from end_line', () => {
    const projected = projectFinding(finding({ id: 'f', start_line: 41, end_line: 99 }), 'concise');
    expect(projected.line).toBe(41);
  });

  it('normalises a missing suggestion to null in detailed form', () => {
    const projected = projectFinding(finding({ id: 'f', suggestion: null }), 'detailed');
    expect(projected.suggestion).toBeNull();
  });
});

describe('clampLimit — the documented window', () => {
  it('defaults to 20 when unset', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_FINDINGS_LIMIT);
    expect(DEFAULT_FINDINGS_LIMIT).toBe(20);
  });

  it('caps at 100', () => {
    expect(clampLimit(5_000)).toBe(MAX_FINDINGS_LIMIT);
    expect(MAX_FINDINGS_LIMIT).toBe(100);
  });

  it('floors at 1 and rejects nonsense without throwing', () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-7)).toBe(1);
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_FINDINGS_LIMIT);
  });
});

describe('buildReviewResult — truncation is never silent', () => {
  const many = Array.from({ length: 25 }, (_, i) =>
    finding({ id: `f${i}`, severity: i === 0 ? 'CRITICAL' : 'SUGGESTION' }),
  );

  it('reports total_findings above the returned count when limit cuts', () => {
    const result = buildReviewResult({
      ...BASE,
      reviews: [review({ id: 'r', findings: many })],
      limit: 5,
    });
    expect(result.findings).toHaveLength(5);
    expect(result.total_findings).toBe(25);
    expect(result.total_findings).toBeGreaterThan(result.findings.length);
  });

  it('applies the default limit of 20 when none is given', () => {
    const result = buildReviewResult({ ...BASE, reviews: [review({ id: 'r', findings: many })] });
    expect(result.findings).toHaveLength(20);
    expect(result.total_findings).toBe(25);
  });

  it('keeps total_findings equal to the count when nothing was dropped', () => {
    const result = buildReviewResult({
      ...BASE,
      reviews: [review({ id: 'r', findings: many.slice(0, 3) })],
    });
    expect(result.total_findings).toBe(3);
    expect(result.findings).toHaveLength(3);
  });

  it('drops SUGGESTIONs before a CRITICAL when it truncates', () => {
    const result = buildReviewResult({
      ...BASE,
      reviews: [review({ id: 'r', findings: many })],
      limit: 1,
    });
    expect(result.findings[0]?.severity).toBe('CRITICAL');
  });

  it('says so in the text when it truncated', () => {
    const result = buildReviewResult({
      ...BASE,
      reviews: [review({ id: 'r', findings: many })],
      limit: 5,
    });
    expect(describeReviewResult(result)).toContain('5 of 25 findings');
  });
});

describe('buildReviewResult — a PR nobody reviewed is not an empty review', () => {
  it('returns reviewed: false and is not an error', () => {
    const result = buildReviewResult({ ...BASE, reviews: [] });
    expect(result.reviewed).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.total_findings).toBe(0);
    expect(result.verdict).toBeNull();
  });

  it('explains in words that nothing looked, rather than that nothing was found', () => {
    const result = buildReviewResult({ ...BASE, reviews: [] });
    expect(result.summary).toContain('No agent has reviewed');
    expect(result.summary).toContain('not an empty review');
    expect(result.summary).toContain('run_agent_on_pr');
  });

  it('distinguishes "that agent has not" from "nobody has"', () => {
    const reviewed = buildReviewResult({
      ...BASE,
      reviews: [review({ id: 'r', agent_name: 'General Reviewer' })],
      agent: { name: 'Security Reviewer' },
    });
    expect(reviewed.reviewed).toBe(false);
    // It must name who DID review it — otherwise the caller's next step is a paid
    // run when a free `get_findings` would have answered them.
    expect(reviewed.summary).toContain('General Reviewer');
    expect(reviewed.summary).toContain('without the agent argument');
  });

  it('names the agent that produced the review when none was asked for', () => {
    const result = buildReviewResult({
      ...BASE,
      reviews: [review({ id: 'r', agent_name: 'Security Reviewer' })],
    });
    expect(result.reviewed).toBe(true);
    // With no `agent` argument this field is the only thing that says whose pass
    // came back, which the tool's description promises in words.
    expect(result.agent).toBe('Security Reviewer');
  });

  it('carries the verdict, score and run id of the review it picked', () => {
    const result = buildReviewResult({
      ...BASE,
      reviews: [review({ id: 'r', run_id: 'run-42' })],
    });
    expect(result).toMatchObject({ verdict: 'request_changes', score: 72 });
    expect(result.run.id).toBe('run-42');
    // A persisted review knows its run id and nothing else about the run; null
    // here means "not read", never "zero".
    expect(result.run.status).toBeNull();
    expect(result.run.cost_usd).toBeNull();
  });

  it('echoes the response_format it was asked for', () => {
    const result = buildReviewResult({
      ...BASE,
      responseFormat: 'detailed',
      reviews: [review({ id: 'r', findings: [finding({ id: 'f' })] })],
    });
    expect(result.response_format).toBe('detailed');
    expect(result.findings[0]).toHaveProperty('rationale');
  });
});
