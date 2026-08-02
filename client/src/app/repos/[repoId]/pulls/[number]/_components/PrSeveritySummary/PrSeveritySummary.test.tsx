/**
 * The header scoreboard. Its whole job is to agree with the findings list below
 * it, so the tests pin the two things that could break that: every level shows,
 * and the numbers are the ones handed in.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import { PrSeveritySummary } from "./PrSeveritySummary";

afterEach(cleanup);

function renderSummary(counts: { critical: number; warning: number; suggestion: number }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PrSeveritySummary counts={counts} />
    </NextIntlClientProvider>,
  );
}

describe("PrSeveritySummary", () => {
  it("reads as CRITICAL · WARNING · SUGGESTION with their counts", () => {
    renderSummary({ critical: 3, warning: 5, suggestion: 2 });
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Suggestion")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("keeps a zero level in place instead of dropping it", () => {
    // Unlike the read-only counters elsewhere, this row is a fixed scoreboard:
    // a PR with no suggestions should still read "SUGGESTION 0", not shift shape.
    renderSummary({ critical: 2, warning: 0, suggestion: 0 });
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(2);
  });

  it("says so plainly when the PR produced nothing", () => {
    renderSummary({ critical: 0, warning: 0, suggestion: 0 });
    expect(screen.getByText("No findings")).toBeInTheDocument();
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
  });

  it("puts the whole tally in the title", () => {
    renderSummary({ critical: 3, warning: 5, suggestion: 2 });
    expect(screen.getByTitle("3 critical · 5 warning · 2 suggestion")).toBeInTheDocument();
  });
});
