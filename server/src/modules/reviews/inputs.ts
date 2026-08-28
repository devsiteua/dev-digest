import type { LLMProvider, Provider } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { renderSkillBlocks } from './helpers.js';

/**
 * The inputs a review is assembled from, independent of what is being reviewed.
 *
 * These were private methods on `ReviewRunExecutor` until a second caller
 * appeared: `POST /reviews/working` reviews a diff with no pull request behind
 * it, and it has to reach the model through the SAME provider and the SAME skill
 * bodies as a PR review, or the CLI is a second reviewer wearing the first one's
 * name. Moving them here is what makes "no second review implementation" a fact
 * of the file layout rather than a claim.
 *
 * Nothing here knows about runs, pull requests or persistence — that is exactly
 * why both callers can use it.
 */

/**
 * Where a builder narrates itself, for a caller that has somewhere to put it.
 *
 * Deliberately a one-method structural type rather than `RunLogger`: the working
 * -diff path has no run and no `RunBus` to stream into, and requiring one would
 * make a CLI review depend on the streaming machinery in order to say "3 skills
 * attached". `RunLogger` satisfies this shape, so the executor passes `runLog`
 * straight in.
 */
export type InputProgress = { info(msg: string, data?: unknown): void };

/**
 * The agent's LLM provider.
 *
 * `container.llm` throws when the provider's key is missing, and both callers
 * want that: a review that cannot reach a model must fail loudly rather than
 * quietly produce nothing. The cast is the one thing worth having in a single
 * place — `AgentRow.provider` is a `text` column, and the two call sites must
 * not disagree about what it is narrowed to.
 */
export function resolveAgentProvider(
  container: Container,
  provider: string,
): Promise<LLMProvider> {
  return container.llm(provider as Provider);
}

/**
 * The agent's linked skills, resolved to prompt blocks.
 *
 * A skill must be linked to the agent AND enabled globally. Turning a skill off
 * therefore removes it from every agent at once, without touching anyone's link
 * list.
 *
 * Returns `undefined` when nothing survives, so the spread at the call site adds
 * no key and the prompt stays byte-identical to the pre-L02 shape. Any failure
 * degrades to `undefined` for the same reason the repo-intel builders do: an
 * enrichment must never be able to fail a review.
 */
export async function buildSkillBlocks(
  container: Container,
  agentId: string,
  progress?: InputProgress,
): Promise<string[] | undefined> {
  try {
    const links = await container.agentsRepo.linkedSkills(agentId);
    if (links.length === 0) return undefined;

    const enabled = links.map((l) => l.skill).filter((s) => s.enabled);
    const offCount = links.length - enabled.length;
    if (enabled.length === 0) {
      progress?.info(`skills: ${offCount} linked skill(s) are disabled — no skills block`);
      return undefined;
    }

    const { blocks, included, dropped } = renderSkillBlocks(enabled);
    if (blocks.length === 0) return undefined;

    const tokens = container.tokenizer.count(blocks.join('\n\n'));
    progress?.info(
      `skills: ${blocks.length} skill(s), ${tokens} token(s) attached (${included.join(', ')})`,
    );
    // Never let a budget cut be invisible — a silently shortened prompt reads as
    // "the model ignored my rule".
    if (dropped.length > 0) {
      progress?.info(`skills: dropped over budget — ${dropped.join(', ')}`);
    }
    if (offCount > 0) progress?.info(`skills: ${offCount} linked skill(s) skipped (disabled)`);
    return blocks;
  } catch (err) {
    progress?.info(`skills: resolution failed — ${(err as Error).message}`);
    return undefined;
  }
}
