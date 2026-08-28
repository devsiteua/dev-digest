import type { WorkingReviewRequest, WorkingReviewResponse } from '@devdigest/shared';
import { countBlockers, reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { REVIEW_STRATEGY, WORKING_TASK_LINE } from './constants.js';
import { buildSkillBlocks, resolveAgentProvider, type InputProgress } from './inputs.js';

/**
 * Review a diff with no pull request behind it — the working tree of whoever ran
 * `devdigest review`.
 *
 * **The same engine, reached through the same builders.** `reviewPullRequest` is
 * the pure pipeline `modules/reviews/run-executor.ts` calls, the provider comes
 * from `resolveAgentProvider` and the skills from `buildSkillBlocks`, both of
 * which the executor now calls too. There is no second review implementation
 * here — that is what the extraction into `inputs.ts` bought.
 *
 * What is deliberately ABSENT: persistence, a run row, a `RunBus` subscription
 * and repo-intel enrichment. The first three have nothing to key on — there is
 * no pull request and no agent run — and the fourth has nothing to look up: the
 * index is built from a repository's default branch, and this diff has not been
 * pushed anywhere. A prompt is not silently weaker for it; it is the same prompt
 * a repo-intel-disabled agent gets, which is a shape the engine already
 * supports.
 *
 * SYNCHRONOUS, unlike `POST /pulls/:id/review`. That one is fire-and-forget
 * because a browser subscribes to the run afterwards; a CLI has nothing to
 * subscribe with, and would be left with nothing to print.
 */
export async function reviewWorkingDiff(
  container: Container,
  workspaceId: string,
  request: WorkingReviewRequest,
  progress?: InputProgress,
): Promise<WorkingReviewResponse> {
  const startedAt = Date.now();
  const agent = await resolveAgentByRef(container, workspaceId, request.agent);

  const diff = parseUnifiedDiff(request.diff);
  if (diff.files.length === 0) {
    // The CLI already refuses to send an empty diff; this catches the OTHER
    // case — text that is not a unified diff at all, which would otherwise be
    // reviewed as an empty change and come back approving nothing.
    throw new AppError(
      'empty_diff',
      'The supplied text parsed to no changed files. Pass the output of `git diff`, unmodified.',
      400,
    );
  }

  const llm = await resolveAgentProvider(container, agent.provider);
  // The progress channel is not decoration here: `buildSkillBlocks` reports a
  // budget cut, a disabled link and a failed lookup through it, and all three
  // degrade to `undefined` silently. A CLI user whose skills never made it into
  // the prompt would otherwise read the result as "the model ignored my rule".
  const skillBlocks = await buildSkillBlocks(container, agent.id, progress);

  const outcome = await reviewPullRequest({
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    diff,
    llm,
    strategy: agent.strategy ?? REVIEW_STRATEGY,
    ...(skillBlocks ? { skills: skillBlocks } : {}),
    task: WORKING_TASK_LINE,
    // No pull request to name, so the session key is the agent and the shape of
    // the diff. It exists for prompt-cache locality, not for identity.
    sessionId: `working:${agent.name}:${diff.files.length}`,
  });

  const findings = outcome.review.findings;
  return {
    agent_name: agent.name,
    provider: agent.provider as WorkingReviewResponse['provider'],
    model: agent.model,
    verdict: outcome.review.verdict ?? null,
    score: outcome.review.score ?? null,
    summary: outcome.review.summary ?? null,
    findings,
    blocking: countBlockers(findings, agent.ciFailOn),
    grounding: outcome.grounding,
    files_reviewed: diff.files.length,
    tokens_in: outcome.tokensIn,
    tokens_out: outcome.tokensOut,
    cost_usd: outcome.costUsd,
    duration_ms: Date.now() - startedAt,
  };
}

/**
 * Find the agent a caller named: its id, its name, or the kebab-cased slug the
 * MCP server mints from that name.
 *
 * The slug is accepted because DevDigest does not own one — `mcp/src/shape/
 * agents.ts` derives it, and a caller who read a name there will type it back.
 * Matching is case-insensitive for the same reason `resolveRepo` is: a human
 * typing at a terminal is a different problem from a route that must not guess.
 */
async function resolveAgentByRef(
  container: Container,
  workspaceId: string,
  ref: string,
): Promise<AgentRow> {
  const wanted = ref.trim().toLowerCase();
  const agents = await container.agentsRepo.list(workspaceId);

  const hit =
    agents.find((a) => a.id === ref.trim()) ??
    agents.find((a) => a.name.toLowerCase() === wanted) ??
    agents.find((a) => slugify(a.name) === wanted);

  if (!hit) {
    // The error names what DOES exist, because the most likely cause is a
    // renamed agent and the caller cannot see the list from a terminal.
    throw new NotFoundError(
      `No agent called ${JSON.stringify(ref)}. Available: ${
        agents.length > 0 ? agents.map((a) => slugify(a.name)).join(', ') : '(none configured)'
      }`,
    );
  }
  return hit;
}

/**
 * The same kebab-casing `mcp/src/shape/agents.ts` mints slugs with, including
 * its combining-mark strip — so "Ávila Reviewer" resolves here under the same
 * spelling the MCP tools hand a caller, rather than under one letter less.
 *
 * Two copies, deliberately: `mcp/` is a separate package tree that imports this
 * one's contracts as TYPES only, so there is nothing to share the function
 * through. What keeps them honest is that neither owns the slug — the name does.
 */
function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
