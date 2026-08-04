/**
 * RunCostBadge — the two shapes the design uses, and the rule that separates
 * "we don't know" from "it was free".
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/prReview.json";
import { RunCostBadge } from "./RunCostBadge";

afterEach(cleanup);

function renderBadge(props: React.ComponentProps<typeof RunCostBadge>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunCostBadge {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RunCostBadge", () => {
  it("renders the compact cost when no tokens are given", () => {
    renderBadge({ costUsd: 0.014 });
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("renders tokens alongside the cost when tokens are given", () => {
    renderBadge({ costUsd: 0.0013, tokens: 9119 });
    expect(screen.getByText("9,119 tok · $0.0013")).toBeInTheDocument();
  });

  it("shows a dash — never $0.00 — when the cost is unknown", () => {
    renderBadge({ costUsd: null });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("shows $0.00 for a genuinely free run", () => {
    renderBadge({ costUsd: 0 });
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("keeps the token count when the cost is unknown", () => {
    // A run on an unpriced model still burned tokens — don't hide that.
    renderBadge({ costUsd: null, tokens: 8457 });
    expect(screen.getByText("8,457 tok")).toBeInTheDocument();
  });
});
