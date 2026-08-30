/**
 * How a run status renders. The engine writes exactly these three — a run with
 * no findings, then the runner's own exit code — so anything else is shown
 * verbatim rather than given a colour it did not earn.
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

/**
 * The columns, in order. Labels resolve under `ci.runs.table`; the last column
 * holds the link to the Actions job and is deliberately unlabelled.
 */
export const COLUMN_KEYS: readonly string[] = [
  "timestamp",
  "repository",
  "pullRequest",
  "agent",
  "source",
  "duration",
  "findings",
  "cost",
  "status",
];

/** One grid definition for the header and every row, so they cannot drift. */
export const GRID_COLUMNS = "150px 160px 80px 130px 90px 60px 80px 70px 110px 80px";
