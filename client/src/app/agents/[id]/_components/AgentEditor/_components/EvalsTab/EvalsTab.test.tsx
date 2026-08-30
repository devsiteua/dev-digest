/**
 * The Evals tab: the case set, the runs over it, and the two places a number is
 * refused rather than invented.
 *
 * Interaction is driven with `fireEvent` — this package does not ship
 * `@testing-library/user-event` (`client/INSIGHTS.md`, 2026-08-22) — and the
 * disabled cases assert the ATTRIBUTE rather than "the click did nothing":
 * `fireEvent` will happily click a disabled button, so the weaker assertion
 * would pass on a fully enabled control wired to nothing.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalRunBatch } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";

const { startRun, deleteCase, cases, runs } = vi.hoisted(() => ({
  startRun: vi.fn(),
  deleteCase: vi.fn(),
  cases: { value: [] as EvalCase[], isLoading: false },
  runs: { value: [] as EvalRunBatch[] },
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: cases.value, isLoading: cases.isLoading }),
  useEvalRuns: () => ({ data: runs.value, isLoading: false }),
  useStartEvalRun: () => ({ mutate: startRun, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: deleteCase, isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

const AGENT = { id: "ag1", name: "General Reviewer" } as Agent;

const CASE: EvalCase = {
  id: "c1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "Hardcoded Stripe secret key in commit",
  input_diff: "diff --git a/src/config.ts b/src/config.ts",
  input_files: null,
  input_meta: { source_finding_id: "f1", pr_id: "p1", pr_number: 482, created_from: "finding" },
  expected_output: { kind: "must_find", file: "src/config.ts", start_line: 12, end_line: 12 },
  notes: null,
};

const BATCH = (over: Partial<EvalRunBatch> = {}): EvalRunBatch => ({
  id: "b1",
  workspace_id: "w1",
  agent_id: "ag1",
  agent_version: 3,
  system_prompt_snapshot: "p",
  model_snapshot: "m",
  provider_snapshot: "openrouter",
  status: "done",
  started_at: "2026-08-30T10:00:00.000Z",
  finished_at: "2026-08-30T10:04:00.000Z",
  recall: 0.5,
  precision: 0.25,
  citation_accuracy: 1,
  recall_denominator: 4,
  precision_denominator: 8,
  citation_denominator: 8,
  cases_total: 8,
  cases_ran: 8,
  duration_ms: 240_000,
  cost_usd: 0.04,
  error: null,
  ...over,
});

afterEach(() => {
  cleanup();
  cases.value = [];
  cases.isLoading = false;
  runs.value = [];
  startRun.mockClear();
  deleteCase.mockClear();
});

const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );

describe("EvalsTab — the case set (AC-22)", () => {
  it("lists each case with its name, source location and expectation", () => {
    cases.value = [CASE];
    renderTab();

    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("must find")).toBeInTheDocument();
  });

  it("shows a must_not_flag case as such", () => {
    cases.value = [
      {
        ...CASE,
        id: "c2",
        expected_output: { kind: "must_not_flag", file: "src/api/users.ts", start_line: 45, end_line: 52 },
      },
    ];
    renderTab();
    expect(screen.getByText("must not flag")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
  });

  it("offers Delete and no per-case Run or Edit — both are out of scope", () => {
    cases.value = [CASE];
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /Delete Hardcoded Stripe/i }));
    expect(deleteCase).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("button", { name: /^Edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Run case/i })).not.toBeInTheDocument();
  });

  it("shows an empty state rather than an empty list", () => {
    renderTab();
    expect(
      screen.getByText(/Accept or dismiss a finding on a pull request/i),
    ).toBeInTheDocument();
  });
});

describe("EvalsTab — Run all (AC-12)", () => {
  it("is disabled on an empty set, and says why", () => {
    renderTab();
    const btn = screen.getByRole("button", { name: /Run all/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Add at least one eval case before running.");
  });

  it("is enabled once the set has a case", () => {
    cases.value = [CASE];
    renderTab();
    const btn = screen.getByRole("button", { name: /Run all/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("is disabled with a different reason while a run is already in flight", () => {
    cases.value = [CASE];
    runs.value = [BATCH({ status: "running", recall: null, precision: null, citation_accuracy: null })];
    renderTab();
    const btn = screen.getByRole("button", { name: /Run all/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "A run is already in flight for this agent.");
  });
});

describe("EvalsTab — the run history (AC-21, AC-25)", () => {
  it("renders each run's three metrics as percentages", () => {
    cases.value = [CASE];
    runs.value = [BATCH()];
    renderTab();

    const row = document.querySelector('[data-batch-id="b1"]') as HTMLElement;
    expect(within(row).getByText("50%")).toBeInTheDocument();
    expect(within(row).getByText("25%")).toBeInTheDocument();
    expect(within(row).getByText("100%")).toBeInTheDocument();
    expect(within(row).getByText("v3")).toBeInTheDocument();
  });

  /**
   * AC-21, the case this whole component exists for. The stored value is the
   * vacuous `1` the contract forces on an empty denominator; rendering it the
   * way the design's cards do — `Math.round(1 * 100)` — would print a confident
   * 100% for a set that asserted nothing.
   */
  it("renders — for a metric whose denominator is 0, never 100%", () => {
    cases.value = [CASE];
    runs.value = [BATCH({ recall: 1, recall_denominator: 0 })];
    renderTab();

    const card = document.querySelector('[data-metric="RECALL"]') as HTMLElement;
    expect(within(card).getByText("—")).toBeInTheDocument();
    expect(within(card).queryByText("100%")).not.toBeInTheDocument();
    expect(card.querySelector('[data-empty="true"]')).toHaveAttribute(
      "title",
      "No recall has been measured yet — this run's denominator is 0.",
    );
  });

  it("renders — while a run is still going, rather than a number it does not have", () => {
    cases.value = [CASE];
    runs.value = [
      BATCH({
        status: "running",
        recall: null,
        precision: null,
        citation_accuracy: null,
        recall_denominator: 0,
        precision_denominator: 0,
        citation_denominator: 0,
      }),
    ];
    renderTab();
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("AC-25: an incomplete run is marked beside its metrics", () => {
    cases.value = [CASE];
    runs.value = [BATCH({ status: "partial", cases_ran: 7, cases_total: 8 })];
    renderTab();
    expect(screen.getByText("7/8 cases ran")).toBeInTheDocument();
    expect(screen.getByText("incomplete")).toBeInTheDocument();
  });

  it("offers a compare link on every run except the oldest", () => {
    cases.value = [CASE];
    runs.value = [BATCH({ id: "newer" }), BATCH({ id: "older" })];
    renderTab();

    const links = screen.getAllByRole("link", { name: /Compare with the run before it/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/eval/compare?a=older&b=newer");
  });

  it("says so when nothing has ever run, instead of showing an empty table", () => {
    cases.value = [CASE];
    renderTab();
    expect(screen.getByText("This agent's cases have never been run.")).toBeInTheDocument();
  });
});
