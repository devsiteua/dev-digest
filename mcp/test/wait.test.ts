import type { CallToolResult } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import type { Agent, PrMeta, ReviewRecord, RunSummary } from '@devdigest/shared';

import { ApiClient, type HttpResponse } from '../src/api/client.js';
import {
  FAST_POLL_INTERVAL_MS,
  FAST_POLL_WINDOW_MS,
  SLOW_POLL_INTERVAL_MS,
  waitForRun,
} from '../src/api/wait.js';
import { DEFAULT_API_BASE_URL, DEFAULT_RUN_TIMEOUT_MS } from '../src/config.js';
import { runGetFindings } from '../src/tools/get-findings.js';
import { runRunAgentOnPr } from '../src/tools/run-agent-on-pr.js';

/**
 * The wait, and the tool built on it — driven by a stubbed `fetch` and a
 * **virtual clock**, so a 120-second timeout is asserted in milliseconds of real
 * time.
 *
 * The clock is what makes the timeout path a first-class test rather than a
 * branch nobody runs. D5 says a real multi-file review can exceed two minutes,
 * so `still_running` is an ORDINARY outcome — and D6 plus `server/INSIGHTS.md`
 * 2026-08-07 say what it must never do: "when a wait helper is allowed to return
 * without meeting its condition, every downstream assertion becomes a liar".
 * Hence the two assertions this file exists for: the timeout answer carries no
 * verdict and no findings key at all, and its words send the reader to
 * `get_findings` rather than to a second paid run.
 */

const BASE = DEFAULT_API_BASE_URL;
const PULL_ID = 'pr-482';
const RUN_ID = 'run-42';
const OTHER_RUN_ID = 'run-41';

// ---------------------------------------------------------------------------
// The virtual clock. Only a sleep advances it, so "elapsed" is exactly the time
// the loop CHOSE to wait — which is the thing under test.
// ---------------------------------------------------------------------------

interface Sleep {
  /** When the sleep started. */
  readonly at: number;
  readonly ms: number;
}

function virtualClock() {
  let t = 0;
  const sleeps: Sleep[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push({ at: t, ms });
      t += ms;
    },
    sleeps,
    elapsed: () => t,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function runRow(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: RUN_ID,
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    provider: 'anthropic',
    model: 'claude-opus-5',
    status: 'running',
    error: null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    findings_count: null,
    grounding: null,
    ran_at: '2026-08-28T10:00:00.000Z',
    score: null,
    blockers: null,
    ...overrides,
  };
}

function agentRow(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Security Reviewer',
    description: 'Secrets, authz and injection.',
    provider: 'anthropic',
    model: 'claude-opus-5',
    system_prompt: 'irrelevant to the projection',
    enabled: true,
    version: 3,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...overrides,
  };
}

function prRow(): PrMeta {
  return {
    id: PULL_ID,
    number: 482,
    title: 'Add idempotency keys',
    author: 'octocat',
    branch: 'feat/idempotency',
    base: 'main',
    head_sha: 'deadbeef',
    additions: 120,
    deletions: 14,
    files_count: 7,
    status: 'needs_review',
    opened_at: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-21T10:00:00.000Z',
  };
}

function reviewRow(overrides: Partial<ReviewRecord> & Pick<ReviewRecord, 'id'>): ReviewRecord {
  return {
    pr_id: PULL_ID,
    agent_id: 'agent-1',
    run_id: RUN_ID,
    agent_name: 'Security Reviewer',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'One secret, one missing guard.',
    score: 61,
    model: 'claude-opus-5',
    grounding: null,
    created_at: '2026-08-28T10:00:00.000Z',
    findings: [
      {
        id: 'f1',
        review_id: overrides.id,
        accepted_at: null,
        dismissed_at: null,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 12,
        end_line: 12,
        rationale: 'The key is committed in plain text.',
        suggestion: 'Read it from the secrets adapter.',
        confidence: 0.95,
      },
    ],
    ...overrides,
  };
}

