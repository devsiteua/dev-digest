import { describe, it, expect } from 'vitest';
import type { BlastRadiusResponse, PrBriefRecord } from '@devdigest/shared';
import {
  BRIEF_LIMITS_NONE,
  assembleBriefInput,
  briefDelta,
  briefStateOf,
  buildAllowList,
  extractLinkedIssue,
  groundRefs,
  normaliseKind,
  normaliseReply,
  normaliseSeverity,
  settleRiskLevel,
  sortBriefFiles,
  toBriefTimeline,
  trimToBudget,
  type BriefInputParts,
} from '../src/modules/brief/helpers.js';
import {
  BRIEF_INPUT_TOKEN_BUDGET,
  BRIEF_SYSTEM_PROMPT,
  BRIEF_TRIM_MAX_FILES,
} from '../src/modules/brief/constants.js';

/**
 * L05 — everything the PR brief decides with no clock, no database and no
 * network: the assembler's byte-identity, the budget ladder rung by rung, the
 * grounding filter's two halves and two drop rules, and the code that settles a
 * risk level rather than asking for one.
 *
 * Both counters here are deterministic and neither is `js-tiktoken`. That is the
 * point of `count` being a parameter: a rung is only assertable against a
 * counter whose answer a reader can predict.
 *   - `chars` — one token per character. Used wherever the REAL
 *     `BRIEF_INPUT_TOKEN_BUDGET` has to bind, because it makes the real system
 *     prompt a large, known share of the 8 000.
 *   - `words` — whitespace-separated runs. Used for the one criterion that is
 *     about the ARITHMETIC: it merges across the join, so `count(a + b)` and
 *     `count(a) + count(b)` differ by exactly one and a test can tell which was
 *     computed.
 */
const chars = (text: string) => text.length;
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

// ---- Fixtures ---------------------------------------------------------------

