import { describe, it, expect } from 'vitest';
import {
  buildDownstream,
  decideBlastState,
  describeBlast,
  groupCallersBySymbol,
  isTestPath,
  orderSymbols,
  type BlastCallerInput,
  type BlastDependentInput,
  type BlastFacts,
} from '../src/modules/blast/helpers.js';

/**
 * L04 — the pure half of the Blast Radius: which files a fact may be read from,
 * how a symbol's downstream is assembled, and which of the six honest answers a
 * map is.
 *
 * Every rule here is a table, because none of it touches a database, a request
 * or a clock. What is NOT here is the caller cap, the caller sort and the
 * reverse walk itself: those belong to the index that answers the question and
 * are asserted in `repo-intel-blast.test.ts`, where the code they describe is.
 */

const caller = (over: Partial<BlastCallerInput> = {}): BlastCallerInput => ({
  file: 'src/api/router.ts',
  symbol: 'handler',
  viaSymbol: 'alpha',
  line: 10,
  ...over,
});

describe('a fact is read from production files only', () => {
  it.each([
    'tests/authorization.test.ts',
    'src/orders/order.spec.ts',
    'src/__tests__/router.ts',
    'src/__mocks__/db.ts',
    'test/helpers/pg.ts',
    'e2e/specs/flow.ts',
    'src/__fixtures__/orders.ts',
  ])('treats %s as a test', (path) => {
    expect(isTestPath(path)).toBe(true);
  });

  it.each([
    'src/api/admin-router.ts',
    'src/latest/index.ts',
    'src/contest/entries.ts',
    'src/protest.ts',
  ])('does not mistake %s for one', (path) => {
    // `src/latest/…` is the reason the directory patterns carry their slashes:
    // a bare `test/` also matches "la-test/".
    expect(isTestPath(path)).toBe(false);
  });

  it('drops a test file as a SOURCE of endpoints while keeping it as a caller', () => {
    const callers = [
      caller({ file: 'src/api/router.ts', symbol: 'handler', line: 12 }),
      caller({ file: 'tests/alpha.test.ts', symbol: 'alpha.test.ts', line: 4 }),
    ];
    const facts: Record<string, BlastFacts> = {
      'src/api/router.ts': { endpoints: ['GET /orders'], crons: [] },
      // A real case: the demo repository's own `tests/router.test.ts` registers
      // `POST /orders`, which exists nowhere in production code.
      'tests/alpha.test.ts': { endpoints: ['POST /orders'], crons: ['0 * * * *'] },
    };

    const [impact] = buildDownstream({
      symbols: [{ name: 'alpha', file: 'src/a.ts', kind: 'function' }],
      callersBySymbol: groupCallersBySymbol(callers),
      factsByFile: facts,
      dependentsBySymbol: new Map(),
    });

    expect(impact!.endpoints_affected).toEqual(['GET /orders']);
    expect(impact!.crons_affected).toEqual([]);
    // The call itself is real code calling real code, and stays.
    expect(impact!.callers.map((c) => c.file)).toContain('tests/alpha.test.ts');
  });
});

describe('the downstream is assembled per changed symbol', () => {
  const symbols = [
    { name: 'alpha', file: 'src/a.ts', kind: 'function' },
    { name: 'beta', file: 'src/a.ts', kind: 'function' },
    { name: 'gamma', file: 'src/a.ts', kind: 'function' },
  ];
  const callersBySymbol = groupCallersBySymbol([
    caller({ viaSymbol: 'alpha', file: 'src/api/router.ts', symbol: 'handler', line: 12 }),
    caller({ viaSymbol: 'beta', file: 'src/jobs/digest.ts', symbol: 'runDigest', line: 8 }),
  ]);
  const factsByFile: Record<string, BlastFacts> = {
    'src/api/router.ts': { endpoints: ['GET /orders'], crons: [] },
    'src/jobs/digest.ts': { endpoints: [], crons: ['0 * * * *'] },
  };
  const dependentsBySymbol = new Map<string, BlastDependentInput[]>([
    ['alpha', [{ file: 'src/server.ts', depth: 1, endpoints: ['GET /health'], crons: [] }]],
    ['beta', []],
  ]);

  it('gives each symbol only what ITS callers reach', () => {
    const downstream = buildDownstream({ symbols, callersBySymbol, factsByFile, dependentsBySymbol });
    const byName = Object.fromEntries(downstream.map((d) => [d.symbol, d]));
    expect(byName.alpha!.endpoints_affected).toEqual(['GET /health', 'GET /orders']);
    expect(byName.alpha!.crons_affected).toEqual([]);
    // `beta`'s cron must not leak onto `alpha` just because they share a file.
    expect(byName.beta!.endpoints_affected).toEqual([]);
    expect(byName.beta!.crons_affected).toEqual(['0 * * * *']);
  });

  it('unions the two levels — a level-2 endpoint is as downstream as a level-1 one', () => {
    const [alpha] = buildDownstream({ symbols, callersBySymbol, factsByFile, dependentsBySymbol });
    expect(alpha!.endpoints_affected).toContain('GET /orders'); // the caller file
    expect(alpha!.endpoints_affected).toContain('GET /health'); // one hop further
  });

  it('emits an entry for a symbol that reaches nothing, rather than omitting it', () => {
    const downstream = buildDownstream({ symbols, callersBySymbol, factsByFile, dependentsBySymbol });
    const gamma = downstream.find((d) => d.symbol === 'gamma');
    // Absence would be indistinguishable from "the traversal never got here".
    expect(gamma).toEqual({
      symbol: 'gamma',
      callers: [],
      endpoints_affected: [],
      crons_affected: [],
    });
  });

  it('orders the changed symbols by file then name, so two identical requests agree', () => {
    const shuffled = [
      { name: 'zeta', file: 'src/b.ts', kind: 'function' },
      { name: 'beta', file: 'src/a.ts', kind: 'function' },
      { name: 'alpha', file: 'src/a.ts', kind: 'function' },
    ];
    expect(orderSymbols(shuffled).map((s) => `${s.file}:${s.name}`)).toEqual([
      'src/a.ts:alpha',
      'src/a.ts:beta',
      'src/b.ts:zeta',
    ]);
  });
});

