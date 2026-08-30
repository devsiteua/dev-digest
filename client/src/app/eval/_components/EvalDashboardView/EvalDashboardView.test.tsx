/**
 * The Eval Dashboard: three metric labels, the runs behind them, and the two
 * empty states a real workspace starts in.
 *
 * The first test is the one that matters most. On a hermetic stack — and on any
 * workspace before its first run — every denominator is 0 and the stored metric
 * is the vacuous `1` the contract forces. The page must show `—`, because a
 * dashboard whose entire premise is trustworthy numbers cannot open on three
 * fabricated 100%s.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

const { dashboard } = vi.hoisted(() => ({
  dashboard: { data: null as EvalDashboard | null, isLoading: false, isError: false },
}));

vi.mock("../../../../lib/hooks/evals", () => ({
  useEvalDashboard: () => ({ ...dashboard, refetch: vi.fn() }),
}));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { EvalDashboardView } from "./EvalDashboardView";

const EMPTY: EvalDashboard = {
  owner_kind: null,
  owner_id: null,
  cases_total: 8,
  current: {
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    recall_denominator: 0,
    precision_denominator: 0,
    citation_denominator: 0,
    traces_passed: 0,
    traces_total: 0,
    cost_usd: null,
  },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  recent_runs: [],
  alert: null,
};

const POPULATED: EvalDashboard = {
  ...EMPTY,
  current: {
    recall: 0.5,
    precision: 0.25,
    citation_accuracy: 1,
    recall_denominator: 8,
    precision_denominator: 12,
    citation_denominator: 12,
    traces_passed: 4,
    traces_total: 8,
    cost_usd: 0.04,
  },
  delta: { recall: -0.2, precision: 0.1, citation_accuracy: 0 },
  recent_runs: [
    {
      id: "r1",
      batch_id: "b1",
      case_id: "c1",
      case_name: "Hardcoded Stripe secret key in commit",
      ran_at: "2026-08-30T10:00:00.000Z",
      actual_output: null,
      status: "passed",
      error: null,
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      matched_count: 1,
      expected_count: 1,
    reported_count: 3,
    precision_denominator: 1,
      duration_ms: 1200,
      cost_usd: 0.005,
    },
    {
      id: "r2",
      batch_id: "b1",
      case_id: "c2",
      case_name: "The limiter runs twice on /api/public",
      ran_at: "2026-08-30T10:00:00.000Z",
      actual_output: null,
      status: "errored",
      error: "provider stalled",
      pass: null,
      recall: null,
      precision: null,
      citation_accuracy: null,
      matched_count: null,
      expected_count: null,
    reported_count: null,
    precision_denominator: null,
      duration_ms: 90,
      cost_usd: null,
    },
  ],
};

afterEach(() => {
  cleanup();
  dashboard.data = null;
  dashboard.isLoading = false;
  dashboard.isError = false;
});

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );

describe("EvalDashboardView (AC-23)", () => {
  it("renders the three metric labels", () => {
    dashboard.data = EMPTY;
    renderPage();
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
  });

  it("AC-21: shows — for all three on a workspace where nothing has run", () => {
    dashboard.data = EMPTY;
    renderPage();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("AC-21: a vacuous 1 next to a non-empty traces_total still renders —", () => {
    // The case the empty-workspace test cannot reach, and the one this screen
    // got wrong: eight cases RAN, so `traces_total` is 8 and any guard keyed on
    // it passes — but every case came from a dismissed finding, so the set
    // asserts no `must_find` expectation at all and recall's own denominator is
    // 0. The stored `1` is the contract refusing to carry null, not a result.
    dashboard.data = {
      ...POPULATED,
      current: {
        ...POPULATED.current,
        recall: 1,
        recall_denominator: 0,
        traces_passed: 8,
        traces_total: 8,
      },
    };
    renderPage();

    const recall = document.querySelector('[data-metric="RECALL"]') as HTMLElement;
    expect(within(recall).getByText("—")).toBeInTheDocument();
    expect(within(recall).queryByText("100%")).not.toBeInTheDocument();

    // and the metrics that DO have a denominator are still shown
    const precision = document.querySelector('[data-metric="PRECISION"]') as HTMLElement;
    expect(within(precision).queryByText("—")).not.toBeInTheDocument();
  });

  it("AC-21: a must_not_flag row shows — for recall, not the 100% it never asserted", () => {
    // Same lie one level down, in a table cell: the row is `passed`, its recall
    // is the stored 1, and only `expected_count: 0` says the case asserted
    // nothing about recall.
    dashboard.data = {
      ...POPULATED,
      recent_runs: [
        {
          ...POPULATED.recent_runs[0]!,
          recall: 1,
          matched_count: 0,
          expected_count: 0,
          reported_count: 0,
          precision_denominator: 0,
        },
      ],
    };
    renderPage();

    const row = document.querySelector('[data-run-id]') as HTMLElement;
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(row).queryByText("100%")).not.toBeInTheDocument();
  });

  it("says so when there are no runs, instead of an empty table", () => {
    dashboard.data = EMPTY;
    renderPage();
    expect(
      screen.getByText(/No run has happened yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ran at")).not.toBeInTheDocument();
  });

  it("counts the workspace's cases even before anything has run", () => {
    dashboard.data = EMPTY;
    renderPage();
    expect(screen.getByText("8 eval cases")).toBeInTheDocument();
  });

  it("renders the metrics and the recent-runs table on a populated workspace", () => {
    dashboard.data = POPULATED;
    renderPage();

    const recall = document.querySelector('[data-metric="RECALL"]') as HTMLElement;
    expect(within(recall).getByText("50%")).toBeInTheDocument();
    expect(within(recall).getByText("-20")).toBeInTheDocument();

    expect(screen.getByText("Ran at")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
  });

  it("an errored case shows — for every metric, not a zero it never measured", () => {
    dashboard.data = POPULATED;
    renderPage();
    const row = document.querySelector('[data-run-id="r2"]') as HTMLElement;
    expect(within(row).getAllByText("—")).toHaveLength(4); // three metrics + cost
    expect(within(row).getByText("errored")).toBeInTheDocument();
  });

  it("does not build the trend chart or the alert banner — both out of scope", () => {
    dashboard.data = POPULATED;
    renderPage();
    expect(screen.queryByText(/Metric trend/i)).not.toBeInTheDocument();
    expect(document.querySelector("svg polyline")).toBeNull();
  });
});
