/**
 * SeverityCounters — the three states that are easy to conflate: never reviewed,
 * reviewed and clean, and reviewed with findings.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { SeverityCounters } from "./SeverityCounters";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: o.id,
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
    ...o,
  };
}

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

  it("renders one counter per non-zero severity and hides the zeros", () => {
    const { container } = renderCounters({
      counts: { critical: 2, warning: 1, suggestion: 0 },
    });
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    // icon + count per level, so two severities means two icons.
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("draws each counter as dotted-underlined text in the severity colour", () => {
    // The design's counter is bare text on a dotted rule, not a filled pill —
    // the underline is what advertises the popover behind it.
    // Asserted on the inline style attribute rather than through `toHaveStyle`:
    // jsdom's computed-style parser drops any declaration containing `var()`.
    const { container } = renderCounters({ counts: { critical: 2, warning: 0, suggestion: 0 } });
    const style = container.querySelector("svg")!.parentElement!.getAttribute("style") ?? "";
    expect(style).toContain("border-bottom: 1px dotted var(--crit)");
    expect(style).toContain("color: var(--crit)");
    expect(style).not.toContain("background");
  });

  it("puts the full tally in the title, including the hidden zeros", () => {
    renderCounters({ counts: { critical: 2, warning: 1, suggestion: 0 } });
    expect(
      screen.getByTitle("2 critical · 1 warning · 0 suggestion"),
    ).toBeInTheDocument();
  });
});

describe("SeverityCounters — findings popover", () => {
  const ITEMS = [finding({ id: "f1", title: "Hardcoded Stripe secret key" })];

  it("opens the popover on hover and closes it on leave", () => {
    renderCounters({ counts: { critical: 1, warning: 0, suggestion: 0 }, items: ITEMS });
    const row = screen.getByTitle("1 critical · 0 warning · 0 suggestion");

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.mouseEnter(row);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();

    fireEvent.mouseLeave(row);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("stays a plain tally when no findings were supplied", () => {
    // The PR list renders counters long before its findings have loaded; an empty
    // popover frame flashing under the cursor would be worse than none.
    renderCounters({ counts: { critical: 1, warning: 0, suggestion: 0 } });
    fireEvent.mouseEnter(screen.getByTitle("1 critical · 0 warning · 0 suggestion"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("signals the first hover so the caller can start loading", () => {
    const onHover = vi.fn();
    renderCounters({ counts: { critical: 1, warning: 0, suggestion: 0 }, onHover });
    fireEvent.mouseEnter(screen.getByTitle("1 critical · 0 warning · 0 suggestion"));
    expect(onHover).toHaveBeenCalled();
  });
});
