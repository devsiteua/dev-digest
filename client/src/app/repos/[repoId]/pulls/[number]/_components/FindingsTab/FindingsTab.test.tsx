import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsTab } from "./FindingsTab";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: o.id,
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "why",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(id: string, agent: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id,
    pr_id: "pr1",
    agent_id: `a-${id}`,
    run_id: `run-${id}`,
    agent_name: agent,
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: "seed",
    grounding: null,
    created_at: "2026-08-23T10:00:00.000Z",
    findings,
  };
}

// Newest first, as the API returns them — so the SECOND accordion is the one
// that starts collapsed, and the one worth navigating into.
const RUNS: ReviewRecord[] = [
  review("r1", "Security Reviewer", [finding({ id: "Hardcoded secret" })]),
  review("r2", "Performance Reviewer", [finding({ id: "N+1 query", severity: "WARNING" })]),
];

function renderTab(focusFindingId: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={RUNS}
        prRuns={[]}
        prCommits={[]}
        cancelMutation={{ mutate: vi.fn(), isPending: false } as never}
        focusFindingId={focusFindingId}
        onOpenTrace={() => {}}
        onDelete={() => {}}
        onRunDone={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

/**
 * A severity badge in the Smart Diff can name a finding in ANY run, while only
 * the newest run's accordion is open by default. So the tab's job here is to
 * open the right one — and to do nothing at all when the id belongs to nothing,
 * which is what a stale link or a deleted run looks like.
 */
describe("FindingsTab — the run that holds ?findingId=", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("opens a collapsed run when the target finding is inside it", () => {
    renderTab("N+1 query");
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
  });

  it("leaves the collapsed run closed with no target", () => {
    renderTab(null);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
  });

  it("renders normally when no run holds the id", () => {
    // A deleted run, or a link from a review that has since been re-run.
    renderTab("finding-that-no-longer-exists");
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
    expect(screen.getByText("Review runs")).toBeInTheDocument();
  });
});
