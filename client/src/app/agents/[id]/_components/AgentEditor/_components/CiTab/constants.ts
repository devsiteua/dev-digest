import type { CiFailOn } from "@devdigest/shared";

/**
 * The CI gate options, listed rather than read off `CiFailOn.options`: the
 * vendored contracts are a TYPE-only copy here — their barrel imports
 * `./contracts/*.js`, which webpack cannot resolve — so a value import from
 * `@devdigest/shared` breaks `next build` while `tsc` and vitest stay green.
 * The list is checked against the enum by the type annotation.
 */
export const CI_FAIL_ON_VALUES: readonly CiFailOn[] = [
  "never",
  "critical",
  "warning",
  "any",
];

/**
 * How a run status renders. The engine writes exactly these three
 * (`no_findings` when nothing was found, then the runner's own exit code), so
 * anything else is shown verbatim rather than mapped to a colour it did not earn.
 */
export const RUN_STATUS: Record<string, { labelKey: string; color: string; bg: string }> = {
  succeeded: { labelKey: "succeeded", color: "var(--ok)", bg: "var(--ok-bg)" },
  no_findings: {
    labelKey: "noFindings",
    color: "var(--text-secondary)",
    bg: "var(--bg-hover)",
  },
  failed: { labelKey: "failed", color: "var(--crit)", bg: "var(--crit-bg)" },
};

/** How many of this agent's runs the tab lists. The engine caps the read too. */
export const TAB_RUNS_SHOWN = 5;
