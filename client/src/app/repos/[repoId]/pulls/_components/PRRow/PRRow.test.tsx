/**
 * PRRow's FINDINGS column is the one surface whose popover data is not already in
 * hand, so the tests are about *when* it asks for it: never on render, once on
 * hover, and with the popover opening upwards for rows in the lower half.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

const useLatestReviewFindings = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/reviews", () => ({
  useLatestReviewFindings: (...args: unknown[]) => useLatestReviewFindings(...args),
}));

import { PRRow } from "./PRRow";

afterEach(() => {
  cleanup();
  useLatestReviewFindings.mockReset();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "why",
  suggestion: null,
  confidence: 0.98,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit",
    base: "main",
    head_sha: "abc123",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: "2026-06-11T18:00:00.000Z",
    updated_at: "2026-06-11T18:44:34.000Z",
    score: 61,
    cost_usd: 0.0041,
    findings_by_severity: { critical: 1, warning: 0, suggestion: 0 },
    ...o,
  };
}

function renderRow(props: Partial<React.ComponentProps<typeof PRRow>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={pr()} repoId="repo-1" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — findings column", () => {
  it("does not ask for findings until the cell is hovered", () => {
    useLatestReviewFindings.mockReturnValue({ data: undefined });
    renderRow();
    expect(useLatestReviewFindings).toHaveBeenCalledWith("pr-1", false);

    fireEvent.mouseEnter(screen.getByTitle("1 critical · 0 warning · 0 suggestion"));
    expect(useLatestReviewFindings).toHaveBeenLastCalledWith("pr-1", true);
  });

  it("shows the loaded findings in the popover", () => {
    useLatestReviewFindings.mockReturnValue({ data: [FINDING] });
    renderRow();
    fireEvent.mouseEnter(screen.getByTitle("1 critical · 0 warning · 0 suggestion"));
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("opens the popover upwards for a row in the lower half of the list", () => {
    useLatestReviewFindings.mockReturnValue({ data: [FINDING] });
    renderRow({ index: 5, total: 7 });
    fireEvent.mouseEnter(screen.getByTitle("1 critical · 0 warning · 0 suggestion"));
    // Anchored to the bottom of the counter row rather than the top — otherwise
    // the last rows would open the popover past the viewport.
    const style = screen.getByRole("tooltip").getAttribute("style") ?? "";
    expect(style).toContain("bottom: 100%");
  });

  it("asks for nothing on a PR that was never reviewed", () => {
    useLatestReviewFindings.mockReturnValue({ data: undefined });
    renderRow({ pr: pr({ findings_by_severity: null, score: null, cost_usd: null }) });
    // The dash has no hover affordance at all, so the query stays disabled.
    fireEvent.mouseEnter(screen.getByTitle("Not reviewed yet"));
    expect(useLatestReviewFindings).toHaveBeenLastCalledWith("pr-1", false);
  });
});
