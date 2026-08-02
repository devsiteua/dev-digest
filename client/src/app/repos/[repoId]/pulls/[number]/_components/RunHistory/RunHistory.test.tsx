/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(
  runs: RunSummary[],
  severityByRun?: React.ComponentProps<typeof RunHistory>["severityByRun"],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} severityByRun={severityByRun} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — severity counters", () => {
  it("replaces the plain finding count with per-severity counters, keeping the blockers suffix", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 2, score: 38 })], {
      "run-1": { critical: 2, warning: 1, suggestion: 0 },
    });
    expect(screen.queryByText(/3 finding/)).not.toBeInTheDocument();
    expect(screen.getByTitle("2 critical · 1 warning · 0 suggestion")).toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("hides zero severities on the timeline", () => {
    const { container } = renderRuns(
      [run({ status: "done", findings_count: 2, blockers: 0, score: 64 })],
      { "run-1": { critical: 0, warning: 1, suggestion: 1 } },
    );
    // Two non-zero severities → two badge icons, plus the row's own Cpu/FileText
    // chrome; the assertion that matters is that no "0" count is rendered.
    expect(container).not.toHaveTextContent("💡 0");
    expect(screen.getByTitle("0 critical · 1 warning · 1 suggestion")).toBeInTheDocument();
  });

  it("falls back to the finding count when the run has no review to count", () => {
    // Deleting a review removes its findings; a breakdown of them would describe
    // nothing, so the row keeps the denormalized count on the run row.
    renderRuns([run({ status: "done", findings_count: 4, blockers: 2, score: 38 })], {});
    expect(screen.getByText(/4 finding/)).toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("shows no counters at all for a run that has not settled", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })], {
      "run-1": { critical: 9, warning: 9, suggestion: 9 },
    });
    expect(screen.queryByTitle(/critical ·/)).not.toBeInTheDocument();
  });
});
