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
