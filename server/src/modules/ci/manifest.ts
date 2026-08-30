import { stringify as stringifyYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { AgentRow, SkillRow } from '../../db/rows.js';
import { skillSlug, type BundleSkill } from './helpers.js';

/**
 * The two files the runner READS: `.devdigest/agents/<slug>.yaml` and one
 * `.devdigest/skills/<slug>.md` per attached skill.
 *
 * Both ends of that contract are `AgentManifest` — the studio writes it here,
 * `agent-runner/src/manifest.ts` parses it with the same Zod schema — so the
 * manifest is VALIDATED here rather than merely serialized. A manifest that
 * cannot be parsed is a bundle that fails in someone else's CI, where the error
 * is far more expensive to read.
 */

/** The agent columns the manifest is built from. */
export type ManifestAgent = Pick<
  AgentRow,
  'name' | 'provider' | 'model' | 'systemPrompt' | 'strategy' | 'ciFailOn'
>;

/** The skill columns the bundle is built from. */
export type ManifestSkill = Pick<SkillRow, 'name' | 'body' | 'source'>;

/** Kebab-case slug of the agent — the manifest's own filename. */
export function agentSlug(agent: Pick<ManifestAgent, 'name'>): string {
  return skillSlug(agent.name);
}

/**
 * Build and validate the manifest, then serialize it to YAML.
 *
 * `skills` are the slugs, in the user's stated order — the runner resolves each
 * one to `.devdigest/skills/<slug>.md` and hands the bodies to the same engine
 * the studio uses, so the order here is the order the prompt sees.
 */
export function buildManifestYaml(agent: ManifestAgent, skillSlugs: readonly string[]): string {
  const manifest = AgentManifest.parse({
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: [...skillSlugs],
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
  });
  return stringifyYaml(manifest);
}

/**
 * One bundle file per attached skill, in order.
 *
 * The trust branch is the SAME one `renderSkillBlocks` applies when the studio
 * assembles a prompt (`modules/reviews/helpers.ts`): a `manual` body is the
 * user's own text and goes in verbatim, anything else is third-party text and is
 * delimiter-wrapped as `skill:<name>`. It is re-implemented rather than imported
 * because a module never imports a sibling module (`no-cross-module-import`).
 *
 * Wrapping has to happen HERE, at write time, and not in the runner: the runner
 * reads bodies off disk with no provenance at all (`agent-runner/src/skills.ts`),
 * so a body that leaves this function unwrapped can never be wrapped again.
 */
export function buildSkillFiles(skills: readonly ManifestSkill[]): BundleSkill[] {
  return skills.map((skill) => ({
    slug: skillSlug(skill.name),
    body: skill.source === 'manual' ? skill.body : wrapUntrusted(`skill:${skill.name}`, skill.body),
  }));
}
