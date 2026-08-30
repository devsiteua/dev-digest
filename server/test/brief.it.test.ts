/**
 * L05 — the PR Brief end to end, against real Postgres.
 *
 * Four things can only be proven here. The COST: that `GET` never reaches a
 * model, checked the only honest way — by serving it with providers that throw
 * on every verb — and that `POST` reaches one exactly once. The KEY: that a
 * brief written through the trim ladder reads back fresh, which is the one case
 * the demo pull request can never exercise because nine files fit inside
 * `BRIEF_TRIM_MAX_FILES`. The BUDGET: that what the provider actually received
 * counts under 8 000 tokens with the container's own tokenizer, over the
 * concatenation of both messages rather than the user half. And the MODEL: which
 * one gets bought when Settings names one, and when it does not.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import type { LLMProvider } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import {
  BRIEF_INPUT_TOKEN_BUDGET,
  BRIEF_MAX_HISTORY,
  BRIEF_MODEL,
} from '../src/modules/brief/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A provider that fails on every verb — the shape `blast.it.test.ts` uses. */
function throwingLLM(id: LLMProvider['id']): LLMProvider {
  const boom = (): never => {
    throw new Error(`the brief must not call a model (${id})`);
  };
  return { id, listModels: boom, complete: boom, completeStructured: boom, embed: boom };
}

const CHANGED = [
  { path: 'src/authorization.ts', additions: 40, deletions: 12 },
  { path: 'src/orders/service.ts', additions: 8, deletions: 3 },
];

/** A reply that cites only real files — the everyday case. */
const BRIEF_FIXTURE = {
  what: 'Scopes every order read to the requesting customer.',
  why: 'Support reported that any customer could read any order by id.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'security',
      title: 'Order reads were unscoped',
      explanation: 'Every read path must now carry the caller.',
      severity: 'medium',
      file_refs: ['src/authorization.ts:12'],
    },
  ],
  review_focus: [
    { kind: 'file', ref: 'src/authorization.ts', line: 12, why: 'the new scope check' },
  ],
};

/** The same reply, plus one path that exists nowhere in the pull request. */
const INVENTED_PATH_FIXTURE = {
  ...BRIEF_FIXTURE,
  risks: [
    {
      ...BRIEF_FIXTURE.risks[0]!,
      file_refs: ['src/authorization.ts:12', 'src/invented/module.ts:4'],
    },
  ],
  review_focus: [
    ...BRIEF_FIXTURE.review_focus,
    { kind: 'file', ref: 'src/nowhere.ts', line: 1, why: 'invented' },
  ],
};

