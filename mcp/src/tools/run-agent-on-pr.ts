import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { Agent, ReviewRecord, ReviewRunResponse, RunSummary } from '@devdigest/shared';

import type { ApiClient } from '../api/client.js';
import { resolvePull } from '../api/resolve.js';
import { waitForRun, type WaitClock, type WaitOutcome } from '../api/wait.js';
import type { McpConfig } from '../config.js';
import { TOOL_DESCRIPTIONS } from '../copy.js';
import { isDevDigestApiError } from '../errors.js';
import { log } from '../log.js';
import { runAgentOnPrInput, runAgentOnPrOutput } from '../schemas.js';
import { resolveAgent, toAgentSummary, type AgentSummary } from '../shape/agents.js';
import {
  buildReviewResult,
  describeReviewResult,
  type ResponseFormat,
} from '../shape/findings.js';

/**
 * Delivery ring — `run_agent_on_pr`: start the run, wait for it, collect the
 * result. One call, one outcome.
 *
 * The tool is deliberately **blocking**. `POST /pulls/:id/review` is
 * fire-and-forget and returns `reviews: []` on purpose, so a start tool and a
 * poll tool would push a state machine into the model — three calls, and a
 * failure mode where it forgets the third. The wait lives in `api/wait.ts`
 * instead, and this module is what happens around it.
 *
 * Four rules from `specs/L04-mcp-server.md` decide everything below:
 *
 * - **D9 — `agent` is required, and `{ all: true }` is never sent.**
 *   `agents.enabled` is the membership test for that fan-out
 *   (`server/INSIGHTS.md` 2026-08-06), so one `all` call bills every enabled
 *   agent. A tool that can spend N model calls from one under-specified argument
 *   is not a tool to hand an agent.
 * - **D6 — a timeout tells the truth.** It returns `still_running` with the real
 *   run id and no verdict, never an empty findings list.
 * - **D5 — and the text has to sound like it.** A run past 120 s is ordinary,
 *   not a failure, so the words must read as "healthy and still going, collect
 *   it with this exact call". They name `get_findings` and they do not name this
 *   tool, because a re-call here starts a second paid run.
 * - **D7 — the review is selected by the run id this call was handed**, never by
 *   position in `GET /pulls/:id/reviews`.
 */

/** What the handler needs; `response_format` has its default applied by `schemas.ts`. */
export interface RunAgentOnPrArgs {
  readonly repo: string;
  readonly pr: number;
  readonly agent: string;
  readonly response_format?: ResponseFormat | undefined;
}

export interface RunAgentOnPrDeps {
  readonly api: ApiClient;
  readonly config: McpConfig;
  /** Only the unit lane passes this: it advances a number instead of waiting. */
  readonly clock?: WaitClock;
}

export function registerRunAgentOnPr(server: McpServer, deps: RunAgentOnPrDeps): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      title: 'Run a reviewer agent on a pull request',
      description: TOOL_DESCRIPTIONS.run_agent_on_pr,
      inputSchema: runAgentOnPrInput,
      outputSchema: runAgentOnPrOutput,
      // Not read-only: it starts a run that spends a real model call. Not
      // destructive: it adds a review, it never removes or overwrites one. Open
      // world: the reviewed pull request lives outside DevDigest.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args: RunAgentOnPrArgs) => runRunAgentOnPr(deps, args),
  );
}

/**
 * The handler itself, exported so the unit lane can drive it with a stubbed
 * `fetch` and a stubbed clock, and no MCP transport at all.
 */
