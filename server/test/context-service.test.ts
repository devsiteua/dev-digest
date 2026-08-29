import { describe, it, expect } from 'vitest';
import {
  ProjectContextService,
  type ProjectContextStore,
} from '../src/modules/context/service.js';
import {
  ALLOWED_EXTENSIONS,
  MAX_DOCS_PER_REPO,
  MAX_DOC_BYTES,
} from '../src/modules/context/constants.js';
import { AppError } from '../src/platform/errors.js';
import type {
  ProjectContextDocRow,
  ProjectContextDocSummary,
} from '../src/modules/context/repository.js';

/**
 * Unit coverage for the project-context service against a stubbed store.
 *
 * The invariant these tests defend: a rejected upload writes NOTHING. Each of
 * the four rejections asserts its status AND that `insert` was never reached —
 * the integration lane repeats the same claim as `SELECT count(*)`, but the
 * status codes themselves can only be pinned here, because a Zod route schema
 * would flatten all four into 422.
 */

const WS = 'ws-1';
const REPO = 'repo-1';

interface StubState {
  inserts: Parameters<ProjectContextStore['insert']>[0][];
  orderWrites: string[][];
  count: number;
  next: number;
  repoExists: boolean;
}

const row = (over: Partial<ProjectContextDocRow> = {}): ProjectContextDocRow => ({
  id: 'doc-1',
  workspaceId: WS,
  repoId: REPO,
  title: 'PRD',
  pathLabel: 'prd.md',
  body: 'the body',
  enabled: true,
  order: 0,
  sizeBytes: 8,
  updatedAt: new Date('2026-08-29T10:00:00.000Z'),
  ...over,
});

function makeStore(over: Partial<StubState> = {}) {
  const state: StubState = {
    inserts: [],
    orderWrites: [],
    count: 0,
    next: 0,
    repoExists: true,
    ...over,
  };

  const store: ProjectContextStore = {
    async getRepo(_ws, repoId) {
      return state.repoExists ? { id: repoId, fullName: 'acme/app' } : undefined;
    },
    async listByRepo(): Promise<ProjectContextDocSummary[]> {
      return state.inserts.map((v, i) =>
        row({ id: `doc-${i}`, title: v.title, pathLabel: v.pathLabel, order: v.order }),
      );
    },
    async listEnabledByRepo(): Promise<ProjectContextDocRow[]> {
      return [];
    },
    async get() {
      return undefined;
    },
    async countByRepo() {
      return state.count;
    },
    async nextOrder() {
      return state.next;
    },
    async insert(values) {
      state.inserts.push(values);
      return row({ ...values, id: `doc-${state.inserts.length}` });
    },
    async update() {
      return undefined;
    },
    async remove() {
      return false;
    },
    async setOrder(_ws, _repoId, ids) {
      state.orderWrites.push(ids);
    },
  };

  return { store, state, service: new ProjectContextService(store) };
}

/** Assert an AppError with a given status, and that nothing was written. */
async function expectRejection(
  promise: Promise<unknown>,
  status: number,
  state: StubState,
): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  expect(appError.statusCode).toBe(status);
  expect(state.inserts).toHaveLength(0);
  return appError;
}

