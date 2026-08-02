/**
 * SeverityCounters — the three states that are easy to conflate: never reviewed,
 * reviewed and clean, and reviewed with findings.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/prReview.json";
import { SeverityCounters } from "./SeverityCounters";

afterEach(cleanup);

function renderCounters(props: React.ComponentProps<typeof SeverityCounters>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <SeverityCounters {...props} />
    </NextIntlClientProvider>,
  );
}

describe("SeverityCounters", () => {
  it("shows a dash when the PR has never been reviewed", () => {
    renderCounters({ counts: null });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByTitle("Not reviewed yet")).toBeInTheDocument();
  });

  it("shows 0 — never a dash — for a review that found nothing", () => {
    renderCounters({ counts: { critical: 0, warning: 0, suggestion: 0 } });
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("renders one badge per non-zero severity and hides the zeros", () => {
    const { container } = renderCounters({
      counts: { critical: 2, warning: 1, suggestion: 0 },
    });
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    // compact SeverityBadge = icon + count, so two severities means two badges.
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("puts the full tally in the tooltip, including the hidden zeros", () => {
    renderCounters({ counts: { critical: 2, warning: 1, suggestion: 0 } });
    expect(
      screen.getByTitle("2 critical · 1 warning · 0 suggestion"),
    ).toBeInTheDocument();
  });
});