export async function runRunAgentOnPr(
  deps: RunAgentOnPrDeps,
  args: RunAgentOnPrArgs,
): Promise<CallToolResult> {
  const { api, config } = deps;
  const responseFormat: ResponseFormat = args.response_format ?? 'concise';

  try {
    // The agent is resolved BEFORE anything is started, and before the pull
    // request is even looked up: a misspelled agent name is the likelier
    // mistake, and this is the last moment where nothing has been spent.
    const agents = await api.get<Agent[]>('/agents');
    const resolution = resolveAgent(args.agent, agents.map(toAgentSummary));
    if (!resolution.ok) return errorResult(resolution.reason, resolution.message);
    const agent = resolution.agent;

    const pull = await resolvePull(api, args.repo, args.pr);

    // D9 — `{ agentId }`, never `{ all: true }`.
    let triggered: ReviewRunResponse;
    try {
      triggered = await api.post<ReviewRunResponse>(`/pulls/${pull.id}/review`, {
        agentId: agent.id,
      });
    } catch (error) {
      // The review trigger carries its own limit — 10 per minute
      // (`reviews/routes.ts:27`), tighter than the global 120/min because each
      // call can fan out to expensive runs. The generic `rate_limited` text
      // cannot say that, and its "repeat the same call" advice needs the
      // reassurance that nothing was started, or a model reads a 429 as "the
      // run may or may not exist" and goes looking.
      if (isDevDigestApiError(error) && error.code === 'rate_limited') {
        log('run_agent_on_pr was rate-limited before starting a run', error);
        return errorResult('rate_limited', describeTriggerRateLimited(pull.repo, args.pr, agent));
      }
      throw error;
    }

    const target = triggered.runs.find((run) => run.agent_id === agent.id) ?? triggered.runs[0];
    if (!target) {
      return errorResult('api_error', describeNothingStarted(pull.repo, args.pr, agent));
    }

    // From here on a run EXISTS and is being paid for, so every failure has to
    // point at `get_findings` rather than at another attempt.
    let outcome: WaitOutcome;
    try {
      outcome = await waitForRun(api, pull.id, target.run_id, {
        timeoutMs: config.runTimeoutMs,
        ...deps.clock,
      });
    } catch (error) {
      if (!isDevDigestApiError(error)) throw error;
      log('run_agent_on_pr lost sight of a started run', error);
      return errorResult(
        error.code,
        describeLostRun(pull.repo, args.pr, agent, target.run_id, error.message),
      );
    }

    if (outcome.status === 'timed_out') {
      // D6: the one branch that must never look like a verdict.
      return stillRunningResult({
        repo: pull.repo,
        pr: args.pr,
        agent,
        runId: outcome.runId,
        waitedMs: outcome.waitedMs,
      });
    }

    if (outcome.status !== 'done') {
      return runNotDoneResult(pull.repo, args.pr, agent, outcome.status, outcome.run);
    }

    const reviews = await api.get<ReviewRecord[]>(`/pulls/${pull.id}/reviews`);
    // D7 — by run id. Narrowing by agent would pick this agent's NEWEST review,
    // which on a second run of the same pull request is a different pass than
    // the one this call paid for, and the two share `created_at` to the
    // microsecond often enough for that to be a coin toss.
    const mine = reviews.filter((review) => review.run_id === outcome.runId);
    if (mine.length === 0) {
      return errorResult(
        'api_error',
        describeMissingReview(pull.repo, args.pr, agent, outcome.runId),
      );
    }

    const result = buildReviewResult({
      repo: pull.repo,
      pr: args.pr,
      reviews: mine,
      agent: { id: agent.id, name: agent.name },
      responseFormat,
    });
    // The payload is `get_findings`'s, with the one difference the run row buys:
    // this call watched the run, so `status`, `duration_ms` and `cost_usd` are
    // known rather than null (`runOutput` in `schemas.ts` documents that split).
    const payload = {
      ...result,
      run: {
        id: outcome.runId,
        status: outcome.run.status,
        duration_ms: outcome.run.duration_ms,
        cost_usd: outcome.run.cost_usd,
      },
    };

    return {
      content: [
        { type: 'text', text: describeReviewResult(payload) },
        { type: 'text', text: JSON.stringify(payload, null, 2) },
      ],
      structuredContent: payload as unknown as Record<string, unknown>,
    };
  } catch (error) {
    // Every business failure is a tool-level error, never a thrown protocol
    // fault: the process has to stay alive and answer the next call even with
    // nothing listening on :3001.
    if (!isDevDigestApiError(error)) throw error;
    log('run_agent_on_pr failed', error);
    return errorResult(error.code, error.message);
  }
}

/**
 * The timeout answer. Its structured payload carries **no `verdict` and no
 * `findings` key at all** — not even empty ones, which is the exact lie D6 is
 * about: a caller reading `findings: []` learns "the reviewers found nothing"
 * when the truth is "the reviewer has not finished".
 *
 * `isError: true` is what stops the SDK validating this against
 * `runAgentOnPrOutput`, which is right: this is not a review, and it must not be
 * shaped like one.
 */
function stillRunningResult(args: {
  repo: string;
  pr: number;
  agent: AgentSummary;
  runId: string;
  waitedMs: number;
}): CallToolResult {
  const waitedSeconds = Math.round(args.waitedMs / 1000);
  const followUp = `get_findings(repo: ${JSON.stringify(args.repo)}, pr: ${args.pr}, agent: ${JSON.stringify(args.agent.slug)})`;

  // Every sentence here is load-bearing, and the unit lane asserts two of them:
  // that `get_findings` is named, and that THIS tool is not. The model's
  // instinct on an error is to retry the call it just made, and here that
  // instinct spends a second model call while the first run is still working.
  const message =
    `The review of ${args.repo}#${args.pr} by ${args.agent.name} is still running after ` +
    `${waitedSeconds} seconds. Nothing failed: the run is healthy, DevDigest is still working ` +
    `on it, and its result will be saved when it finishes. This tool simply stops waiting at ` +
    `that point so it can tell you where the run is. ` +
    `Collect the finished review in a minute or so with ${followUp} — it costs nothing and ` +
    `reads the same result. Do not start another review of this pull request while this one is ` +
    `going: that spends a second model call for the same answer. Run id ${args.runId}.`;

  const payload = {
    status: 'still_running' as const,
    run_id: args.runId,
    waited_seconds: waitedSeconds,
    repo: args.repo,
    pr: args.pr,
    agent: args.agent.name,
    next_step: followUp,
    message,
  };

  return {
    content: [
      { type: 'text', text: message },
      { type: 'text', text: JSON.stringify(payload, null, 2) },
    ],
    structuredContent: payload,
    isError: true,
  };
}

