import { describe, it, expect } from 'vitest';
import { RepoIntelService, capPerSymbol } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * L04 — the two facade methods `GET /pulls/:id/blast` is built on, driven
 * without a database.
 *
 * The container's `codeIndex` throws on EVERY method here, and that is the
 * point of the file rather than a convenience: `getBlastRadius` answers the same
 * question by shelling out to ripgrep over the clone, and the blast route exists
 * on the promise that no request rebuilds the AST or the import graph. A stub
 * that returned `[]` would let that path run and pass; one that throws makes
 * "the ripgrep path is unreachable" an assertion.
 *
 * `repo` is patched the way `repo-intel-facade-degraded.test.ts` patches it —
 * the service builds its own `RepoIntelRepository` from `container.db`, so the
 * seam is the field, not the constructor.
 */

type RepoStub = Record<string, (...args: never[]) => unknown>;

const EXPLODING_CODE_INDEX = {
  symbols: () => {
    throw new Error('codeIndex.symbols must never be reached from the index-only path');
  },
  references: () => {
    throw new Error('codeIndex.references must never be reached from the index-only path');
  },
};

function buildService(opts: { flag?: boolean; repo?: RepoStub } = {}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: opts.flag ?? true },
    db: {} as never,
    codeIndex: EXPLODING_CODE_INDEX as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: RepoStub }).repo = {
    tryGetIndexState: async () => null,
    getSymbolRows: async () => [],
    getResolvedCallers: async () => [],
    getFileFacts: async () => [],
    getReverseEdges: async () => [],
    ...(opts.repo ?? {}),
  };
  return svc;
}

/** A `repo_index_state` row with only the fields these paths read. */
function indexState(status: IndexState['status']): IndexState {
  return {
    repoId: 'r1',
    status,
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'abc123',
    indexerVersion: 2,
    updatedAt: new Date(0),
  };
}

describe('getBlastRadiusFromIndex — null is an answer, and the clone is never read', () => {
  it('returns null when the repo has no index row at all', async () => {
    const svc = buildService({ repo: { tryGetIndexState: async () => null } });
    await expect(svc.getBlastRadiusFromIndex('r1', ['src/a.ts'])).resolves.toBeNull();
  });

  it("returns null when the last index run failed", async () => {
    const svc = buildService({ repo: { tryGetIndexState: async () => indexState('failed') } });
    await expect(svc.getBlastRadiusFromIndex('r1', ['src/a.ts'])).resolves.toBeNull();
  });

  it('returns null when the repo-intel flag is off, without asking the database', async () => {
    let asked = 0;
    const svc = buildService({
      flag: false,
      repo: {
        tryGetIndexState: async () => {
          asked += 1;
          return indexState('full');
        },
      },
    });
    await expect(svc.getBlastRadiusFromIndex('r1', ['src/a.ts'])).resolves.toBeNull();
    expect(asked, 'the flag is checked before any read').toBe(0);
  });

  it('returns null for a pull request with no changed files', async () => {
    const svc = buildService({ repo: { tryGetIndexState: async () => indexState('full') } });
    await expect(svc.getBlastRadiusFromIndex('r1', [])).resolves.toBeNull();
  });

  it('answers from a partial index rather than refusing — the map is real, just incomplete', async () => {
    const svc = buildService({
      repo: {
        tryGetIndexState: async () => indexState('partial'),
        getSymbolRows: async (_repoId: string, paths: string[]) =>
          paths.includes('src/a.ts')
            ? [{ path: 'src/a.ts', name: 'alpha', kind: 'function', line: 1, endLine: 4, exported: true, signature: null }]
            : [],
      },
    });
    const result = await svc.getBlastRadiusFromIndex('r1', ['src/a.ts']);
    expect(result?.changedSymbols).toEqual([{ file: 'src/a.ts', name: 'alpha', kind: 'function' }]);
  });
});

describe('the caller cap is per changed symbol', () => {
  it('keeps 20 callers for each symbol, not 20 across all of them', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      fromPath: `src/callers/c${String(i).padStart(2, '0')}.ts`,
      toSymbol: 'alpha',
      line: 1,
      rank: 1 - i / 100,
    }));
    const few = [
      { fromPath: 'src/other/x.ts', toSymbol: 'beta', line: 2, rank: 0.4 },
      { fromPath: 'src/other/y.ts', toSymbol: 'beta', line: 3, rank: 0.3 },
    ];
    const svc = buildService({
      repo: {
        tryGetIndexState: async () => indexState('full'),
        getSymbolRows: async (_repoId: string, paths: string[]) =>
          paths.includes('src/a.ts')
            ? [
                { path: 'src/a.ts', name: 'alpha', kind: 'function', line: 1, endLine: 4, exported: true, signature: null },
                { path: 'src/a.ts', name: 'beta', kind: 'function', line: 6, endLine: 9, exported: true, signature: null },
              ]
            : [],
        getResolvedCallers: async () => [...many, ...few],
      },
    });

    const result = await svc.getBlastRadiusFromIndex('r1', ['src/a.ts']);
    const byVia = (name: string) => result!.callers.filter((c) => c.viaSymbol === name);
    expect(byVia('alpha')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    // The whole point: `beta`'s callers are not consumed by `alpha`'s fan-out.
    expect(byVia('beta')).toHaveLength(2);
  });

  it('drops the lowest-ranked callers of a busy symbol, never the first arrivals', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      file: `f${i}.ts`,
      symbol: `s${i}`,
      viaSymbol: 'alpha',
      line: 1,
      rank: 1 - i,
    }));
    expect(capPerSymbol(rows, 2).map((r) => r.file)).toEqual(['f0.ts', 'f1.ts']);
  });
});