/**
 * The structured payload as a plain bag of keys.
 *
 * `Object.keys(...)` on it is half of what this file asserts — "no `findings`
 * key" is a statement about the KEYS, not about a value being empty.
 */
function payloadOf(result: CallToolResult): Record<string, unknown> {
  // An error result deliberately carries NO `structuredContent` — it would
  // violate the tool's advertised `outputSchema` and a validating client (the
  // MCP Inspector) rejects the whole result over it. The machine-readable
  // payload moves to the last JSON text block, so this reads either place.
  if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
  for (let i = (result.content?.length ?? 0) - 1; i >= 0; i -= 1) {
    const block = result.content?.[i];
    if (!block || !('text' in block)) continue;
    try {
      const parsed: unknown = JSON.parse(String(block.text));
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // Not the JSON block — keep walking back.
    }
  }
  return {};
}

/** The nth content block's text; a non-text block reads as empty rather than throwing. */
function textOf(result: CallToolResult, index = 0): string {
  const block = result.content?.[index];
  return block && 'text' in block ? String(block.text) : '';
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  };
}

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly body: string | undefined;
}

/** An `ApiClient` over a scripted route table, recording every request it made. */
function apiOver(route: (request: Recorded) => HttpResponse) {
  const calls: Recorded[] = [];
  const api = new ApiClient({
    baseUrl: BASE,
    fetch: async (url, init) => {
      const request: Recorded = {
        method: init?.method ?? 'GET',
        url,
        body: init?.body,
      };
      calls.push(request);
      return route(request);
    },
  });
  return { api, calls };
}

/**
 * The three scripted sequences of Step 5's `Verify` line, as one helper: each
 * poll of `GET /pulls/:id/runs` consumes the next status, and the last one
 * repeats forever (which is what a run that outlives the ceiling looks like).
 */
function runsScript(statuses: readonly string[], overrides: Partial<RunSummary> = {}) {
  let index = 0;
  return () => {
    const status = statuses[Math.min(index, statuses.length - 1)]!;
    index += 1;
    // The scripted status always wins: `overrides` carries the fields a finished
    // row also has (duration, cost), not its status.
    return [runRow({ ...overrides, status })];
  };
}

