import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

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

const FINDINGS: FindingRecord[] = [
  finding({ id: "Hardcoded secret", severity: "CRITICAL" }),
  finding({ id: "Unauthenticated webhook", severity: "CRITICAL" }),
  finding({ id: "N+1 query", severity: "WARNING", category: "perf" }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** The chip button for a severity, found by its visible label. */
function chip(label: string): HTMLElement {
  return screen.getByText(label).closest("button")!;
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — severity counters", () => {
  it("renders all three severities, including one with no findings", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    const group = screen.getByRole("group", { name: "Filter by severity" });
    expect(within(group).getByText("Critical")).toBeInTheDocument();
    expect(within(group).getByText("Warning")).toBeInTheDocument();
    expect(within(group).getByText("Suggestion")).toBeInTheDocument();
  });

  it("counts each severity", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(chip("Critical")).toHaveTextContent("2");
    expect(chip("Warning")).toHaveTextContent("1");
    expect(chip("Suggestion")).toHaveTextContent("0");
  });

  it("marks a zero-count severity as disabled", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(chip("Suggestion").parentElement).toHaveAttribute("aria-disabled", "true");
    expect(chip("Critical").parentElement).not.toHaveAttribute("aria-disabled");
  });
});

describe("FindingsPanel — click to filter", () => {
  it("narrows the list to the clicked severity", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Warning"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });

  it("shows the union when two severities are selected (multi-select)", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Warning"));
    fireEvent.click(chip("Critical"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Unauthenticated webhook")).toBeInTheDocument();
  });

  it("clicking the same severity twice clears the filter", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Warning"));
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    fireEvent.click(chip("Warning"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("keeps the counters at their unfiltered values while a filter is active", () => {
    // The chip is a summary of the run, not of the current view — otherwise the
    // numbers would collapse to the thing you just selected.
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Warning"));
    expect(chip("Critical")).toHaveTextContent("2");
    expect(chip("Warning")).toHaveTextContent("1");
  });

  it("a zero-count severity cannot strand the panel on an empty list", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Suggestion")); // inert — must be a no-op
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("No findings match")).not.toBeInTheDocument();
  });

  it("filters each run's panel independently", () => {
    // The accordion renders one panel per review run. Lifting the filter state any
    // higher would silently narrow every run at once.
    renderWithIntl(
      <>
        <FindingsPanel findings={FINDINGS} prId="pr1" />
        <FindingsPanel findings={FINDINGS} prId="pr1" />
      </>,
    );
    const groups = screen.getAllByRole("group", { name: "Filter by severity" });
    fireEvent.click(within(groups[0]!).getByText("Warning").closest("button")!);

    // The first panel is filtered to the single WARNING; the second still shows all 3.
    expect(screen.getAllByText("N+1 query")).toHaveLength(2);
    expect(screen.getAllByText("Hardcoded secret")).toHaveLength(1);
  });
});