describe('the caller sort is total — rank DESC, file ASC, line ASC', () => {
  it('breaks a rank tie by file and then by line', async () => {
    const svc = buildService({
      repo: {
        tryGetIndexState: async () => indexState('full'),
        getSymbolRows: async (_repoId: string, paths: string[]) => {
          if (paths.includes('src/a.ts')) {
            return [{ path: 'src/a.ts', name: 'alpha', kind: 'function', line: 1, endLine: 4, exported: true, signature: null }];
          }
          // Two enclosing functions in `src/m.ts`, so its two references survive
          // the `file|enclosing|symbol` de-duplication and the line tie-break
          // has something to order.
          return [
            { path: 'src/m.ts', name: 'one', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
            { path: 'src/m.ts', name: 'two', kind: 'function', line: 8, endLine: 12, exported: true, signature: null },
            { path: 'src/z.ts', name: 'zed', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
            { path: 'src/hot.ts', name: 'hot', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
          ];
        },
        getResolvedCallers: async () => [
          { fromPath: 'src/z.ts', toSymbol: 'alpha', line: 3, rank: 0.5 },
          { fromPath: 'src/m.ts', toSymbol: 'alpha', line: 9, rank: 0.5 },
          { fromPath: 'src/m.ts', toSymbol: 'alpha', line: 2, rank: 0.5 },
          { fromPath: 'src/hot.ts', toSymbol: 'alpha', line: 1, rank: 0.9 },
        ],
      },
    });

    const result = await svc.getBlastRadiusFromIndex('r1', ['src/a.ts']);
    expect(result!.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/hot.ts:1',
      'src/m.ts:2',
      'src/m.ts:9',
      'src/z.ts:3',
    ]);
  });
});

describe('getDependents — the reverse walk, level by level', () => {
  /** b,c import a; d imports b; e imports c; a imports d (a cycle back to the seed). */
  const EDGES: Record<string, string[]> = {
    'src/a.ts': ['src/b.ts', 'src/c.ts'],
    'src/b.ts': ['src/d.ts', 'src/c.ts'],
    'src/c.ts': ['src/e.ts'],
    'src/d.ts': ['src/a.ts'],
  };

  function graphService(flag = true): RepoIntelService {
    return buildService({
      flag,
      repo: {
        getReverseEdges: async (_repoId: string, toFiles: string[]) =>
          toFiles.flatMap((to) => (EDGES[to] ?? []).map((from) => ({ fromFile: from, toFile: to }))),
        getFileFacts: async (_repoId: string, files: string[]) =>
          files
            .filter((f) => f === 'src/e.ts')
            .map((f) => ({ filePath: f, endpoints: ['GET /deep'], crons: [] })),
      },
    });
  }

  it('assigns depth 1 to direct importers and depth 2 to theirs', async () => {
    const rows = await graphService().getDependents('r1', ['src/a.ts'], 2);
    expect(rows.map((r) => `${r.file}@${r.depth}`)).toEqual([
      'src/b.ts@1',
      'src/c.ts@1',
      'src/d.ts@2',
      'src/e.ts@2',
    ]);
  });

  it('stops at the first level when asked for one hop', async () => {
    const rows = await graphService().getDependents('r1', ['src/a.ts'], 1);
    expect(rows.map((r) => r.file)).toEqual(['src/b.ts', 'src/c.ts']);
  });

  it('never returns a seed as its own dependent, even through a cycle', async () => {
    const rows = await graphService().getDependents('r1', ['src/a.ts'], 2);
    expect(rows.map((r) => r.file)).not.toContain('src/a.ts');
  });

  it('keeps a file at the shallowest depth it was reached by', async () => {
    // `src/c.ts` is reachable at 1 (from a) and at 2 (from b). It is a direct
    // dependent, and reporting it as the deeper one would understate that.
    const rows = await graphService().getDependents('r1', ['src/a.ts'], 2);
    expect(rows.filter((r) => r.file === 'src/c.ts')).toEqual([
      { file: 'src/c.ts', depth: 1, endpoints: [], crons: [] },
    ]);
  });

  it("attaches each dependent's precomputed facts and nothing else", async () => {
    const rows = await graphService().getDependents('r1', ['src/a.ts'], 2);
    expect(rows.find((r) => r.file === 'src/e.ts')?.endpoints).toEqual(['GET /deep']);
    expect(rows.find((r) => r.file === 'src/b.ts')?.endpoints).toEqual([]);
  });

  it('returns [] for no seeds, for a zero depth, and with the flag off', async () => {
    await expect(graphService().getDependents('r1', [], 2)).resolves.toEqual([]);
    await expect(graphService().getDependents('r1', ['src/a.ts'], 0)).resolves.toEqual([]);
    await expect(graphService(false).getDependents('r1', ['src/a.ts'], 2)).resolves.toEqual([]);
  });
});