describe('waitForRun — running → running → done', () => {
  it('returns the finished run, and sleeps 2 s between polls', async () => {
    const clock = virtualClock();
    const next = runsScript(['running', 'running', 'done']);
    const pollsAt: number[] = [];
    const { api } = apiOver((request) => {
      expect(request.method).toBe('GET');
      expect(request.url).toBe(`${BASE}/pulls/${PULL_ID}/runs`);
      pollsAt.push(clock.now());
      return jsonResponse(200, next());
    });

    const outcome = await waitForRun(api, PULL_ID, RUN_ID, {
      timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(outcome.status).toBe('done');
    expect(outcome.runId).toBe(RUN_ID);
    expect(outcome.polls).toBe(3);
    expect(pollsAt).toEqual([0, FAST_POLL_INTERVAL_MS, FAST_POLL_INTERVAL_MS * 2]);
    expect(outcome.waitedMs).toBe(FAST_POLL_INTERVAL_MS * 2);
  });

  it('matches the run by run_id, never by position in the list', async () => {
    // The pull request carries a previous run and another agent's, both terminal.
    // Taking `runs[0]` would return "done" on the first poll — for a run this
    // call did not start.
    const clock = virtualClock();
    let poll = 0;
    const { api } = apiOver(() => {
      poll += 1;
      return jsonResponse(200, [
        runRow({ run_id: OTHER_RUN_ID, status: 'done', agent_name: 'General Reviewer' }),
        runRow({ status: poll >= 2 ? 'done' : 'running' }),
      ]);
    });

    const outcome = await waitForRun(api, PULL_ID, RUN_ID, {
      timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(outcome.polls).toBe(2);
    expect(outcome.run?.run_id).toBe(RUN_ID);
  });

  it('keeps polling while the run row has not appeared at all', async () => {
    // `POST /pulls/:id/review` returns before the executor has written anything,
    // so an empty list is "not yet", never "gone".
    const clock = virtualClock();
    let poll = 0;
    const { api } = apiOver(() => {
      poll += 1;
      return jsonResponse(200, poll < 3 ? [] : [runRow({ status: 'done' })]);
    });

    const outcome = await waitForRun(api, PULL_ID, RUN_ID, {
      timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(outcome.status).toBe('done');
    expect(outcome.polls).toBe(3);
  });
});

describe('waitForRun — running → failed', () => {
  it('reports failed, carrying the run row and its error text', async () => {
    const clock = virtualClock();
    let poll = 0;
    const { api } = apiOver(() => {
      poll += 1;
      return jsonResponse(200, [
        poll < 2
          ? runRow()
          : runRow({ status: 'failed', error: 'provider timeout after 90s', duration_ms: 91_000 }),
      ]);
    });

    const outcome = await waitForRun(api, PULL_ID, RUN_ID, {
      timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.run?.error).toBe('provider timeout after 90s');
  });

  it('reports cancelled as its own outcome, not as failed', async () => {
    const clock = virtualClock();
    const next = runsScript(['cancelled']);
    const { api } = apiOver(() => jsonResponse(200, next()));

    const outcome = await waitForRun(api, PULL_ID, RUN_ID, {
      timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(outcome.status).toBe('cancelled');
    expect(outcome.polls).toBe(1);
  });
});

describe('waitForRun — the clock-advanced timeout', () => {
  /** One run that never finishes, waited out on a virtual 120 seconds. */
  async function timeOut(timeoutMs = DEFAULT_RUN_TIMEOUT_MS) {
    const clock = virtualClock();
    const pollsAt: number[] = [];
    const next = runsScript(['running']);
    const { api } = apiOver(() => {
      pollsAt.push(clock.now());
      return jsonResponse(200, next());
    });

    const outcome = await waitForRun(api, PULL_ID, RUN_ID, {
      timeoutMs,
      now: clock.now,
      sleep: clock.sleep,
    });
    return { outcome, pollsAt, clock };
  }

  it('gives up as timed_out rather than reporting the run it has', async () => {
    const { outcome } = await timeOut();
    expect(outcome.status).toBe('timed_out');
    expect(outcome.runId).toBe(RUN_ID);
    // The last row seen is carried for context, and it says `running` — it is
    // not, and cannot be read as, a result.
    expect(outcome.run?.status).toBe('running');
  });

  it('never sleeps past the 120 s deadline', async () => {
    const { outcome, clock } = await timeOut();

    // THE assertion of D5: the deadline is checked BEFORE the sleep, so no sleep
    // may end on or after the ceiling. Check it after, and the last one carries
    // the call to 120 s and the poll after it to 122 s — past the point Claude
    // Code backgrounds the call.
    for (const sleep of clock.sleeps) {
      expect(sleep.at + sleep.ms, `a sleep starting at ${sleep.at} ran to the deadline`)
        .toBeLessThan(DEFAULT_RUN_TIMEOUT_MS);
    }
    expect(clock.elapsed()).toBeLessThan(DEFAULT_RUN_TIMEOUT_MS);
    expect(outcome.waitedMs).toBe(clock.elapsed());
    // 2 s × 30 to t=60 s, then 5 s to t=115 s: the last interval that fits.
    expect(outcome.waitedMs).toBe(115_000);
  });

  it('spends at most 30 requests in any one simulated minute', async () => {
    const { pollsAt, outcome } = await timeOut();

    // The global limit is 120 req/min and is SHARED with the web app
    // (`server/src/app.ts:96`), so this budget is a third of it. Counted over
    // every sliding 60-second window rather than over the first one, since the
    // cadence changes at 60 s.
    for (const start of pollsAt) {
      const inWindow = pollsAt.filter((at) => at >= start && at < start + 60_000);
      expect(inWindow.length, `window starting at ${start}`).toBeLessThanOrEqual(30);
    }
    // And ~42 in total across the whole wait, which is what D5 budgeted.
    expect(outcome.polls).toBe(42);
    expect(pollsAt).toHaveLength(42);
  });

  it('switches from the 2 s cadence to 5 s after the first minute', async () => {
    const { pollsAt } = await timeOut();
    const gaps = pollsAt.slice(1).map((at, i) => at - pollsAt[i]!);
    expect(gaps.filter((gap) => gap === FAST_POLL_INTERVAL_MS)).toHaveLength(30);
    expect(gaps.every((gap) => gap === FAST_POLL_INTERVAL_MS || gap === SLOW_POLL_INTERVAL_MS)).toBe(
      true,
    );
    expect(pollsAt.filter((at) => at < FAST_POLL_WINDOW_MS)).toHaveLength(30);
  });

  it('polls once before giving up, even with a ceiling of 1 ms', async () => {
    // The degraded acceptance path (`DEVDIGEST_MCP_RUN_TIMEOUT_MS=1`) exercises
    // the timeout branch without paying for a slow review. It must still make
    // the one poll that finds the real run id.
    const { outcome, pollsAt } = await timeOut(1);
    expect(outcome.status).toBe('timed_out');
    expect(outcome.polls).toBe(1);
    expect(pollsAt).toEqual([0]);
    expect(outcome.waitedMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The tool. Same clock, same stubbed fetch, plus the route table the three calls
// of one `run_agent_on_pr` need.
// ---------------------------------------------------------------------------

interface ToolRoutes {
  readonly runs: () => RunSummary[];
  readonly reviews?: ReviewRecord[];
  readonly agents?: Agent[];
  readonly triggerStatus?: number;
}

function toolApi(routes: ToolRoutes) {
  return apiOver((request) => {
    const path = request.url.slice(BASE.length);
    if (path === '/agents') return jsonResponse(200, routes.agents ?? [agentRow()]);
    if (path.startsWith('/pulls/lookup')) return jsonResponse(200, prRow());
    if (path === `/pulls/${PULL_ID}/review`) {
      if (routes.triggerStatus && routes.triggerStatus !== 200) {
        return jsonResponse(routes.triggerStatus, {
          error: { code: 'rate_limited', message: 'Too many requests' },
        });
      }
      return jsonResponse(200, {
        pr_id: PULL_ID,
        runs: [{ run_id: RUN_ID, agent_id: 'agent-1', agent_name: 'Security Reviewer' }],
        reviews: [],
      });
    }
    if (path === `/pulls/${PULL_ID}/runs`) return jsonResponse(200, routes.runs());
    if (path === `/pulls/${PULL_ID}/reviews`) return jsonResponse(200, routes.reviews ?? []);
    throw new Error(`unscripted request: ${request.method} ${path}`);
  });
}

const ARGS = { repo: 'acme/payments-api', pr: 482, agent: 'security-reviewer' } as const;

function callRunAgent(routes: ToolRoutes, timeoutMs = DEFAULT_RUN_TIMEOUT_MS) {
  const clock = virtualClock();
  const { api, calls } = toolApi(routes);
  const result = runRunAgentOnPr(
    {
      api,
      config: { apiBaseUrl: BASE, runTimeoutMs: timeoutMs },
      clock: { now: clock.now, sleep: clock.sleep },
    },
    ARGS,
  );
  return { result, calls, clock };
}

describe('run_agent_on_pr — the timeout answer (D6)', () => {
  it('carries no verdict and no findings key at all', async () => {
    const { result } = callRunAgent({ runs: runsScript(['running']) });
    const answer = await result;

    expect(answer.isError).toBe(true);
    const payload = payloadOf(answer);
    expect(payload).toMatchObject({ status: 'still_running', run_id: RUN_ID });
    // An empty findings array here would read as "the reviewers found nothing",
    // and a verdict would be an outright invention. Neither key exists.
    expect(Object.keys(payload)).not.toContain('findings');
    expect(Object.keys(payload)).not.toContain('verdict');
    expect(JSON.stringify(answer)).not.toContain('"findings"');
    expect(JSON.stringify(answer)).not.toContain('"verdict"');
  });

  it('reports the real run id and how long it actually waited', async () => {
    const { result } = callRunAgent({ runs: runsScript(['running']) });
    const payload = payloadOf(await result);
    expect(payload.run_id).toBe(RUN_ID);
    expect(payload.waited_seconds).toBe(115);
  });

  it('names get_findings, and never this tool', async () => {
    const { result } = callRunAgent({ runs: runsScript(['running']) });
    const answer = await result;
    const text = textOf(answer);

    expect(text).toContain('get_findings');
    // D5: the model's instinct on an error is to retry the call it just made,
    // and here that spends a second model call for the same answer. The words
    // must not offer it — not in the text, and not anywhere in the payload.
    expect(text).not.toContain('run_agent_on_pr');
    expect(JSON.stringify(answer)).not.toContain('run_agent_on_pr');
    // It must read as healthy-and-continuing, not as a failure.
    expect(text).toContain('still running');
    expect(text).toContain('Nothing failed');
    // The follow-up is a call the model can make verbatim.
    expect(text).toContain('repo: "acme/payments-api"');
    expect(text).toContain('pr: 482');
    expect(text).toContain('security-reviewer');
  });

  it('does not read the reviews it has no reason to trust', async () => {
    const { result, calls } = callRunAgent({ runs: runsScript(['running']) });
    await result;
    expect(calls.some((call) => call.url.endsWith('/reviews'))).toBe(false);
  });
});

describe('run_agent_on_pr — start, wait, collect', () => {
  const routes: ToolRoutes = {
    runs: runsScript(['running', 'running', 'done'], {
      duration_ms: 41_000,
      cost_usd: 0.0031,
      findings_count: 1,
      score: 61,
    }),
    reviews: [reviewRow({ id: 'review-new' })],
  };

  it('returns the verdict, the findings and the run it watched', async () => {
    const { result } = callRunAgent(routes);
    const answer = await result;

    expect(answer.isError).toBeFalsy();
    expect(answer.structuredContent).toMatchObject({
      repo: 'acme/payments-api',
      pr: 482,
      reviewed: true,
      agent: 'Security Reviewer',
      verdict: 'request_changes',
      total_findings: 1,
      run: { id: RUN_ID, status: 'done', duration_ms: 41_000, cost_usd: 0.0031 },
    });
    const findings = (answer.structuredContent as { findings: unknown[] }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      severity: 'CRITICAL',
      file: 'src/config.ts',
      line: 12,
      title: 'Hardcoded Stripe secret key',
    });
  });

  it('publishes exactly the payload get_findings publishes', async () => {
    // The `get_findings` description promises "the same shape as
    // run_agent_on_pr" in so many words, so the two are compared rather than
    // described. Only the `run` block differs, and only because this call
    // watched the run row that one never sees.
    const { result } = callRunAgent(routes);
    const ran = payloadOf(await result);

    const { api } = toolApi({ runs: runsScript(['done']), reviews: routes.reviews ?? [] });
    const read = payloadOf(await runGetFindings(api, ARGS));

    expect(Object.keys(ran).sort()).toEqual(Object.keys(read).sort());
    expect({ ...ran, run: null }).toEqual({ ...read, run: null });
  });

  it('picks the review by the run id it was handed, not the newest one (D7)', async () => {
    // A previous run of the SAME agent, written later. Narrowing by agent and
    // taking the newest would return it — an answer this call did not pay for.
    const stale = reviewRow({
      id: 'review-stale',
      run_id: OTHER_RUN_ID,
      created_at: '2026-08-29T10:00:00.000Z',
      summary: 'The older run.',
      score: 99,
    });
    const { result } = callRunAgent({ ...routes, reviews: [stale, reviewRow({ id: 'review-new' })] });
    const payload = payloadOf(await result);

    expect(payload.score).toBe(61);
    expect(payload.summary).toBe('One secret, one missing guard.');
  });

  it('sends { agentId } and never { all: true } (D9)', async () => {
    const { result, calls } = callRunAgent(routes);
    await result;

    const trigger = calls.find((call) => call.method === 'POST');
    expect(trigger?.url).toBe(`${BASE}/pulls/${PULL_ID}/review`);
    expect(JSON.parse(trigger?.body ?? '{}')).toEqual({ agentId: 'agent-1' });
    // One `all: true` bills every enabled agent. It must not be reachable from
    // this tool at all, whatever the caller typed.
    expect(trigger?.body).not.toContain('all');
  });

  it('resolves the agent before anything is started', async () => {
    const { result, calls } = callRunAgent(routes);
    await result;
    expect(calls[0]?.url).toBe(`${BASE}/agents`);
  });

  it('spends nothing on a misspelled agent, and names list_agents', async () => {
    // The last moment at which nothing has been paid for. `securty` must not
    // reach `POST /pulls/:id/review` at all.
    const { api, calls } = toolApi(routes);
    const answer = await runRunAgentOnPr(
      { api, config: { apiBaseUrl: BASE, runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS } },
      { ...ARGS, agent: 'securty' },
    );

    expect(answer.isError).toBe(true);
    expect(textOf(answer)).toContain('list_agents');
    expect(textOf(answer)).toContain('Security Reviewer');
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });
});

describe('run_agent_on_pr — a run that fails', () => {
  it('returns an error carrying the row’s error text, never an empty findings list', async () => {
    const { result } = callRunAgent({
      runs: runsScript(['running', 'failed'], { error: 'anthropic: 401 invalid x-api-key' }),
      reviews: [],
    });
    const answer = await result;

    expect(answer.isError).toBe(true);
    expect(textOf(answer)).toContain('anthropic: 401 invalid x-api-key');
    const payload = payloadOf(answer);
    expect(payload).toMatchObject({ status: 'failed', code: 'run_failed', run_id: RUN_ID });
    // The acceptance criteria name this one: a failed run is not a clean review.
    expect(Object.keys(payload)).not.toContain('findings');
    expect(Object.keys(payload)).not.toContain('verdict');
  });

  it('tells a cancelled run apart from a failed one', async () => {
    const { result } = callRunAgent({
      runs: runsScript(['cancelled']),
      reviews: [],
    });
    const answer = await result;
    expect(payloadOf(answer)).toMatchObject({ status: 'cancelled', code: 'run_cancelled' });
    expect(textOf(answer)).toContain('cancelled');
  });
});

describe('run_agent_on_pr — 429', () => {
  it('names the 10-per-minute review trigger limit, and says nothing was started', async () => {
    const { result, calls } = callRunAgent({
      runs: runsScript(['running']),
      triggerStatus: 429,
    });
    const answer = await result;

    expect(answer.isError).toBe(true);
    expect(payloadOf(answer)).toMatchObject({ code: 'rate_limited' });
    const text = textOf(answer);
    expect(text).toContain('10 calls per minute');
    expect(text).toContain('No run was started');
    // A rejected trigger must not be followed by a poll for a run that does not
    // exist — and never by a retry, which is what the plan's constraint table
    // forbids by name.
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(calls.some((call) => call.url.endsWith('/runs'))).toBe(false);
  });
});
