import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// Hoisted so the SAME spy survives every render — the panel calls the hook on
// each one, and a factory returning a fresh `vi.fn()` could never be asserted on.
const { mutate, createEvalCase } = vi.hoisted(() => ({
  mutate: vi.fn(),
  createEvalCase: vi.fn(),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false }),
}));
// The eval-case hook calls `useQueryClient()`, which throws without a provider.
// Mocked for the same reason the reviews hook is: this file tests the panel's
// filtering and keyboard behaviour, not React Query's wiring.
vi.mock("../../../../../../../lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutate: createEvalCase, isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  // The spy is module-scoped, so it has to be reset by the harness. Leaving the
  // reset inside the one test that currently needs it means the next test to
  // assert on `mutate` silently inherits whatever the tests before it dispatched.
  mutate.mockClear();
  createEvalCase.mockClear();
});

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

/** One finding under `LOW_CONFIDENCE_THRESHOLD` (0.65), one well over it. */
const LOW_AND_HIGH: FindingRecord[] = [
  finding({ id: "Hardcoded secret", severity: "CRITICAL", confidence: 0.95 }),
  finding({ id: "Shaky guess", severity: "WARNING", confidence: 0.3 }),
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
  it("rests with every severity on, so the row reads as a summary", () => {
    // The design shows all three chips active on load; the tooltip is how a chip
    // advertises what the next click does, so it doubles as the state assertion.
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(chip("Critical").parentElement).toHaveAttribute(
      "title",
      "Critical · 2 — click to show only these",
    );
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("narrows the list to the clicked severity", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Warning"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });

  it("shows the union when a second severity is added", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Warning"));
    fireEvent.click(chip("Critical"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Unauthenticated webhook")).toBeInTheDocument();
  });

  it("drops a severity back out of a multi-selection", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Warning"));
    fireEvent.click(chip("Critical"));
    fireEvent.click(chip("Warning"));
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("clicking the last remaining severity returns to showing everything", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(chip("Warning"));
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    fireEvent.click(chip("Warning"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(chip("Warning").parentElement).toHaveAttribute(
      "title",
      "Warning · 1 — click to show only these",
    );
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

/**
 * A finding reached from a Smart Diff badge has to be ON SCREEN when the reader
 * lands, whatever the panel was filtered to a moment ago. A click that ends on
 * "No findings match" is indistinguishable from a dead link, so the filters give
 * way — visibly, and one click from being put back.
 */
describe("FindingsPanel — the target of ?findingId=", () => {
  const withTarget = (id: string | null) => (
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsPanel findings={LOW_AND_HIGH} prId="pr1" focusFindingId={id} />
    </NextIntlClientProvider>
  );

  it("reveals a target a severity filter was hiding", () => {
    const { rerender } = renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" focusFindingId={null} />,
    );
    fireEvent.click(chip("Warning"));
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={FINDINGS} prId="pr1" focusFindingId="Hardcoded secret" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("No findings match")).not.toBeInTheDocument();
  });

  it("reveals a target that hide-low-confidence was hiding", () => {
    const { rerender } = render(withTarget(null));
    // Found by ROLE rather than by the toolbar's DOM nesting; unambiguous because
    // this panel renders exactly one Toggle. Deliberately no `{ name }`: the
    // vendored `Toggle` takes only `on`/`onChange`/`size` and wraps a decorative
    // <span>, so its accessible name is EMPTY — "Hide low confidence" is a
    // sibling text node that is never associated with the control. That is a real
    // a11y gap, and it can only be closed in `vendor/ui` (do-not-touch) or at the
    // call site, neither of which this diff touches.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Shaky guess")).not.toBeInTheDocument();

    rerender(withTarget("Shaky guess"));
    expect(screen.getByText("Shaky guess")).toBeInTheDocument();
  });

  it("expands the target instead of the first card", () => {
    renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" focusFindingId="N+1 query" />,
    );
    // One card is open, and it is the one asked for: `rationale` renders only in
    // an expanded body, so counting them counts open cards.
    expect(screen.getAllByText("why")).toHaveLength(1);
    const open = screen.getByText("why").closest("[data-finding-id]");
    expect(open).toHaveAttribute("data-finding-id", "N+1 query");
  });

  it("seats the keyboard cursor once, and does not re-seat it on a refetch", () => {
    // The regression: `shown` is a fresh array on every recompute, and accepting
    // a finding invalidates `["reviews", prId]` — so an effect keyed on `shown`
    // would yank the cursor back to the URL's finding each time the reader acted
    // on the list they had walked down.
    // The target is index 1, NOT 0. At index 0 the seat would coincide with
    // `focusIdx`'s initial state and half this test would be vacuous: seating
    // could be deleted outright and it would still pass. Checked by mutation —
    // `const i = -1` in the effect must fail this too, not only removing the ref
    // guard.
    const panel = (findings: FindingRecord[]) => (
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={findings} prId="pr1" focusFindingId="Unauthenticated webhook" />
      </NextIntlClientProvider>
    );
    const { rerender } = render(panel(FINDINGS));

    fireEvent.keyDown(window, { key: "j" });
    // …the reader is now one card below the one the badge brought them to.
    rerender(panel([...FINDINGS])); // a refetch: same findings, new identity
    fireEvent.keyDown(window, { key: "a" });

    expect(mutate).toHaveBeenCalledWith({
      findingId: "N+1 query",
      action: "accept",
      prId: "pr1",
    });
  });

  it("leaves the panel alone when no finding matches the id", () => {
    renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" focusFindingId="deleted-run-finding" />,
    );
    expect(screen.getAllByText("why")).toHaveLength(1);
    const open = screen.getByText("why").closest("[data-finding-id]");
    // The resting default: the first card of the list, not nothing at all.
    expect(open).toHaveAttribute("data-finding-id", "Hardcoded secret");
  });
});