const blast = (over: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse => ({
  summary: 'Two exported symbols move, and one HTTP route sits downstream of them.',
  changed_symbols: [
    { name: 'canViewOrder', file: 'src/authorization.ts', kind: 'function' },
    { name: 'OrderRouter', file: 'src/api/router.ts', kind: 'class' },
  ],
  downstream: [
    {
      symbol: 'canViewOrder',
      callers: [
        { name: 'listOrders', file: 'src/orders/service.ts', line: 42 },
        { name: 'getOrder', file: 'src/orders/service.ts', line: 88 },
      ],
      endpoints_affected: ['GET /orders', 'GET /orders/:id'],
      crons_affected: ['nightly-order-reconcile'],
    },
    {
      symbol: 'OrderRouter',
      callers: [{ name: 'buildApp', file: 'src/app.ts', line: 17 }],
      endpoints_affected: ['POST /orders'],
      crons_affected: [],
    },
  ],
  status: 'ok',
  reason: null,
  indexed_sha: 'abc1234',
  ...over,
});

const parts = (over: Partial<BriefInputParts> = {}): BriefInputParts => ({
  title: 'Scope order visibility to the requesting customer',
  branch: 'feat/order-authorization',
  body: 'Customers could read one another’s orders. This scopes every read to the caller.',
  intent: {
    kind: 'fix',
    intent: 'Stop one customer reading another customer’s orders.',
    in_scope: ['the order read path'],
    out_of_scope: ['the admin console'],
    confidence_tier: 'high',
  },
  blast: blast(),
  files: [
    { path: 'src/authorization.ts', additions: 40, deletions: 12 },
    { path: 'src/orders/service.ts', additions: 8, deletions: 3 },
    { path: 'src/api/router.ts', additions: 2, deletions: 0 },
  ],
  issue: {
    number: 471,
    title: 'Order visibility leaks across customers',
    body: 'Reported by support. Any authenticated customer can read any order by id.',
  },
  contextDocs: [
    { title: 'Auth rules', path_label: 'docs/auth.md', body: 'Every read is scoped by tenant.' },
    { title: 'API style', path_label: 'docs/api.md', body: 'Routes are plural nouns.' },
  ],
  missingInputs: [],
  limits: BRIEF_LIMITS_NONE,
  ...over,
});

/** Enough prose to push a fixture past a small budget without changing its shape. */
const filler = (n: number) => 'lorem ipsum dolor sit amet consectetur '.repeat(n);

// ---- AC-06 · the assembler is a pure function of its inputs ------------------

describe('the assembled input is a pure function of its inputs (AC-06)', () => {
  it('produces a byte-identical string twice, on a fixture no rung touches', () => {
    const input = parts();
    const a = briefStateOf(input, chars);
    const b = briefStateOf(input, chars);

    expect(a.trimmed).toEqual([]);
    expect(a.user).toBe(b.user);
    expect(a.stateKey).toBe(b.stateKey);
  });

  it('produces a byte-identical string twice on a fixture that FIRES a rung', () => {
    // The ladder lives inside the hashed unit, so a purity test that only ever
    // walks the no-op path proves the purity of `assembleBriefInput` rather than
    // of the thing AC-05 and AC-06 are about.
    const input = parts({
      contextDocs: [
        { title: 'Auth rules', path_label: 'docs/auth.md', body: filler(200) },
        { title: 'API style', path_label: 'docs/api.md', body: filler(200) },
      ],
    });
    const a = briefStateOf(input, chars);
    const b = briefStateOf(input, chars);

    expect(a.trimmed.length).toBeGreaterThan(0);
    expect(a.overBudget).toBe(false);
    expect(a.user).toBe(b.user);
    expect(a.stateKey).toBe(b.stateKey);
  });

  it('does not depend on the order `getPrFiles` happened to return', () => {
    const files = [
      { path: 'src/api/router.ts', additions: 2, deletions: 0 },
      { path: 'src/authorization.ts', additions: 40, deletions: 12 },
      { path: 'src/orders/service.ts', additions: 8, deletions: 3 },
    ];
    const shuffled = [files[1]!, files[2]!, files[0]!];

    expect(briefStateOf(parts({ files }), chars).stateKey).toBe(
      briefStateOf(parts({ files: shuffled }), chars).stateKey,
    );
  });

  it('sorts files by total change descending, then by path', () => {
    expect(
      sortBriefFiles([
        { path: 'b.ts', additions: 1, deletions: 1 },
        { path: 'a.ts', additions: 1, deletions: 1 },
        { path: 'big.ts', additions: 10, deletions: 0 },
      ]).map((f) => f.path),
    ).toEqual(['big.ts', 'a.ts', 'b.ts']);
  });
});

// ---- AC-05 · the state key -------------------------------------------------

describe('state_key is the hash of what will be sent, and of nothing else (AC-05)', () => {
  it('is a SHA-256 hex of the system and user messages joined', () => {
    const state = briefStateOf(parts(), chars);
    expect(state.stateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(state.system).toBe(BRIEF_SYSTEM_PROMPT);
  });

  it.each([
    ['the title', { title: 'A different title' }],
    ['the body', { body: 'A different description' }],
    ['a file', { files: [{ path: 'src/other.ts', additions: 1, deletions: 1 }] }],
    ['the intent', { intent: null }],
    ['the blast map', { blast: null }],
    ['a context document', { contextDocs: [] }],
    ['the linked issue', { issue: null }],
    ['a missing input', { missingInputs: ['the linked issue could not be read'] }],
  ] as [string, Partial<BriefInputParts>][])('moves when %s moves', (_label, over) => {
    expect(briefStateOf(parts(over), chars).stateKey).not.toBe(
      briefStateOf(parts(), chars).stateKey,
    );
  });

  it('does NOT move when the same over-budget input is processed twice', () => {
    const input = parts({ body: filler(400) });
    const first = briefStateOf(input, chars);
    const second = briefStateOf(input, chars);

    expect(first.trimmed.length).toBeGreaterThan(0);
    expect(first.stateKey).toBe(second.stateKey);
  });
});

// ---- AC-10 · what the budget is counted over --------------------------------

describe('the budget is counted over system + user, together (AC-10)', () => {
  it('reports count(system + user), not count(system) + count(user)', () => {
    // `words` merges the last word of `system` with the first of `user`, so the
    // two arithmetics differ by exactly one and the test can say which ran.
    const input = parts();
    const assembled = assembleBriefInput(input);
    const system = 'a system message ending in a word';

    const joined = words(system + assembled.user);
    const summed = words(system) + words(assembled.user);
    expect(joined).toBe(summed - 1);

    const result = trimToBudget(system, input, words, 100_000);
    expect(result.inputTokens).toBe(joined);
    expect(result.inputTokens).not.toBe(summed);
  });

  it('trims a fixture whose USER half fits the budget and whose pair does not', () => {
    // The falsifying case for a ladder that counted only the user message: it
    // would find 1 500 ≤ 4 000, trim nothing, and pass every other check here.
    const system = 'x '.repeat(3_000).trim();
    const input = parts({ contextDocs: [{ title: 'Big', path_label: 'docs/big.md', body: 'w '.repeat(1_000) }] });

    const userOnly = words(assembleBriefInput(input).user);
    expect(userOnly).toBeLessThan(4_000);
    expect(words(system) + userOnly).toBeGreaterThan(4_000);

    const result = trimToBudget(system, input, words, 4_000);
    expect(result.trimmed.length).toBeGreaterThan(0);
    expect(result.overBudget).toBe(false);
    expect(result.inputTokens).toBeLessThanOrEqual(4_000);
  });

  it('leaves a fixture that already fits entirely alone', () => {
    const result = trimToBudget(BRIEF_SYSTEM_PROMPT, parts(), chars, BRIEF_INPUT_TOKEN_BUDGET);
    expect(result.trimmed).toEqual([]);
    expect(result.overBudget).toBe(false);
  });
});

// ---- AC-11 / AC-38 · the rungs, in their fixed order ------------------------

describe('the budget ladder walks its rungs in a fixed order (AC-11, AC-38)', () => {
  const wide = () =>
    parts({
      contextDocs: [
        { title: 'Auth rules', path_label: 'docs/auth.md', body: filler(30) },
        { title: 'API style', path_label: 'docs/api.md', body: filler(30) },
      ],
      files: Array.from({ length: BRIEF_TRIM_MAX_FILES + 8 }, (_, i) => ({
        path: `src/module-${String(i).padStart(2, '0')}.ts`,
        additions: 100 - i,
        deletions: i,
      })),
    });

  /** The budget at which each rung's note first appears, walking budgets downwards. */
  const thresholds = () => {
    const input = wide();
    const full = chars(BRIEF_SYSTEM_PROMPT + assembleBriefInput(input).user);
    const first: Record<string, number> = {};
    for (let budget = full; budget >= 0; budget -= 25) {
      for (const note of trimToBudget(BRIEF_SYSTEM_PROMPT, input, chars, budget).trimmed) {
        const category = note.slice(0, note.indexOf(':'));
        first[category] ??= budget;
      }
    }
    return first;
  };

  it('drops Project Context documents first of all', () => {
    const at = thresholds();
    expect(at['project-context']).toBeDefined();
    expect(at['project-context']).toBeGreaterThan(at['linked-issue'] ?? 0);
    expect(at['project-context']).toBeGreaterThan(at['blast-map'] ?? 0);
    expect(at['project-context']).toBeGreaterThan(at['changed-files'] ?? 0);
    expect(at['project-context']).toBeGreaterThan(at['minimal-input'] ?? 0);
  });

  it('then the issue body, then the blast map, then the file tail, then the minimum', () => {
    const at = thresholds();
    expect(at['linked-issue']).toBeGreaterThan(at['blast-map']!);
    expect(at['blast-map']).toBeGreaterThan(at['changed-files']!);
    expect(at['changed-files']).toBeGreaterThan(at['minimal-input']!);
  });

  it('drops whole context documents from the tail of the reader’s order', () => {
    const input = wide();
    const full = chars(BRIEF_SYSTEM_PROMPT + assembleBriefInput(input).user);
    const result = trimToBudget(BRIEF_SYSTEM_PROMPT, input, chars, full - 100);

    expect(result.trimmed).toEqual(['project-context: dropped 1 of 2 documents, from the end of the reader\'s order']);
    expect(result.user).toContain('docs/auth.md');
    expect(result.user).not.toContain('docs/api.md');
  });

  it('keeps the issue number and title when it drops the issue body', () => {
    const input = wide();
    // One character below what survives the whole first rung, so the ladder is
    // forced onto the second one and no further.
    const afterContext = assembleBriefInput({
      ...input,
      limits: { ...input.limits, contextDocs: 0 },
    });
    const budget = chars(BRIEF_SYSTEM_PROMPT + afterContext.user) - 1;
    const result = trimToBudget(BRIEF_SYSTEM_PROMPT, input, chars, budget);

    expect(result.trimmed).toContain('linked-issue: dropped the body of #471');
    expect(result.user).toContain('Order visibility leaks across customers');
    expect(result.user).not.toContain('Reported by support');
  });

  it('replaces the dropped file tail with a counted line, never a silent cut', () => {
    const input = wide();
    // One character below what survives every rung before this one, so the
    // ladder stops HERE rather than falling through to the minimal input.
    const beforeFiles = assembleBriefInput({
      ...input,
      limits: { ...input.limits, contextDocs: 0, issueBody: false, blastCallers: false, blastRows: 0 },
    });
    const budget = chars(BRIEF_SYSTEM_PROMPT + beforeFiles.user) - 1;
    const result = trimToBudget(BRIEF_SYSTEM_PROMPT, input, chars, budget);

    expect(result.overBudget).toBe(false);
    expect(result.trimmed).not.toContain(
      'minimal-input: dropped the description, the derived intent, the linked issue, the ' +
        'Project Context documents and the blast map',
    );
    expect(result.trimmed).toContain(
      `changed-files: listed the largest ${String(BRIEF_TRIM_MAX_FILES)} of ${String(BRIEF_TRIM_MAX_FILES + 8)}`,
    );
    expect(result.user).toContain('… 8 more files, smaller than these');
    expect(result.user).toContain('src/module-00.ts');
    expect(result.user).not.toContain('src/module-19.ts');
  });

  it('reports overBudget rather than sending a shorter prompt when even the minimum does not fit', () => {
    const result = trimToBudget(BRIEF_SYSTEM_PROMPT, wide(), chars, 200);
    expect(result.overBudget).toBe(true);
    expect(result.trimmed).toContain(
      'minimal-input: dropped the description, the derived intent, the linked issue, the ' +
        'Project Context documents and the blast map',
    );
  });

  it('recounts after every rung, so it stops at the first one that fits', () => {
    const input = wide();
    const full = chars(BRIEF_SYSTEM_PROMPT + assembleBriefInput(input).user);
    const result = trimToBudget(BRIEF_SYSTEM_PROMPT, input, chars, full - 100);

    // One rung, not the whole ladder: the loop returns as soon as it is under.
    expect(result.trimmed).toHaveLength(1);
  });
});

// ---- AC-09 · no hunk body ever reaches the model ----------------------------

describe('the assembled input carries file names and counts, never hunk bodies (AC-09)', () => {
  it('contains no character of a row’s diff text', () => {
    // The row shape the service reads from is wider than what the assembler
    // takes; the projection is what keeps the diff out, so the fixture carries
    // the wide row and the assertion is on the narrow string.
    const rows = [
      {
        path: 'src/authorization.ts',
        additions: 40,
        deletions: 12,
        diffText: '@@ -1,5 +1,9 @@\n-  return true;\n+  return order.customerId === caller.id;',
      },
    ];
    const { user } = assembleBriefInput(
      parts({ files: rows.map((r) => ({ path: r.path, additions: r.additions, deletions: r.deletions })) }),
    );

    expect(user).toContain('src/authorization.ts (+40/-12)');
    expect(user).not.toContain('@@');
    expect(user).not.toContain('order.customerId === caller.id');
  });
});

// ---- AC-21 · the untrusted wrap ---------------------------------------------

describe('every author-controlled block is wrapped exactly once (AC-21)', () => {
  it('opens one untrusted delimiter per block and closes each of them', () => {
    const { user } = assembleBriefInput(parts());
    const opens = user.match(/<untrusted source="/g) ?? [];
    const closes = user.match(/<\/untrusted>/g) ?? [];

    // pr-body, intent, issue:471, two context docs, blast-map, paths.
    expect(opens).toHaveLength(7);
    expect(closes).toHaveLength(7);
    for (const label of ['pr-body', 'intent', 'issue:471', 'context:docs/auth.md', 'blast-map', 'paths']) {
      expect(user.split(`<untrusted source="${label}">`)).toHaveLength(2);
    }
  });

  it('leaves OUR own missing-input notes unwrapped, so the model may act on them', () => {
    const { user } = assembleBriefInput(
      parts({ missingInputs: ['no intent has been derived for this pull request'] }),
    );
    const block = user.slice(user.indexOf('## Input that is missing'));
    expect(block).toContain('no intent has been derived');
    expect(block).not.toContain('<untrusted');
  });

  it('the system message carries the injection guard and the English rule', () => {
    expect(BRIEF_SYSTEM_PROMPT).toContain('<untrusted>…</untrusted>');
    expect(BRIEF_SYSTEM_PROMPT).toContain('never instructions');
    expect(BRIEF_SYSTEM_PROMPT).toContain('LANGUAGE.');
    expect(BRIEF_SYSTEM_PROMPT).toContain('in English');
    expect(BRIEF_SYSTEM_PROMPT).toContain('Never invent a path');
  });
});

// ---- AC-15 / AC-16 / AC-17 / AC-18 · grounding ------------------------------

describe('the grounding filter drops what the model invented, and only that', () => {
  const allow = () => buildAllowList(parts().files, blast());

  it('builds both halves from the pull request and the map (AC-15, AC-16)', () => {
    const a = allow();
    expect([...a.files].sort()).toEqual([
      'src/api/router.ts',
      'src/app.ts',
      'src/authorization.ts',
      'src/orders/service.ts',
    ]);
    expect([...a.endpoints].sort()).toEqual([
      'GET /orders',
      'GET /orders/:id',
      'POST /orders',
      'nightly-order-reconcile',
    ]);
  });

  it('a degraded map contributes nothing to either half (AC-23)', () => {
    const a = buildAllowList(parts().files, null);
    expect(a.endpoints.size).toBe(0);
    expect([...a.files].sort()).toEqual([
      'src/api/router.ts',
      'src/authorization.ts',
      'src/orders/service.ts',
    ]);
  });

  it('checks a file reference on the part before its first colon (AC-15)', () => {
    const { risks, dropped_refs } = groundRefs(
      {
        risks: [
          {
            kind: 'security',
            title: 'Order reads are not scoped',
            explanation: 'Every read must carry the caller.',
            severity: 'high',
            file_refs: ['src/authorization.ts:12', 'src/authorization.ts:12-30', 'src/invented.ts:4'],
          },
        ],
        review_focus: [],
      },
      allow(),
    );

    expect(risks[0]!.file_refs).toEqual(['src/authorization.ts:12', 'src/authorization.ts:12-30']);
    expect(dropped_refs).toEqual(['src/invented.ts:4']);
  });

  it('matches an endpoint whole, so a parameterised route survives (AC-16)', () => {
    const { review_focus, dropped_refs } = groundRefs(
      {
        risks: [],
        review_focus: [
          { kind: 'endpoint', ref: 'GET /orders/:id', line: null, why: 'the leaking read' },
          { kind: 'endpoint', ref: 'DELETE /orders', line: null, why: 'invented' },
          { kind: 'endpoint', ref: 'src/authorization.ts', line: null, why: 'wrong half' },
        ],
      },
      allow(),
    );

    expect(review_focus.map((f) => f.ref)).toEqual(['GET /orders/:id']);
    expect(dropped_refs).toEqual(['DELETE /orders', 'src/authorization.ts']);
  });

  it('keeps a valid reference and drops an invented one, with no reprompt (AC-17)', () => {
    const { risks, review_focus, dropped_refs } = groundRefs(
      {
        risks: [
          {
            kind: 'perf',
            title: 'An extra query per order',
            explanation: 'The scope check adds a lookup.',
            severity: 'medium',
            file_refs: ['src/orders/service.ts', 'src/nowhere.ts'],
          },
        ],
        review_focus: [
          { kind: 'file', ref: 'src/orders/service.ts', line: 42, why: 'the read path' },
        ],
      },
      allow(),
    );

    expect(risks[0]!.file_refs).toEqual(['src/orders/service.ts']);
    expect(review_focus).toHaveLength(1);
    expect(dropped_refs).toEqual(['src/nowhere.ts']);
  });

  it('drops a focus item entirely, and keeps a risk whose refs all went (AC-18)', () => {
    const { risks, review_focus, dropped_refs } = groundRefs(
      {
        risks: [
          {
            kind: 'db_migration',
            title: 'The migration is not reversible',
            explanation: 'It drops a column.',
            severity: 'high',
            file_refs: ['src/migrations/0001.sql', 'src/migrations/0002.sql'],
          },
        ],
        review_focus: [{ kind: 'file', ref: 'src/imaginary.ts', line: 3, why: 'start here' }],
      },
      allow(),
    );

    expect(risks).toHaveLength(1);
    expect(risks[0]!.explanation).toBe('It drops a column.');
    expect(risks[0]!.file_refs).toEqual([]);
    expect(review_focus).toEqual([]);
    expect(dropped_refs).toEqual([
      'src/migrations/0001.sql',
      'src/migrations/0002.sql',
      'src/imaginary.ts',
    ]);
  });
});

// ---- AC-19 · the kind normalisation -----------------------------------------

describe('an unrecognised risk kind becomes `other`, never a rejection (AC-19)', () => {
  it.each([
    ['security', 'security'],
    ['SECURITY', 'security'],
    ['db_migration', 'db_migration'],
    ['db migration', 'db_migration'],
    ['breaking-api', 'breaking_api'],
    ['perf', 'perf'],
    ['deps', 'deps'],
    ['other', 'other'],
    ['database', 'other'],
    ['', 'other'],
  ])('reads %s as %s', (given, expected) => {
    expect(normaliseKind(given)).toBe(expected);
  });

  it('normalises a whole reply without throwing any of it away', () => {
    const normalised = normaliseReply({
      what: 'Scopes order reads.',
      why: 'Customers could read each other’s orders.',
      risk_level: 'HIGH',
      risks: [
        {
          kind: 'authentication',
          title: 'A risk with an unknown kind',
          explanation: 'Still worth reading.',
          severity: 'catastrophic',
          file_refs: ['src/authorization.ts'],
        },
      ],
      review_focus: [
        { kind: 'FILE', ref: 'src/authorization.ts', line: 12.9, why: 'start here' },
        { kind: 'endpoint', ref: 'GET /orders', line: null, why: 'the leaking read' },
      ],
    });

    expect(normalised.risks[0]!.kind).toBe('other');
    expect(normalised.risks[0]!.severity).toBe('low');
    expect(normalised.risks[0]!.title).toBe('A risk with an unknown kind');
    expect(normalised.review_focus[0]!.kind).toBe('file');
    expect(normalised.review_focus[0]!.line).toBe(12);
    expect(normalised.review_focus[1]!.kind).toBe('endpoint');
    expect(normalised.review_focus[1]!.line).toBeNull();
  });

  it('an unreadable severity may not raise an alarm', () => {
    expect(normaliseSeverity('high')).toBe('high');
    expect(normaliseSeverity(' Medium ')).toBe('medium');
    expect(normaliseSeverity('critical')).toBe('low');
  });
});

// ---- AC-20 · the settled risk level -----------------------------------------

describe('risk_level is computed, and the model may only lower it (AC-20)', () => {
  const risks = (...severities: ('high' | 'medium' | 'low')[]) =>
    severities.map((severity, i) => ({ severity, title: `r${String(i)}` }));

  it('is the highest surviving severity when the model says nothing usable', () => {
    expect(settleRiskLevel(risks('low', 'high', 'medium'))).toBe('high');
    expect(settleRiskLevel(risks('low', 'medium'), 'catastrophic')).toBe('medium');
  });

  it('is `low` when no risk survived', () => {
    expect(settleRiskLevel([])).toBe('low');
    expect(settleRiskLevel([], 'high')).toBe('low');
  });

  it('accepts a suggestion BELOW the computed level', () => {
    expect(settleRiskLevel(risks('high'), 'medium')).toBe('medium');
  });

  it('accepts a suggestion EQUAL to the computed level', () => {
    expect(settleRiskLevel(risks('medium'), 'medium')).toBe('medium');
  });

  it('refuses a suggestion ABOVE the computed level', () => {
    expect(settleRiskLevel(risks('low'), 'high')).toBe('low');
    expect(settleRiskLevel([], 'high')).toBe('low');
  });
});

// ---- AC-28 · the timeline delta ---------------------------------------------

describe('the delta between two briefs is code, never a call (AC-28)', () => {
  const record = (over: Partial<PrBriefRecord>): Pick<PrBriefRecord, 'risk_level' | 'risks' | 'review_focus'> => ({
    risk_level: 'low',
    risks: [],
    review_focus: [],
    ...over,
  });

  it('reports the transition, the risks added and removed, and the focus refs', () => {
    const older = record({
      risk_level: 'medium',
      risks: [
        { kind: 'perf', title: 'An extra query', explanation: '', severity: 'medium', file_refs: [] },
        { kind: 'deps', title: 'A new dependency', explanation: '', severity: 'low', file_refs: [] },
      ],
      review_focus: [{ kind: 'file', ref: 'src/orders/service.ts', line: 42, why: '' }],
    });
    const newer = record({
      risk_level: 'high',
      risks: [
        { kind: 'perf', title: 'An extra query', explanation: '', severity: 'medium', file_refs: [] },
        { kind: 'security', title: 'Reads are unscoped', explanation: '', severity: 'high', file_refs: [] },
      ],
      review_focus: [{ kind: 'file', ref: 'src/authorization.ts', line: 12, why: '' }],
    });

    expect(briefDelta(newer, older)).toEqual({
      risk_level_from: 'medium',
      risk_level_to: 'high',
      risks_added: ['Reads are unscoped'],
      risks_removed: ['A new dependency'],
      focus_added: ['src/authorization.ts'],
      focus_removed: ['src/orders/service.ts'],
    });
  });

  it('reports no transition when the level did not move', () => {
    const same = record({ risk_level: 'medium' });
    expect(briefDelta(same, same)).toEqual({
      risk_level_from: null,
      risk_level_to: null,
      risks_added: [],
      risks_removed: [],
      focus_added: [],
      focus_removed: [],
    });
  });
});

// ---- The two transforms the service needs -----------------------------------

describe('the local linked-issue reader (a twin of the intent layer’s)', () => {
  it.each([
    ['Closes #471', 471],
    ['fixes #12 and nothing else', 12],
    ['Resolved devsiteua/dev-digest#8', 8],
  ])('reads %s as #%i', (body, expected) => {
    expect(extractLinkedIssue(body, 'devsiteua/dev-digest')).toBe(expected);
  });

  it.each([
    ['see #5 for context'],
    ['Closes other/repo#12'],
    [''],
  ])('finds nothing in %s', (body) => {
    expect(extractLinkedIssue(body, 'devsiteua/dev-digest')).toBeUndefined();
  });

  it('finds nothing when there is no body at all', () => {
    expect(extractLinkedIssue(null, 'devsiteua/dev-digest')).toBeUndefined();
    expect(extractLinkedIssue(undefined, 'devsiteua/dev-digest')).toBeUndefined();
  });
});

describe('the Why Timeline carries each entry’s delta against the one below it', () => {
  const record = (over: Partial<PrBriefRecord>): PrBriefRecord => ({
    pr_id: 'pr-1',
    what: 'Scopes order reads.',
    why: 'Customers could read each other’s orders.',
    risk_level: 'low',
    risks: [],
    review_focus: [],
    state_key: 'k',
    head_sha: 'sha',
    missing_inputs: [],
    dropped_refs: [],
    trimmed: [],
    input_tokens: 1,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    tokens_in: 1,
    tokens_out: 1,
    cost_usd: null,
    duration_ms: 1,
    generated_at: '2026-08-30T00:00:00.000Z',
    ...over,
  });

  it('leaves the OLDEST entry with no delta, because nothing sits behind it', () => {
    const entries = toBriefTimeline([
      { seq: 9, record: record({ state_key: 'newer', risk_level: 'high' }) },
      { seq: 4, record: record({ state_key: 'older', risk_level: 'low' }) },
    ]);

    expect(entries.map((e) => e.seq)).toEqual([9, 4]);
    expect(entries[0]!.delta).toEqual({
      risk_level_from: 'low',
      risk_level_to: 'high',
      risks_added: [],
      risks_removed: [],
      focus_added: [],
      focus_removed: [],
    });
    expect(entries[1]!.delta).toBeNull();
  });
});
