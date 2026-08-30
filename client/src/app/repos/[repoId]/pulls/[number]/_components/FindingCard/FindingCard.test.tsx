import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

/**
 * The card is the far end of the jump a severity badge in the Smart Diff starts.
 * Both halves are asserted, because either one alone is a broken landing: an
 * expanded card nobody scrolled to is off screen, and a scrolled-to card that is
 * still collapsed asks the reader to click the thing they already clicked.
 */
describe("FindingCard — the target of ?findingId=", () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it("expands itself and scrolls into view when it is the target", async () => {
    renderWithIntl(<FindingCard f={FINDING} focusTarget onAction={() => {}} />);
    // `defaultExpanded` is deliberately NOT passed: expanding is the focus
    // effect's doing, not the caller's.
    expect(screen.getByText("Suggested fix")).toBeInTheDocument();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const target = scrollIntoView.mock.instances[0] as HTMLElement;
    expect(target.getAttribute("data-finding-id")).toBe("f1");
  });

  it("stays collapsed and still when it is not the target", async () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    expect(screen.queryByText("Suggested fix")).not.toBeInTheDocument();
    await new Promise((r) => requestAnimationFrame(r));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

/**
 * AC-03 — the eval control has three states, and the disabled one carries its
 * reason.
 *
 * Asserted on the `disabled` ATTRIBUTE rather than on "the click did nothing".
 * This package has no `@testing-library/user-event` (`client/INSIGHTS.md`,
 * 2026-08-22), and `fireEvent` will happily click a disabled element — so a test
 * written as "click and expect no callback" would pass even if the button were
 * fully enabled and merely wired to nothing.
 */
describe("FindingCard — turn into eval case (AC-03)", () => {
  /* Located by the NAMED label, which is what a browser flow has to use when a
     pull request renders one of these per finding. */
  const evalButton = () =>
    screen.getByRole("button", {
      name: "Turn the finding Hardcoded Stripe secret key into an eval case",
    });

  it("is disabled on an undecided finding, and says why", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onCreateEvalCase={() => {}} />);
    const btn = evalButton();
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      "title",
      "Accept or dismiss this finding first — an eval case records a decision you have already made.",
    );
  });

  it("is enabled on an accepted finding, with no disabled reason", () => {
    renderWithIntl(
      <FindingCard
        f={{ ...FINDING, accepted_at: "2026-08-30T10:00:00Z" }}
        defaultExpanded
        onCreateEvalCase={() => {}}
      />,
    );
    expect(evalButton()).toBeEnabled();
    expect(evalButton()).not.toHaveAttribute("title");
  });

  it("is enabled on a dismissed finding", () => {
    renderWithIntl(
      <FindingCard
        f={{ ...FINDING, dismissed_at: "2026-08-30T10:00:00Z" }}
        defaultExpanded
        onCreateEvalCase={() => {}}
      />,
    );
    expect(evalButton()).toBeEnabled();
  });

  it("calls the callback — and never fetches — when a decided finding is clicked", () => {
    const onCreateEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard
        f={{ ...FINDING, accepted_at: "2026-08-30T10:00:00Z" }}
        defaultExpanded
        onCreateEvalCase={onCreateEvalCase}
      />,
    );
    fireEvent.click(evalButton());
    expect(onCreateEvalCase).toHaveBeenCalledTimes(1);
  });

  it("goes disabled while its own mutation is in flight", () => {
    renderWithIntl(
      <FindingCard
        f={{ ...FINDING, accepted_at: "2026-08-30T10:00:00Z" }}
        defaultExpanded
        evalCasePending
        onCreateEvalCase={() => {}}
      />,
    );
    const btn = evalButton();
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Creating the eval case…");
  });
});
