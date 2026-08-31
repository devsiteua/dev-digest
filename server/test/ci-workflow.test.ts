import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildWorkflowYaml } from '../src/modules/ci/workflow.js';
import {
  ACTION_UPLOAD_ARTIFACT,
  CI_TRIGGERS,
  RESULT_ARTIFACT_FILE,
  RUNNER_ENTRY,
} from '../src/modules/ci/constants.js';

/**
 * L07-B — the workflow the studio writes into somebody ELSE's repository.
 *
 * Every assertion here is a security property that has no second line of
 * defence: once the pull request is merged, this file runs in a repository we do
 * not own, with that repository's secrets, on input its contributors control.
 * Nothing downstream re-checks the permissions block, the pinning, or the
 * trigger — so the generator is the only place it can be checked at all.
 *
 * Assertions are made over `YAML.parse` of the output wherever the criterion is
 * about a VALUE (a permission, an `if:`, an env var), and over the raw text
 * wherever it is about a string that must not exist anywhere in the file at all
 * (`pull_request_target`, a marketplace action, a key). A parse cannot prove an
 * absence in a comment; raw text cannot prove a mapping has exactly two entries.
 */

interface WorkflowStep {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  'continue-on-error'?: boolean;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface WorkflowJob {
  name?: string;
  'runs-on': string;
  if?: string;
  steps: WorkflowStep[];
}

interface Workflow {
  name: string;
  on: Record<string, { types?: string[] } | null>;
  permissions: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

interface BuildOptions {
  triggers?: readonly string[];
  postAs?: 'github_review' | 'pr_comment' | 'none';
}

/** The everyday selection: all three activity types, publish as a review. */
function build(options: BuildOptions = {}): string {
  return buildWorkflowYaml({
    triggers: options.triggers ?? [...CI_TRIGGERS],
    postAs: options.postAs ?? 'github_review',
  });
}

function parsed(options: BuildOptions = {}): Workflow {
  return parseYaml(build(options)) as Workflow;
}

/**
 * Readers that THROW rather than return undefined.
 *
 * A missing step must fail as "there is no upload step" and not three lines
 * later as "cannot read property `if` of undefined" — a criterion about a step
 * that vanished should name the step.
 */
function reviewJob(workflow: Workflow): WorkflowJob {
  const job = workflow.jobs?.review;
  if (!job) throw new Error(`no "review" job in the generated workflow`);
  return job;
}

function stepNamed(workflow: Workflow, name: string): WorkflowStep {
  const step = reviewJob(workflow).steps.find((s) => s.name === name);
  if (!step) throw new Error(`no step named "${name}" in the generated workflow`);
  return step;
}

function stepWithId(workflow: Workflow, id: string): WorkflowStep {
  const step = reviewJob(workflow).steps.find((s) => s.id === id);
  if (!step) throw new Error(`no step with id "${id}" in the generated workflow`);
  return step;
}

/** Every `uses:` line in the file, read as text so a step we never parsed still counts. */
function usesLines(yaml: string): string[] {
  return yaml
    .split('\n')
    .map((line) => /^\s*uses:\s*(\S+)\s*$/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined);
}

describe('the generated GitHub Actions workflow', () => {
  it('declares exactly two permissions — contents read, pull-requests write (AC-06)', () => {
    const workflow = parsed();

    expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    // Stated separately from `toEqual` because it is the criterion: everything
    // not listed is `none`, and a third entry is a widened token.
    expect(Object.keys(workflow.permissions)).toHaveLength(2);
  });

  it('runs the committed bundle and names no marketplace action (AC-07)', () => {
    const yaml = build();
    const review = stepWithId(parsed(), 'review');

    const commands = (review.run ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    // The review is a `run:` of the bundle we committed, not a `uses:` of
    // something fetched at job time.
    expect(review.uses).toBeUndefined();
    expect(RUNNER_ENTRY).toBe('.devdigest/runner/index.js');
    expect(commands[0]).toMatch(/^node \.devdigest\/runner\/index\.js(\s|$)/);
    expect(yaml).not.toContain('devdigest/review-action');
  });

  it('pins every `uses:` to a full 40-character commit SHA (AC-08)', () => {
    const yaml = build();
    const fromText = usesLines(yaml);
    const fromSteps = reviewJob(parsed())
      .steps.map((step) => step.uses)
      .filter((value): value is string => value !== undefined);

    // Read both ways so neither can hide an action from the other.
    expect(fromText).toEqual(fromSteps);
    expect(fromText.length).toBeGreaterThan(0);
    for (const action of fromText) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('triggers on `pull_request` alone and never on `pull_request_target` (AC-09)', () => {
    const yaml = build();

    expect(Object.keys(parseYaml(yaml).on as Record<string, unknown>)).toEqual(['pull_request']);
    // Raw text, not the parse: the string must not appear in a comment either,
    // where a later editor would read it as a suggestion.
    expect(yaml).not.toContain('pull_request_target');
  });

  it('skips the job for a pull request from a fork (AC-11)', () => {
    const condition = reviewJob(parsed()).if ?? '';

    expect(condition).toContain('github.event.pull_request.head.repo.full_name');
    expect(condition).toContain('github.repository');
    expect(condition).toBe(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
  });

  it.each([
    { triggers: ['opened', 'synchronize', 'reopened'], types: ['opened', 'synchronize', 'reopened'], postAs: 'github_review' as const },
    { triggers: ['reopened', 'opened'], types: ['opened', 'reopened'], postAs: 'pr_comment' as const },
    { triggers: ['synchronize'], types: ['synchronize'], postAs: 'none' as const },
  ])(
    'carries the Configure choice into the file: $types / $postAs (AC-12)',
    ({ triggers, types, postAs }) => {
      const workflow = parsed({ triggers, postAs });

      expect(workflow.on.pull_request?.types).toEqual(types);
      expect(stepWithId(workflow, 'review').env?.DEVDIGEST_POST_AS).toBe(postAs);
    },
  );

  it('sends the result only where the ingest URL is set, and never reddens the job (AC-13)', () => {
    const step = stepNamed(parsed(), 'Report the result to DevDigest');

    expect(step['continue-on-error']).toBe(true);
    // The condition reads the MAPPED env var. `secrets` is not available in an
    // `if:`, so a condition naming it would be silently false forever.
    expect(step.if).toBe("always() && env.INGEST_URL != ''");
    expect(step.if).not.toContain('secrets.');
    expect(step.env?.INGEST_URL).toBe('${{ secrets.DEVDIGEST_INGEST_URL }}');
  });

  it('uploads the result artifact whatever the review decided (AC-32)', () => {
    const step = stepNamed(parsed(), 'Upload the review result');

    expect(step.uses).toBe(ACTION_UPLOAD_ARTIFACT);
    expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    expect(step.with?.path).toBe(RESULT_ARTIFACT_FILE);
    // `always()` and nothing else: an `if:` that consulted the review step's
    // outcome would drop the artifact for exactly the runs worth keeping.
    expect(step.if).toBe('always()');
    expect(step.if).not.toContain('review');
    expect(step.if).not.toContain('success');
    expect(step.if).not.toContain('failure');
  });

  it('references the model key and never carries its value (AC-10, files half)', () => {
    const yaml = build();

    expect(stepWithId(parsed(), 'review').env?.OPENROUTER_API_KEY).toBe(
      '${{ secrets.OPENROUTER_API_KEY }}',
    );
    // Trivially true because the generator is handed no secret at all — which is
    // the property, not an accident. A generator that took one as an argument
    // would fail here the first time somebody interpolated it.
    expect(yaml).not.toContain('sk-');
  });
});