describe('ProjectContextService.upload — the four rejections', () => {
  it('rejects an extension that is not .md or .txt with 400, naming the allowed ones', async () => {
    const { service, state } = makeStore();
    const error = await expectRejection(
      service.upload(WS, REPO, { filename: 'design.pdf', content: 'hello' }),
      400,
      state,
    );
    for (const ext of ALLOWED_EXTENSIONS) expect(error.message).toContain(ext);
  });

  it('rejects a file with no extension at all', async () => {
    const { service, state } = makeStore();
    await expectRejection(
      service.upload(WS, REPO, { filename: 'README', content: 'hello' }),
      400,
      state,
    );
  });

  it('rejects a body over the byte ceiling with 413, naming the limit', async () => {
    const { service, state } = makeStore();
    const error = await expectRejection(
      service.upload(WS, REPO, { filename: 'big.md', content: 'a'.repeat(MAX_DOC_BYTES + 1) }),
      413,
      state,
    );
    expect(error.message).toContain(String(MAX_DOC_BYTES));
  });

  it('measures the ceiling in UTF-8 bytes, not UTF-16 units', async () => {
    // 'ї' is two bytes. Half the ceiling in characters is exactly the ceiling
    // in bytes — under a `String.length` check this would have been accepted.
    const { service, state } = makeStore();
    await expectRejection(
      service.upload(WS, REPO, {
        filename: 'utf8.md',
        content: 'ї'.repeat(MAX_DOC_BYTES / 2 + 1),
      }),
      413,
      state,
    );
  });

  it('rejects a whitespace-only body with 400', async () => {
    const { service, state } = makeStore();
    await expectRejection(
      service.upload(WS, REPO, { filename: 'blank.md', content: '   \n\t  \n' }),
      400,
      state,
    );
  });

  it('rejects the 51st document with 409, naming the ceiling', async () => {
    const { service, state } = makeStore({ count: MAX_DOCS_PER_REPO });
    const error = await expectRejection(
      service.upload(WS, REPO, { filename: 'one-too-many.md', content: 'hello' }),
      409,
      state,
    );
    expect(error.message).toContain(String(MAX_DOCS_PER_REPO));
  });

  it('404s for a repo outside the workspace before it looks at the file', async () => {
    const { service, state } = makeStore({ repoExists: false });
    await expectRejection(
      service.upload(WS, REPO, { filename: 'prd.md', content: 'hello' }),
      404,
      state,
    );
  });
});

describe('ProjectContextService.upload — what a valid upload creates', () => {
  it('creates enabled, one past the tail of order', async () => {
    const { service, state } = makeStore({ count: 3, next: 7 });
    const doc = await service.upload(WS, REPO, { filename: 'adr.md', content: 'Redis is the singleton' });

    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.order).toBe(7);
    expect(doc.order).toBe(7);
    expect(doc.enabled).toBe(true);
  });

  it('gives the first document of a repo order 0', async () => {
    const { service, state } = makeStore({ count: 0, next: 0 });
    await service.upload(WS, REPO, { filename: 'prd.md', content: 'hello' });
    expect(state.inserts[0]?.order).toBe(0);
  });

  it('keeps the filename as the path label and falls back to it for the title', async () => {
    const { service, state } = makeStore();
    const doc = await service.upload(WS, REPO, { filename: 'docs/prd.md', content: 'hello' });

    expect(state.inserts[0]?.pathLabel).toBe('docs/prd.md');
    expect(doc.path_label).toBe('docs/prd.md');
    expect(doc.title).toBe('docs/prd.md');
  });

  it('prefers an explicit title, trimmed, over the filename', async () => {
    const { service } = makeStore();
    const doc = await service.upload(WS, REPO, {
      filename: 'prd.md',
      content: 'hello',
      title: '  Product requirements  ',
    });
    expect(doc.title).toBe('Product requirements');
  });

  it('records the size in bytes, not characters', async () => {
    const { service, state } = makeStore();
    await service.upload(WS, REPO, { filename: 'utf8.md', content: 'їжак' });
    expect(state.inserts[0]?.sizeBytes).toBe(8);
  });

  it('accepts .txt as readily as .md', async () => {
    const { service, state } = makeStore();
    await service.upload(WS, REPO, { filename: 'STYLE.TXT', content: 'tabs, not spaces' });
    expect(state.inserts).toHaveLength(1);
  });
});

describe('ProjectContextService.list and reorder', () => {
  it('omits the body from the list projection', async () => {
    const { service } = makeStore();
    await service.upload(WS, REPO, { filename: 'prd.md', content: 'a private document' });
    const [listed] = await service.list(WS, REPO);
    expect(listed).toBeDefined();
    expect(listed && 'body' in listed).toBe(false);
  });

  it('writes the ids the caller sent, in the order it sent them', async () => {
    const { service, state } = makeStore();
    await service.reorder(WS, REPO, ['c', 'a', 'b']);
    expect(state.orderWrites).toEqual([['c', 'a', 'b']]);
  });

  it('404s a reorder against a repo outside the workspace, writing nothing', async () => {
    const { service, state } = makeStore({ repoExists: false });
    await expect(service.reorder(WS, REPO, ['a'])).rejects.toMatchObject({ statusCode: 404 });
    expect(state.orderWrites).toHaveLength(0);
  });
});
