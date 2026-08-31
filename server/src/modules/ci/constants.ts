/**
 * Every literal the Export-to-CI feature decides with.
 *
 * Two of them are load-bearing in a way the call site cannot show:
 *
 * - `RUNNER_FILES` is the ONE list of what `ncc` emits into `agent-runner/dist/`.
 *   Three rules read it — the refusal when the bundle is absent, the Preview's
 *   file list, and the payload handed to `commitFiles` — and the only way those
 *   three can ever disagree is if someone re-types the names.
 * - `RUNNER_VERSION` is DUPLICATED from `agent-runner/src/artifact.ts`, on
 *   purpose. No tsconfig path alias exposes `agent-runner` to this package, and
 *   adding one would either break the dependency rule or drag a package this
 *   feature must not touch into the graph. `server/test/ci-runner-version.test.ts`
 *   reads that file as TEXT and asserts the two literals still agree — the only
 *   guard against this duplication drifting silently.
 */

/** Mirrors `RUNNER_VERSION` in `agent-runner/src/artifact.ts`. */
export const RUNNER_VERSION = '1';

/** Branch the generated bundle is committed onto in the target repository. */
export const CI_BRANCH = 'devdigest/ci';

/** Directory in the target repository that holds the bundled runner. */
export const RUNNER_DIR = '.devdigest/runner';

/**
 * The command the generated workflow runs. The workflow's `run:` line and the
 * assertion that it is not a marketplace action both read this one string.
 */
export const RUNNER_ENTRY = `${RUNNER_DIR}/index.js`;

/**
 * The three files `ncc` emits. `300.index.js` is a lazily-imported chunk
 * (reached only from `openai`'s `fileFromPath` shim) and `package.json` is the
 * 23-byte `{"type": "module"}` that scopes the ESM module type to this
 * directory — without it the bundle dies in any repository declaring
 * `"type": "commonjs"`.
 */
export const RUNNER_FILES = ['index.js', '300.index.js', 'package.json'] as const;

/** Path of the generated workflow inside the TARGET repository. */
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

/** Refuse to export a bundle larger than this. Today's three files total ~1.6 MB. */
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

/** Cap on the CI Runs list — a capped list instead of pagination. */
export const CI_RUNS_LIMIT = 50;

/*
 * External actions, pinned to a commit SHA rather than a tag.
 *
 * A tag is mutable; a SHA is what the target repository's reviewer is actually
 * approving. Each was resolved on 2026-08-30 with
 * `gh api repos/<action>/git/ref/tags/<tag>` and dereferences to an object of
 * type `commit`. The tag beside each one is what makes the pin auditable later.
 */

/** actions/checkout v7.0.1 */
export const ACTION_CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
/** actions/setup-node v7.0.0 */
export const ACTION_SETUP_NODE = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';
/** actions/upload-artifact v7.0.1 */
export const ACTION_UPLOAD_ARTIFACT =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

/** Node major the runner bundle is built and tested against. */
export const RUNNER_NODE_VERSION = '22';

/** Artifact the runner writes and the workflow uploads. */
export const RESULT_ARTIFACT_FILE = 'devdigest-result.json';

/** Directory in the target repository holding the checked-in agent manifest. */
export const MANIFEST_DIR = '.devdigest/agents';

/** Directory in the target repository holding the checked-in skill bodies. */
export const SKILLS_DIR = '.devdigest/skills';

/**
 * The only `pull_request` activity types the wizard offers, and the only ones
 * the generated workflow will emit.
 *
 * `CiExportInput.triggers` is `z.array(z.string())`, so the contract cannot
 * enforce this — `buildWorkflowYaml` does, which also means no user-controlled
 * string is ever concatenated into the generated YAML.
 */
export const CI_TRIGGERS = ['opened', 'synchronize', 'reopened'] as const;

/**
 * Body ceiling for `POST /ci/ingest`. The app-wide limit is 1 MB (`app.ts`); an
 * artifact is a handful of counters and a job URL, and this is the one route a
 * caller reaches with a shared token rather than a session.
 */
export const CI_INGEST_BODY_LIMIT = 65_536;

/**
 * Shortest `DEVDIGEST_CI_TOKEN` that counts as configured. Anything shorter is
 * treated as unset, so a placeholder value fails closed rather than becoming a
 * guessable password.
 */
export const MIN_CI_TOKEN_LENGTH = 32;
