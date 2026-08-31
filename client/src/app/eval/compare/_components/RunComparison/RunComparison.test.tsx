/**
 * Two runs side by side.
 *
 * The cases worth writing are the ones an artboard would not have told us
 * about: a delta refusing to be a number when one side measured nothing, and a
 * `partial` batch saying so beside its metrics rather than in a footnote.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRunBatch, EvalRunComparison } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";

const { comparison, params } = vi.hoisted(() => ({
  comparison: { data: null as EvalRunComparison | null, isLoading: false, isError: false },
  params: { value: new URLSearchParams("a=b1&b=b2") },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => params.value,
}));
vi.mock("../../../../../lib/hooks/evals", () => ({
  useEvalComparison: () => ({ ...comparison, refetch: vi.fn() }),
}));
vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { RunComparison } from "./RunComparison";

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
  recall: 0.8,
  precision: 0.5,
  citation_accuracy: 1,
  recall_denominator: 5,
  precision_denominator: 8,
  citation_denominator: 8,
  cases_total: 8,
  cases_ran: 8,
  duration_ms: 240_000,
  cost_usd: 0.04,
  error: null,
  ...over,
});

const CMP = (over: Partial<EvalRunComparison> = {}): EvalRunComparison => ({
  a: BATCH({ id: "b1", agent_version: 3 }),
  b: BATCH({ id: "b2", agent_version: 4, recall: 0.4, recall_denominator: 5 }),
  cases: [
    { case_id: "c1", name: "Hardcoded Stripe secret key", before: "pass", after: "fail" },
    { case_id: "c2", name: "N+1 query in user list", before: "pass", after: "pass" },
  ],
  ...over,
});

afterEach(() => {
  cleanup();
  comparison.data = null;
  comparison.isLoading = false;
  comparison.isError = false;
  params.value = new URLSearchParams("a=b1&b=b2");
});

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <RunComparison />
    </NextIntlClientProvider>,
  );

describe("RunComparison (AC-24)", () => {
  it("renders two metric columns, each with its own agent version", () => {
    comparison.data = CMP();
    renderPage();

    const before = document.querySelector('[data-batch="b1"]') as HTMLElement;
    const after = document.querySelector('[data-batch="b2"]') as HTMLElement;
    expect(within(before).getByText("Agent version 3")).toBeInTheDocument();
    expect(within(after).getByText("Agent version 4")).toBeInTheDocument();
    expect(within(before).getByText("80%")).toBeInTheDocument();
    expect(within(after).getByText("40%")).toBeInTheDocument();
  });

  it("shows each metric's denominator on both sides, so the sizes are visible", () => {
    comparison.data = CMP();
    renderPage();
    const before = document.querySelector('[data-batch="b1"]') as HTMLElement;
    // recall 0.8 over 5 → 4/5
    expect(within(before).getByText("4/5")).toBeInTheDocument();
  });

  it("renders the delta between the two runs", () => {
    comparison.data = CMP();
    renderPage();
    const row = document.querySelector('[data-delta="RECALL"]') as HTMLElement;
    expect(within(row).getByText("-40")).toBeInTheDocument();
  });

  /**
   * The case an artboard would never have surfaced. When one side's denominator
   * is 0 the stored metric is a vacuous 1, and `1 - 0.4` would print "-60" —
   * a regression that never happened, on the one screen whose premise is that
   * its numbers are earned.
   */
  it("refuses to compute a delta when either side measured nothing", () => {
    comparison.data = CMP({
      a: BATCH({ id: "b1", recall: 1, recall_denominator: 0 }),
      b: BATCH({ id: "b2", recall: 0.4, recall_denominator: 5 }),
    });
    renderPage();
    const row = document.querySelector('[data-delta="RECALL"]') as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByText("-60")).not.toBeInTheDocument();
  });

  it("lists every case's before → after, including one that changed state", () => {
    comparison.data = CMP();
    renderPage();

    const changedRow = document.querySelector('[data-case-id="c1"]') as HTMLElement;
    expect(within(changedRow).getByText("pass")).toBeInTheDocument();
    expect(within(changedRow).getByText("fail")).toBeInTheDocument();
    expect(within(changedRow).getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("renders `absent` and `skipped` as words, not as failures", () => {
    comparison.data = CMP({
      cases: [
        { case_id: "c3", name: "added after the first run", before: "absent", after: "pass" },
        { case_id: "c4", name: "the provider stalled on this one", before: "pass", after: "skipped" },
      ],
    });
    renderPage();

    expect(screen.getByText("not in this run")).toBeInTheDocument();
    expect(screen.getByText("did not run")).toBeInTheDocument();
    expect(screen.queryByText("fail")).not.toBeInTheDocument();
  });
});

describe("RunComparison (AC-25)", () => {
  it("labels a partial batch incomplete NEXT TO its metrics", () => {
    comparison.data = CMP({
      b: BATCH({ id: "b2", status: "partial", cases_ran: 6, cases_total: 8 }),
    });
    renderPage();

    const after = document.querySelector('[data-batch="b2"]') as HTMLElement;
    expect(within(after).getByText("Incomplete — 6 of 8 cases ran")).toBeInTheDocument();
    // …and the complete side carries no such marker
    const before = document.querySelector('[data-batch="b1"]') as HTMLElement;
    expect(within(before).queryByText(/Incomplete/)).not.toBeInTheDocument();
  });
});

describe("RunComparison — without both ids", () => {
  it("asks for the two runs instead of rendering an empty comparison", () => {
    params.value = new URLSearchParams("a=b1");
    renderPage();
    expect(screen.getByText(/needs both \?a= and \?b=/i)).toBeInTheDocument();
  });
});
