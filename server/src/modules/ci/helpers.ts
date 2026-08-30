import type { CiFile } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { MANIFEST_DIR, RUNNER_DIR, RUNNER_FILES, SKILLS_DIR, WORKFLOW_PATH } from './constants.js';

/**
 * Pure assembly of the CI bundle. No clock, no database, no filesystem — the
 * disk read that produces `runnerSizes` is `service.ts`'s, deliberately, so this
 * list stays a function of its arguments and can be asserted from a fixture.
 */

/** One of the three files `ncc` emits into `agent-runner/dist/`. */
export type RunnerFileName = (typeof RUNNER_FILES)[number];

/** Byte size of each runner file, measured from disk by the service. */
export type RunnerFileSizes = Readonly<Record<RunnerFileName, number>>;

/**
 * Kebab-case of a skill's name.
 *
 * The `skills` table has no slug column (`db/schema/skills.ts:10`), so the slug
 * the runner resolves to `.devdigest/skills/<slug>.md` is derived here and
 * nowhere else. Derivation is lossy — two different names can collapse onto one
 * slug — which is what `assertUniqueSlugs` exists to catch.
 */
export function skillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Refuse the export when two attached skills collapse onto one slug.
 *
 * The message names BOTH skills, because the user's only fix is to rename one
 * of them and a message naming a slug does not say which rows produced it.
 * Refusing is the honest answer: silently overwriting would ship a bundle whose
 * skill file is not what the Preview showed.
 */
export function assertUniqueSlugs(skills: readonly { name: string }[]): void {
  const seen = new Map<string, string>();
  for (const skill of skills) {
    const slug = skillSlug(skill.name);
    const previous = seen.get(slug);
    if (previous !== undefined) {
      throw new AppError(
        'ci_slug_collision',
        `Skills "${previous}" and "${skill.name}" both resolve to the slug "${slug}". ` +
          'Rename one of them before exporting to CI.',
        400,
      );
    }
    seen.set(slug, skill.name);
  }
}

/** A skill as it is written into the bundle: its slug and its resolved body. */
export interface BundleSkill {
  slug: string;
  body: string;
}

export interface BundleFilesInput {
  /** Slug of the agent — the manifest lands at `.devdigest/agents/<slug>.yaml`. */
  agentSlug: string;
  manifestYaml: string;
  skills: readonly BundleSkill[];
  workflowYaml: string;
  runnerSizes: RunnerFileSizes;
}

/**
 * The whole bundle, in the order the Preview renders it: manifest, one file per
 * skill, the workflow, then the three runner files.
 *
 * The runner entries carry a path and a byte count with EMPTY contents. That is
 * the NFR "runner bundle bytes crossing the API: 0" — 1.6 MB per preview in the
 * client's query cache buys nothing, since the bytes are copied from disk to
 * `commitFiles` without the client ever seeing them.
 *
 * Every file is `editable: false`: an editable Preview means round-tripping user
 * text back through generation, which this pass does not do.
 */
export function bundleFiles(input: BundleFilesInput): CiFile[] {
  const files: CiFile[] = [
    {
      path: `${MANIFEST_DIR}/${input.agentSlug}.yaml`,
      contents: input.manifestYaml,
      editable: false,
    },
    ...input.skills.map((skill) => ({
      path: `${SKILLS_DIR}/${skill.slug}.md`,
      contents: skill.body,
      editable: false,
    })),
    { path: WORKFLOW_PATH, contents: input.workflowYaml, editable: false },
  ];

  for (const name of RUNNER_FILES) {
    files.push({
      path: `${RUNNER_DIR}/${name}`,
      contents: '',
      editable: false,
      bytes: input.runnerSizes[name],
    });
  }

  return files;
}
