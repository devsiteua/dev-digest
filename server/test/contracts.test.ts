import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillRequest,
  Settings,
  Repo,
  PrDetail,
  PrMeta,
  Agent,
  SkillStats,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, cost_usd: 0.06, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
    expect(trace.stats.cost_usd).toBe(0.06);
  });

  it('RunTrace parses a LEGACY stats block with no cost_usd key', () => {
    // run_traces holds persisted documents: every trace written before cost
    // existed has no `cost_usd` key at all. If RunStats required it, the trace
    // drawer would 500 on every historical run — hence .nullish(), not
    // .nullable(). This is the regression guard for that choice.
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [],
      raw_output: '{}',
      memory_pulled: [],
      specs_read: [],
      log: [],
    });
    expect(trace.stats.cost_usd).toBeUndefined();
  });

  it('ConventionCandidate (data.jsx CONVENTIONS, reshaped for the extractor)', () => {
    const c = ConventionCandidate.parse({
      id: 'c1',
      repo_id: 'r1',
      rule: 'Always use async/await instead of .then() chains',
      category: 'async',
      evidence_path: 'src/api/users.ts',
      evidence_snippet: 'const user = await db.users.find(id);',
      evidence_start_line: 23,
      evidence_end_line: 31,
      confidence: 0.91,
      status: 'pending',
      skill_id: null,
      created_at: '2026-08-06T10:00:00.000Z',
    });
    expect(c.status).toBe('pending');
    // The prototype pinned the range inside the path ("src/api/users.ts:23-31").
    // We keep the two numbers separate because the server has to slice the file
    // with them; rendering them back as one string is the UI's job.
    expect(c.evidence_end_line - c.evidence_start_line).toBe(8);
    expect(() =>
      ConventionExtractResult.parse({
        candidates: [c],
        sampled_files: ['src/api/users.ts'],
        discarded: [{ rule: 'Repos always end in Repository', reason: 'evidence_path not sampled' }],
      }),
    ).not.toThrow();
  });

  it('ConventionCandidate rejects a boolean-era status and an out-of-range confidence', () => {
    // `accepted: boolean` became a three-state status, so "reviewed and refused"
    // is distinguishable from "not reviewed yet". Anything outside those three
    // words — including the old field's shape — must not parse.
    const base = {
      id: 'c1',
      repo_id: 'r1',
      rule: 'r',
      category: 'async',
      evidence_path: 'a.ts',
      evidence_snippet: 's',
      evidence_start_line: 1,
      evidence_end_line: 2,
      confidence: 0.5,
      status: 'pending' as const,
      skill_id: null,
      created_at: '2026-08-06T10:00:00.000Z',
    };
    const { status: _dropped, ...booleanEra } = base;
    expect(() => ConventionCandidate.parse({ ...base, status: 'approved' })).toThrow();
    expect(() => ConventionCandidate.parse({ ...booleanEra, accepted: true })).toThrow();
    expect(() => ConventionCandidate.parse({ ...base, confidence: 1.4 })).toThrow();
  });

  it('ConventionSkillRequest carries no source — the server stamps it', () => {
    // Same rule as SkillDraft: provenance is decided by the endpoint, never read
    // from the body, or a caller could label generated text 'manual' and skip
    // the untrusted wrapping.
    const req = ConventionSkillRequest.parse({
      name: 'repo-conventions',
      description: '3 house conventions extracted from payments-api',
      type: 'convention',
      enabled: true,
      body: '# repo-conventions\n\n## no-then-chains\n',
      convention_ids: ['c1', 'c2', 'c3'],
      source: 'manual',
    });
    expect(req).not.toHaveProperty('source');
    expect(() =>
      ConventionSkillRequest.parse({
        name: 'repo-conventions',
        description: '',
        type: 'convention',
        enabled: true,
        body: '# x',
        convention_ids: [],
      }),
    ).toThrow();
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });

  // findings_by_severity is list-only. PrDetail extends PrMeta and GET /pulls/:id
  // never emits it, so the field has to be .nullish() — .nullable() would make the
  // key required and 400 the detail endpoint. The PrDetail case above is the guard;
  // these pin the list shape itself.
  it('PrMeta.findings_by_severity: absent, null, and a full tally all parse', () => {
    const base = {
      number: 482,
      title: 't',
      author: 'a',
      branch: 'b',
      base: 'main',
      head_sha: 'sha',
      additions: 1,
      deletions: 0,
      files_count: 1,
      status: 'open' as const,
    };
    expect(PrMeta.parse(base).findings_by_severity).toBeUndefined();
    expect(PrMeta.parse({ ...base, findings_by_severity: null }).findings_by_severity).toBeNull();
    expect(
      PrMeta.parse({
        ...base,
        findings_by_severity: { critical: 2, warning: 1, suggestion: 1 },
      }).findings_by_severity,
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  // skill_count is DERIVED, so a producer that does not count must be able to
  // omit the key entirely — .nullable() would make it required and 500 every
  // response built without a count (a plugin export, a fixture, a version snapshot).
  it('Agent.skill_count: absent, null and a real count all parse', () => {
    const base = {
      id: 'ag1',
      name: 'Security Reviewer',
      description: 'd',
      provider: 'openai' as const,
      model: 'gpt-4.1',
      system_prompt: 'p',
      enabled: true,
      version: 1,
    };
    expect(Agent.parse(base).skill_count).toBeUndefined();
    expect(Agent.parse({ ...base, skill_count: null }).skill_count).toBeNull();
    expect(Agent.parse({ ...base, skill_count: 3 }).skill_count).toBe(3);
    expect(() => Agent.parse({ ...base, skill_count: 1.5 })).toThrow();
  });

  it('SkillStats keeps accept_rate nullable — untriaged is not 0%', () => {
    const stats = SkillStats.parse({
      used_by: [{ agent_id: 'ag1', agent_name: 'A', agent_enabled: false }],
      window_days: 30,
      runs: 4,
      findings: 0,
      accepted: 0,
      dismissed: 0,
      accept_rate: null,
      by_category: [],
    });
    expect(stats.accept_rate).toBeNull();
    // The key itself is required: a stats response that forgot to compute the
    // rate must fail here rather than render as "nothing triaged".
    expect(() =>
      SkillStats.parse({
        used_by: [],
        window_days: 30,
        runs: 0,
        findings: 0,
        accepted: 0,
        dismissed: 0,
        by_category: [],
      }),
    ).toThrow();
  });

  it('PrMeta rejects a non-integer severity tally', () => {
    expect(() =>
      PrMeta.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        findings_by_severity: { critical: 1.5, warning: 0, suggestion: 0 },
      }),
    ).toThrow();
  });
});
