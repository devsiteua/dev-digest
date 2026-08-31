import type { IconName } from "@devdigest/ui";
import type { CiExportInput, CiTarget } from "@devdigest/shared";

/** How results are posted back on the reviewed pull request. */
export type PostAs = CiExportInput["post_as"];

/** The wizard's four steps; labels resolve under `ci.exportWizard.steps`. */
export const STEP_KEYS = ["target", "preview", "configure", "install"] as const;

/**
 * CI targets with a generator behind them.
 *
 * One entry, and that is the criterion rather than an omission: CircleCI,
 * Jenkins and the generic CLI have no generator in this pass, and a disabled
 * card offers an installation that cannot happen (AC-02).
 */
export const CI_TARGETS: readonly {
  key: CiTarget;
  labelKey: string;
  descKey: string;
  icon: IconName;
  recommended: boolean;
}[] = [
  {
    key: "gha",
    labelKey: "targets.gha",
    descKey: "targets.ghaDesc",
    icon: "Workflow",
    recommended: true,
  },
];

/** The three `pull_request` events the generated workflow may subscribe to. */
export const TRIGGER_EVENTS = ["opened", "synchronize", "reopened"] as const;

/** Checked when the wizard opens — a reopened PR rarely needs a fresh review. */
export const DEFAULT_TRIGGERS: readonly string[] = ["opened", "synchronize"];

/** The three publish modes the runner understands, in the order it lists them. */
export const POST_AS_VALUES: readonly PostAs[] = ["github_review", "pr_comment", "none"];

/** Label key per publish mode, under `ci.exportWizard.postAs`. */
export const POST_AS_LABEL_KEYS: Record<PostAs, string> = {
  github_review: "postAs.githubReview",
  pr_comment: "postAs.prComment",
  none: "postAs.none",
};

/** Secret names the generated workflow reads, and what each one is for. */
export const EXPECTED_SECRETS: readonly { name: string; noteKey: string }[] = [
  { name: "OPENROUTER_API_KEY", noteKey: "secrets.openrouter" },
  { name: "GITHUB_TOKEN", noteKey: "secrets.githubToken" },
  { name: "DEVDIGEST_INGEST_URL", noteKey: "secrets.ingestUrl" },
];

/** Everything under this prefix is listed by path and byte size, never shown. */
export const RUNNER_DIR = ".devdigest/runner";

/**
 * The file Preview opens on: the `permissions` block is exactly what the
 * reviewer of the generated pull request is being asked to approve.
 */
export const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";

/**
 * Engine error codes that mean "the local runner build is unusable".
 * They get the `pnpm build` sentence; everything else is a GitHub failure.
 */
export const BUNDLE_ERROR_CODES: readonly string[] = [
  "ci_runner_bundle_missing",
  "ci_runner_bundle_too_large",
];