/**
 * A run that reached `failed` or `cancelled`.
 *
 * It carries the run row's own `error` text, because that is the only thing that
 * says WHAT failed — a missing API key, a provider timeout, a cancelled run.
 * Never an empty findings list: the acceptance criteria call that out by name,
 * and it is the same lie as the timeout path's.
 */
function runNotDoneResult(
  repo: string,
  pr: number,
  agent: AgentSummary,
  status: 'failed' | 'cancelled',
  run: RunSummary,
): CallToolResult {
  const reason = run.error?.trim();
  const head =
    status === 'cancelled'
      ? `The review of ${repo}#${pr} by ${agent.name} was cancelled before it finished, so there ` +
        `are no findings.`
      : `The review of ${repo}#${pr} by ${agent.name} failed, so there are no findings — this is ` +
        `not a clean review.`;

  const message =
    `${head} ` +
    (reason ? `DevDigest reported: ${reason} ` : `DevDigest recorded no reason for it. `) +
    (status === 'cancelled'
      ? `Call this tool again if you still want the review.`
      : `Check the API's terminal output and the agent's model credentials, then try again. ` +
        `Nothing is saved from a failed run, so re-running it is safe.`) +
    ` Run id ${run.run_id}.`;

  const payload = {
    status,
    code: status === 'cancelled' ? 'run_cancelled' : 'run_failed',
    run_id: run.run_id,
    repo,
    pr,
    agent: agent.name,
    error: run.error,
    message,
  };

  return {
    content: [
      { type: 'text', text: message },
      { type: 'text', text: JSON.stringify(payload, null, 2) },
    ],
    structuredContent: payload,
    isError: true,
  };
}

/**
 * The 429 on the trigger itself. It names the limit that actually fired — 10
 * review triggers a minute, not the global 120 — and says outright that no run
 * was started, which is the fact that makes "try again" safe advice.
 */
function describeTriggerRateLimited(repo: string, pr: number, agent: AgentSummary): string {
  return (
    `DevDigest refused to start the review of ${repo}#${pr} by ${agent.name}: the review trigger ` +
    `is rate-limited to 10 calls per minute, and that limit is currently reached. No run was ` +
    `started and nothing was spent. Wait about a minute and make the same call again. If a ` +
    `review of this pull request is already going, read it with get_findings instead.`
  );
}

/**
 * The run started, and then the poll could not reach the API — the stack went
 * down, or the global 120/min limit was hit while a human clicked around the web
 * app (plan § Risks).
 *
 * The run itself is unaffected: it lives in the API's process, not in this one.
 * So the next step is `get_findings`, never another attempt — the same reasoning
 * as the timeout path, for a different cause.
 */
function describeLostRun(
  repo: string,
  pr: number,
  agent: AgentSummary,
  runId: string,
  apiMessage: string,
): string {
  return (
    `The review of ${repo}#${pr} by ${agent.name} was started (run ${runId}) but this tool lost ` +
    `contact with DevDigest while waiting for it, so its result is unknown. The run itself is ` +
    `unaffected — it is DevDigest that runs it, not this tool. Once the API answers again, read ` +
    `the outcome with get_findings on the same repo, pr and agent rather than starting another ` +
    `review. ${apiMessage}`
  );
}

/** The API accepted the trigger and scheduled nothing — a state with no next step in it. */
function describeNothingStarted(repo: string, pr: number, agent: AgentSummary): string {
  return (
    `DevDigest accepted the request to review ${repo}#${pr} with ${agent.name} but started no ` +
    `run, so there is nothing to wait for and nothing was spent. Check the agent still exists ` +
    `with list_agents, then try again.`
  );
}

/** A finished run whose review row cannot be found — reported, never guessed around. */
function describeMissingReview(
  repo: string,
  pr: number,
  agent: AgentSummary,
  runId: string,
): string {
  return (
    `The review of ${repo}#${pr} by ${agent.name} finished, but DevDigest has no stored review ` +
    `for run ${runId}, so its findings cannot be read back. Read the API's terminal output for ` +
    `the cause. Do not re-run the review to work around this: use get_findings on the same ` +
    `repo and pr to see what is stored.`
  );
}

function errorResult(code: string, message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { status: 'error', code, message },
    isError: true,
  };
}