describe('the status/reason decision table — one case per row', () => {
  const base = {
    repoIntelEnabled: true,
    indexStatus: 'full' as const,
    changedFileCount: 1,
    indexAnswered: true,
    symbolCount: 2,
    callerCount: 3,
  };

  it('degraded / repo_intel_disabled — the feature is switched off', () => {
    expect(decideBlastState({ ...base, repoIntelEnabled: false })).toEqual({
      status: 'degraded',
      reason: 'repo_intel_disabled',
    });
  });

  it('degraded / index_failed — the last index run failed', () => {
    expect(decideBlastState({ ...base, indexStatus: 'failed', indexAnswered: false })).toEqual({
      status: 'degraded',
      reason: 'index_failed',
    });
  });

  it('degraded / index_missing — there is no usable index row', () => {
    expect(decideBlastState({ ...base, indexStatus: 'degraded', indexAnswered: false })).toEqual({
      status: 'degraded',
      reason: 'index_missing',
    });
  });

  it('degraded / index_missing — the row says full but the tables cannot answer', () => {
    expect(decideBlastState({ ...base, indexAnswered: false })).toEqual({
      status: 'degraded',
      reason: 'index_missing',
    });
  });

  it('partial / index_partial — the map is real but incomplete', () => {
    expect(decideBlastState({ ...base, indexStatus: 'partial' })).toEqual({
      status: 'partial',
      reason: 'index_partial',
    });
  });

  it('ok / no_changed_files — the PR has no recorded files', () => {
    expect(decideBlastState({ ...base, changedFileCount: 0, indexAnswered: false, symbolCount: 0, callerCount: 0 })).toEqual({
      status: 'ok',
      reason: 'no_changed_files',
    });
  });

  it('ok / no_indexed_symbols — files, but nothing in them is indexed', () => {
    expect(decideBlastState({ ...base, symbolCount: 0, callerCount: 0 })).toEqual({
      status: 'ok',
      reason: 'no_indexed_symbols',
    });
  });

  it('ok / no_callers — symbols, and nothing calls them', () => {
    expect(decideBlastState({ ...base, callerCount: 0 })).toEqual({
      status: 'ok',
      reason: 'no_callers',
    });
  });

  it('ok / null — a populated map', () => {
    expect(decideBlastState(base)).toEqual({ status: 'ok', reason: null });
  });

  it('reports the index before it reports the pull request', () => {
    // Both true at once: a failed index and a PR with no files. The index wins,
    // because its health is the precondition for every other statement.
    expect(decideBlastState({ ...base, indexStatus: 'failed', changedFileCount: 0, indexAnswered: false }).reason).toBe(
      'index_failed',
    );
  });
});

describe('the summary never lets an empty map read as "nothing is affected"', () => {
  const state = (reason: Parameters<typeof describeBlast>[0]['state']) => reason;

  it.each([
    ['repo_intel_disabled', 'degraded'],
    ['index_failed', 'degraded'],
    ['index_missing', 'degraded'],
  ] as const)('says nothing was analysed for %s', (reason, status) => {
    const text = describeBlast({
      state: state({ status, reason }),
      indexedSha: null,
      changedFileCount: 1,
      symbolCount: 0,
      callerCount: 0,
      endpointCount: 0,
      cronCount: 0,
    });
    expect(text).toContain('nothing was analysed');
    expect(text).toContain('not a claim that the pull request affects nothing');
  });

  it('names the sha it looked at when no symbol was indexed', () => {
    const text = describeBlast({
      state: { status: 'ok', reason: 'no_indexed_symbols' },
      indexedSha: '13d9abb35ff2c4c29f061c5ae9910fda5a2878ff',
      changedFileCount: 1,
      symbolCount: 0,
      callerCount: 0,
      endpointCount: 0,
      cronCount: 0,
    });
    expect(text).toContain('1 changed file');
    expect(text).toContain('13d9abb');
  });

  it('counts what it found when the map is populated', () => {
    const text = describeBlast({
      state: { status: 'ok', reason: null },
      indexedSha: '13d9abb35ff2c4c29f061c5ae9910fda5a2878ff',
      changedFileCount: 1,
      symbolCount: 2,
      callerCount: 7,
      endpointCount: 4,
      cronCount: 1,
    });
    expect(text).toBe('2 symbols changed → 7 callers, 4 endpoints, 1 cron/job, as indexed at 13d9abb.');
  });

  it('says the map may be missing callers when the index is partial', () => {
    const text = describeBlast({
      state: { status: 'partial', reason: 'index_partial' },
      indexedSha: 'abcdef1234',
      changedFileCount: 1,
      symbolCount: 1,
      callerCount: 1,
      endpointCount: 0,
      cronCount: 0,
    });
    expect(text).toContain('incomplete');
    expect(text).toContain('some callers may be missing');
  });
});