d('L05 PR brief (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let userId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    userId = seeded.userId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeRepo(): Promise<string> {
    const name = `brief-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        defaultBranch: 'main',
        createdBy: userId,
      })
      .returning();
    return repo!.id;
  }

  async function makePr(
    repoId: string,
    opts: {
      title?: string;
      body?: string | null;
      headSha?: string;
      files?: { path: string; additions: number; deletions: number }[];
    } = {},
  ): Promise<string> {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 500 + seq++,
        title: opts.title ?? 'Scope order visibility to the requesting customer',
        author: 'marisa.koch',
        branch: 'feat/order-authorization',
        base: 'main',
        headSha: opts.headSha ?? 'head-1',
        body: opts.body ?? null,
      })
      .returning();
    for (const file of opts.files ?? CHANGED) {
      await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, ...file });
    }
    return pr!.id;
  }

  /** A repo and a pull request on it, which is what almost every case wants. */
  async function makeRepoPr(
    opts: Parameters<typeof makePr>[1] = {},
  ): Promise<{ repoId: string; prId: string }> {
    const repoId = await makeRepo();
    return { repoId, prId: await makePr(repoId, opts) };
  }

  async function addDoc(
    repoId: string,
    opts: { title: string; body: string; order: number; enabled?: boolean },
  ): Promise<string> {
    const [doc] = await pg.handle.db
      .insert(t.projectContextDocs)
      .values({
        workspaceId,
        repoId,
        title: opts.title,
        pathLabel: `${opts.title.toLowerCase().replace(/\s+/g, '-')}.md`,
        body: opts.body,
        enabled: opts.enabled ?? true,
        order: opts.order,
        sizeBytes: opts.body.length,
      })
      .returning();
    return doc!.id;
  }

  function makeApp(
    opts: {
      llm?: LLMProvider;
      openai?: LLMProvider;
      openrouter?: LLMProvider;
      intent?: { get: () => Promise<undefined>; derive: () => never; forReview: () => never };
      nodeEnv?: 'test' | 'production';
    } = {},
  ) {
    const fallback = opts.llm ?? new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    return buildApp({
      config: { ...config(), nodeEnv: opts.nodeEnv ?? 'test' },
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ files: {} }),
        github: new MockGitHubClient(),
        llm: {
          openai: opts.openai ?? fallback,
          anthropic: fallback,
          openrouter: opts.openrouter ?? fallback,
        },
        ...(opts.intent
          ? { intent: opts.intent as unknown as NonNullable<Parameters<typeof buildApp>[0]['overrides']>['intent'] }
          : {}),
      },
    });
  }

  type App = Awaited<ReturnType<typeof makeApp>>;
  const get = (app: App, prId: string) => app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
  const post = (app: App, prId: string) =>
    app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });

  const structuredCalls = (llm: MockLLMProvider) =>
    llm.calls.filter((c) => c.method === 'completeStructured');

  /** The exact string the provider was handed: both messages, joined as they are sent. */
  const sentInput = (llm: MockLLMProvider): string => {
    const req = structuredCalls(llm)[0]!.req as { messages: { role: string; content: string }[] };
    return req.messages.map((m) => m.content).join('');
  };

  const briefRows = async (prId: string) => {
    const [row] = await pg.handle.db
      .select({ n: count() })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    return row!.n;
  };

  // ---- The two costs -------------------------------------------------------

  it('makes exactly one model call on POST, and returns the five fields (AC-01)', async () => {
    const llm = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const app = await makeApp({ llm });
    const { prId } = await makeRepoPr();

    const res = await post(app, prId);
    expect(res.statusCode).toBe(200);
    expect(structuredCalls(llm)).toHaveLength(1);

    const brief = res.json();
    expect(brief.what).toBe(BRIEF_FIXTURE.what);
    expect(brief.why).toBe(BRIEF_FIXTURE.why);
    expect(brief.risk_level).toBe('medium');
    expect(brief.risks).toHaveLength(1);
    expect(brief.review_focus).toHaveLength(1);
    await app.close();
  });

  it('makes zero model calls on GET, three times over, against a throwing provider (AC-02, AC-07)', async () => {
    const llm = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const writer = await makeApp({ llm });
    const { prId } = await makeRepoPr();
    expect((await post(writer, prId)).statusCode).toBe(200);
    await writer.close();

    const reader = await makeApp({
      llm: throwingLLM('openai'),
      openai: throwingLLM('openai'),
      openrouter: throwingLLM('openrouter'),
    });
    for (let i = 0; i < 3; i++) {
      const res = await get(reader, prId);
      expect(res.statusCode).toBe(200);
      expect(res.json().what).toBe(BRIEF_FIXTURE.what);
    }
    await reader.close();
  });

  it('answers 404 only for "never generated", and 200 forever after one POST (AC-03)', async () => {
    const app = await makeApp();
    const { prId } = await makeRepoPr();

    const before = await get(app, prId);
    expect(before.statusCode).toBe(404);
    expect(before.json().error.code).toBe('not_found');

    expect((await post(app, prId)).statusCode).toBe(200);
    expect((await get(app, prId)).statusCode).toBe(200);
    expect((await get(app, prId)).statusCode).toBe(200);
    await app.close();
  });

  // ---- Staleness -----------------------------------------------------------

  it('reads back fresh, and turns stale when an input moves — with no new call (AC-04)', async () => {
    const llm = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const app = await makeApp({ llm });
    const { prId } = await makeRepoPr({ body: 'The original description.' });

    await post(app, prId);
    expect((await get(app, prId)).json().stale).toBe(false);
    expect(structuredCalls(llm)).toHaveLength(1);

    await pg.handle.db
      .update(t.pullRequests)
      .set({ body: 'A rewritten description.' })
      .where(eq(t.pullRequests.id, prId));

    expect((await get(app, prId)).json().stale).toBe(true);
    // The whole point: recomputing the key cost queries, and not one token.
    expect(structuredCalls(llm)).toHaveLength(1);
    await app.close();
  });

  it('reads back FRESH a brief whose input fired a trim rung (AC-04, AC-05)', async () => {
    // The regression test for the defect the cross-model review found: `read`
    // and `generate` must hash the same string, and they only do because both
    // go through `briefStateOf`. A `read` that skipped the ladder would hash a
    // longer string here and this brief would be stale the moment it was written.
    const llm = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const app = await makeApp({ llm });
    const { repoId, prId } = await makeRepoPr();
    await addDoc(repoId, { title: 'Architecture', body: 'a '.repeat(12_000), order: 1 });
    await addDoc(repoId, { title: 'Style guide', body: 'b '.repeat(12_000), order: 2 });

    const created = await post(app, prId);
    expect(created.statusCode).toBe(200);
    expect(created.json().trimmed.length).toBeGreaterThan(0);

    const read = await get(app, prId);
    expect(read.json().stale).toBe(false);
    expect(read.json().trimmed).toEqual(created.json().trimmed);
    await app.close();
  });

  it('upserts the same row when nothing changed (AC-08)', async () => {
    const app = await makeApp();
    const { prId } = await makeRepoPr();

    await post(app, prId);
    await post(app, prId);

    expect(await briefRows(prId)).toBe(1);
    await app.close();
  });

  // ---- The budget ----------------------------------------------------------

  it('sends both messages under the 8 000-token budget, and persists that same count (AC-10, AC-14)', async () => {
    const llm = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const app = await makeApp({ llm });
    const { repoId, prId } = await makeRepoPr();
    await addDoc(repoId, { title: 'Architecture', body: 'a '.repeat(12_000), order: 1 });

    const brief = (await post(app, prId)).json();

    // Counted over the CONCATENATION of system and user, in one call, with the
    // container's own counter — not over the user half, and not as a sum.
    const counted = app.container.tokenizer.count(sentInput(llm));
    expect(counted).toBeLessThanOrEqual(BRIEF_INPUT_TOKEN_BUDGET);
    expect(brief.input_tokens).toBe(counted);

    // Ours and the provider's, side by side and different. The mock fixes its
    // own at 100, which is what makes the difference demonstrable at all.
    expect(brief.tokens_in).toBe(100);
    expect(brief.input_tokens).not.toBe(brief.tokens_in);
    await app.close();
  });

  it('refuses with 422 and spends nothing when even the minimal input is too large (AC-12)', async () => {
    const llm = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const app = await makeApp({ llm });
    // The minimal input is the title, the branch and the file list — so a title
    // no ladder can shorten is the way to exceed the budget at the floor.
    const { prId } = await makeRepoPr({ title: `Scope orders ${'x '.repeat(20_000)}` });

    const res = await post(app, prId);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('brief_input_too_large');
    expect(structuredCalls(llm)).toHaveLength(0);
    await app.close();
  });

  it('records every budget drop in BOTH channels — the log line and the row (AC-13)', async () => {
    const lines: Record<string, unknown>[] = [];
    const app = await makeApp();
    app.log.info = ((obj: Record<string, unknown>) => {
      if (obj && typeof obj === 'object') lines.push(obj);
    }) as typeof app.log.info;

    const { repoId, prId } = await makeRepoPr();
    await addDoc(repoId, { title: 'Architecture', body: 'a '.repeat(12_000), order: 1 });
    await addDoc(repoId, { title: 'Style guide', body: 'b '.repeat(12_000), order: 2 });

    const brief = (await post(app, prId)).json();
    expect(brief.trimmed.length).toBeGreaterThan(0);

    const line = lines.find((l) => l.llmCalls === 1);
    expect(line).toBeDefined();
    expect(line!.trimmed).toEqual(brief.trimmed);
    await app.close();
  });

  // ---- Degraded inputs -----------------------------------------------------

  it('briefs a PR with no derived intent, says so, and never derives one (AC-22)', async () => {
    const derive = (): never => {
      throw new Error('the brief must never derive an intent');
    };
    const app = await makeApp({
      intent: { get: async () => undefined, derive, forReview: derive },
    });
    const { prId } = await makeRepoPr();

    const res = await post(app, prId);
    expect(res.statusCode).toBe(200);
    expect(res.json().missing_inputs.join(' ')).toContain('no intent has been derived');
    await app.close();
  });

  it('narrows the allow-list to the changed files when the map is degraded (AC-15, AC-23)', async () => {
    // An unindexed repository produces a degraded map naturally — no override
    // needed — so the blast half of the allow-list is empty and only the pull
    // request's own two files may be cited.
    const llm = new MockLLMProvider('openai', { structured: INVENTED_PATH_FIXTURE });
    const app = await makeApp({ llm });
    const { prId } = await makeRepoPr();

    const brief = (await post(app, prId)).json();

    expect(brief.missing_inputs.join(' ')).toContain('blast map is unavailable');
    // The invented path is gone from the record and named in `dropped_refs`,
    // and the rest of the brief survived — no reprompt, one call.
    expect(brief.risks[0].file_refs).toEqual(['src/authorization.ts:12']);
    expect(brief.risks[0].title).toBe('Order reads were unscoped');
    expect(brief.review_focus.map((f: { ref: string }) => f.ref)).toEqual(['src/authorization.ts']);
    expect(brief.dropped_refs).toEqual(['src/invented/module.ts:4', 'src/nowhere.ts']);
    expect(structuredCalls(llm)).toHaveLength(1);
    await app.close();
  });

  it('refuses with 422 and spends nothing on a PR with no changed files (AC-24)', async () => {
    const llm = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const app = await makeApp({ llm });
    const { prId } = await makeRepoPr({ files: [] });

    const res = await post(app, prId);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('brief_no_changed_files');
    expect(structuredCalls(llm)).toHaveLength(0);
    await app.close();
  });

  it('leaves the previous brief readable when a regeneration throws (AC-25)', async () => {
    const app = await makeApp();
    const { prId } = await makeRepoPr({ body: 'The original description.' });
    expect((await post(app, prId)).statusCode).toBe(200);
    await app.close();

    // A different input state, so the second POST would have written a new row
    // if it had got that far.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ body: 'A rewritten description.' })
      .where(eq(t.pullRequests.id, prId));

    const broken = await makeApp({ llm: throwingLLM('openai'), openrouter: throwingLLM('openrouter') });
    expect((await post(broken, prId)).statusCode).toBeGreaterThanOrEqual(500);
    expect(await briefRows(prId)).toBe(1);

    const stillThere = await get(broken, prId);
    expect(stillThere.statusCode).toBe(200);
    expect(stillThere.json().what).toBe(BRIEF_FIXTURE.what);
    await broken.close();
  });

  it('caps POST at ten a minute and leaves GET uncapped (AC-26)', async () => {
    // The global limiter is off under NODE_ENV=test so other suites can hammer
    // `inject()`; the per-route override only binds once it is registered.
    const app = await makeApp({ nodeEnv: 'production' });
    const { prId } = await makeRepoPr();

    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await post(app, prId)).statusCode);

    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);

    // And the read side is untouched by the POSTs that just tripped the limit.
    expect((await get(app, prId)).statusCode).toBe(200);
    await app.close();
  });

  // ---- The history ---------------------------------------------------------

  it('orders the timeline by seq, even for two rows written in ONE transaction (AC-27)', async () => {
    const app = await makeApp();
    const { prId } = await makeRepoPr();
    const record = (stateKey: string, what: string) => ({
      pr_id: prId,
      what,
      why: 'seeded',
      risk_level: 'low' as const,
      risks: [],
      review_focus: [],
      state_key: stateKey,
      head_sha: 'head-1',
      missing_inputs: [],
      dropped_refs: [],
      trimmed: [],
      input_tokens: 1,
      provider: 'openrouter' as const,
      model: BRIEF_MODEL.model,
      tokens_in: 1,
      tokens_out: 1,
      cost_usd: null,
      duration_ms: 1,
      generated_at: new Date().toISOString(),
    });

    // `defaultNow()` is the TRANSACTION's timestamp, so both rows tie to the
    // microsecond. Only `seq` can order them.
    await pg.handle.db.transaction(async (tx) => {
      await tx.insert(t.prBrief).values({
        prId,
        stateKey: 'seed:v1',
        headSha: 'head-1',
        json: record('seed:v1', 'the older one'),
      });
      await tx.insert(t.prBrief).values({
        prId,
        stateKey: 'seed:v2',
        headSha: 'head-1',
        json: record('seed:v2', 'the newer one'),
      });
    });

    const brief = (await get(app, prId)).json();
    expect(brief.what).toBe('the newer one');
    expect(brief.history.map((h: { what: string }) => h.what)).toEqual([
      'the newer one',
      'the older one',
    ]);
    expect(brief.history[0].seq).toBeGreaterThan(brief.history[1].seq);
    await app.close();
  });

  // ---- The seed ------------------------------------------------------------

  it('serves the two SEEDED briefs of PR #482 as stale, and re-seeding renumbers nothing (AC-39)', async () => {
    // This file runs the real `seed()` in `beforeAll`, the way `intent.it.test.ts`
    // does, so the seeded rows are assertable here and not only through the
    // browser flow. Read against providers that throw on every verb: a seeded
    // brief must be readable without anything being generated.
    const app = await makeApp({
      llm: throwingLLM('openai'),
      openai: throwingLLM('openai'),
      openrouter: throwingLLM('openrouter'),
    });
    const [demoPr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.number, 482)));
    expect(demoPr).toBeDefined();

    const before = (await get(app, demoPr!.id)).json();
    // Both rows are there, newest first, and the newest is the one the card shows.
    expect(before.history).toHaveLength(2);
    expect(before.history.map((h: { state_key: string }) => h.state_key)).toEqual([
      'seed:v2',
      'seed:v1',
    ]);
    expect(before.state_key).toBe('seed:v2');
    // STALE, and not by accident: a `seed:`-prefixed key can never equal the
    // SHA-256 hex a read recomputes, so the product never claims a freshness it
    // cannot prove.
    expect(before.stale).toBe(true);
    expect(before.state_key).not.toMatch(/^[0-9a-f]{64}$/);

    const seqBefore = before.history.map((h: { seq: number }) => h.seq);

    // A second `pnpm db:seed` on a database that already has them.
    await seed(pg.handle.db);

    const after = (await get(app, demoPr!.id)).json();
    expect(await briefRows(demoPr!.id)).toBe(2);
    // `seq` is untouched, because the upsert's `set` carries neither `id` nor
    // `seq` — renumbering would reorder the Why Timeline it just seeded.
    expect(after.history.map((h: { seq: number }) => h.seq)).toEqual(seqBefore);
    expect(after.state_key).toBe('seed:v2');
    expect(after.stale).toBe(true);
    await app.close();
  });

  it('keeps the newest twenty briefs and deletes the rest, oldest first (AC-29)', async () => {
    const app = await makeApp();
    const { prId } = await makeRepoPr();

    for (let i = 0; i < BRIEF_MAX_HISTORY + 1; i++) {
      await pg.handle.db.insert(t.prBrief).values({
        prId,
        stateKey: `manual:${String(i)}`,
        headSha: 'head-1',
        json: {
          pr_id: prId,
          what: `brief ${String(i)}`,
          why: '',
          risk_level: 'low',
          risks: [],
          review_focus: [],
          state_key: `manual:${String(i)}`,
          head_sha: 'head-1',
          missing_inputs: [],
          dropped_refs: [],
          trimmed: [],
          input_tokens: 1,
          provider: 'openrouter',
          model: BRIEF_MODEL.model,
          tokens_in: 1,
          tokens_out: 1,
          cost_usd: null,
          duration_ms: 1,
          generated_at: new Date().toISOString(),
        },
      });
    }
    expect(await briefRows(prId)).toBe(BRIEF_MAX_HISTORY + 1);

    // The generation is what enforces the cap: 21 stored + 1 written = 22, cut
    // back to 20, and the oldest is the one that goes.
    expect((await post(app, prId)).statusCode).toBe(200);
    expect(await briefRows(prId)).toBe(BRIEF_MAX_HISTORY);

    const keys = await pg.handle.db
      .select({ stateKey: t.prBrief.stateKey })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    expect(keys.map((k) => k.stateKey)).not.toContain('manual:0');
    expect(keys.map((k) => k.stateKey)).not.toContain('manual:1');
    await app.close();
  });

  // ---- Project Context -----------------------------------------------------

  it('carries an enabled document, ignores a disabled one, and drops it first (AC-38)', async () => {
    const llm = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const app = await makeApp({ llm });
    const { repoId, prId } = await makeRepoPr();
    await addDoc(repoId, { title: 'Architecture', body: 'the enabled body', order: 1 });
    await addDoc(repoId, { title: 'Retired', body: 'the disabled body', order: 2, enabled: false });

    await post(app, prId);
    const input = sentInput(llm);
    expect(input).toContain('the enabled body');
    expect(input).not.toContain('the disabled body');

    // Now make the pair too large for the budget: the documents are the first
    // thing the ladder gives up, before the issue, the map or the file list.
    const { repoId: bigRepo, prId: bigPr } = await makeRepoPr();
    await addDoc(bigRepo, { title: 'Architecture', body: 'a '.repeat(12_000), order: 1 });
    const big = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const bigApp = await makeApp({ llm: big });

    const brief = (await post(bigApp, bigPr)).json();
    expect(brief.trimmed[0]).toContain('project-context');
    expect(sentInput(big)).not.toContain('a a a a a');
    await app.close();
    await bigApp.close();
  });

  // ---- Which model gets bought ---------------------------------------------

  it('buys the module-local BRIEF_MODEL when Settings names none (AC-41)', async () => {
    const openrouter = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const openai = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const app = await makeApp({ openai, openrouter });
    const { prId } = await makeRepoPr();

    const brief = (await post(app, prId)).json();

    expect(structuredCalls(openrouter)).toHaveLength(1);
    expect(structuredCalls(openai)).toHaveLength(0);
    expect(brief.provider).toBe(BRIEF_MODEL.provider);
    expect(brief.model).toBe(BRIEF_MODEL.model);
    // Never the registry's default for this slot, which `settings-models.it.test.ts`
    // pins as what `resolveFeatureModel` would have returned.
    expect(brief.model).not.toBe('gpt-4.1');
    await app.close();
  });

  it('buys the workspace’s chosen model when Settings names one (AC-41)', async () => {
    const chosen = { risk_brief: { provider: 'openai', model: 'gpt-5-mini' } };
    await pg.handle.db
      .insert(t.settings)
      .values({ workspaceId, userId, key: 'feature_models', value: chosen })
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: chosen },
      });

    const openrouter = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const openai = new MockLLMProvider('openai', { structured: BRIEF_FIXTURE });
    const app = await makeApp({ openai, openrouter });
    const { prId } = await makeRepoPr();

    const brief = (await post(app, prId)).json();

    expect(structuredCalls(openai)).toHaveLength(1);
    expect(structuredCalls(openrouter)).toHaveLength(0);
    expect((structuredCalls(openai)[0]!.req as { model: string }).model).toBe('gpt-5-mini');
    expect(brief.provider).toBe('openai');
    expect(brief.model).toBe('gpt-5-mini');
    expect(brief.model).not.toBe('gpt-4.1');

    // Leave the workspace as we found it — every other case here asserts the
    // default branch, and without this they would all inherit the override.
    await pg.handle.db
      .delete(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    await app.close();
  });
});
