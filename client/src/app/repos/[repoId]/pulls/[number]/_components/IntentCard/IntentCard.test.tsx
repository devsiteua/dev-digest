import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const mutate = vi.fn();
let stored: PrIntentRecord | null = null;

vi.mock("../../../../../../../lib/hooks/intent", () => ({
  usePrIntent: () => ({ data: stored, isLoading: false }),
  useDeriveIntent: () => ({ mutate, isPending: false }),
}));

import { IntentCard } from "./IntentCard";

const RECORD: PrIntentRecord = {
  pr_id: "pr-1",
  intent: "Rate-limit the public API endpoints.",
  in_scope: ["Add middleware", "Return 429 with Retry-After"],
  out_of_scope: ["Authentication changes"],
  kind: "feature",
  confidence: 0.9,
  confidence_tier: "high",
  sources: ["plan_file", "pr_title"],
  evidence: [],
  missing_context: [],
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  tokens_in: 900,
  tokens_out: 120,
  cost_usd: 0.0004,
  duration_ms: 800,
  head_sha: "a1b2c3d4e5f6",
  generated_at: "2026-08-22T10:00:00.000Z",
};

const renderCard = (prId: string | null = "pr-1") =>
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <IntentCard prId={prId} />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  stored = null;
  mutate.mockReset();
});
afterEach(cleanup);

describe("IntentCard", () => {
  it("renders the claim and both scope lists", () => {
    stored = RECORD;
    renderCard();

    expect(screen.getByText(/Rate-limit the public API endpoints/)).toBeInTheDocument();
    expect(screen.getByText("IN SCOPE")).toBeInTheDocument();
    expect(screen.getByText("OUT OF SCOPE")).toBeInTheDocument();
    expect(screen.getByText("Add middleware")).toBeInTheDocument();
    expect(screen.getByText("Authentication changes")).toBeInTheDocument();
  });

  it("shows confidence through the design's own primitive, not a second visual", () => {
    stored = RECORD;
    renderCard();
    // ConfidenceNum renders "NN% conf". The server picks `confidence` so each
    // tier lands in that primitive's colour bands — no conditional in the card.
    expect(screen.getByText("90% conf")).toBeInTheDocument();
  });

  it("renders a low tier at the value that paints it muted", () => {
    stored = { ...RECORD, confidence: 0.4, confidence_tier: "low", sources: ["pr_title"] };
    renderCard();
    expect(screen.getByText("40% conf")).toBeInTheDocument();
  });

  it("names the evidence, which is what makes the confidence readable", () => {
    stored = RECORD;
    renderCard();
    expect(screen.getByText("plan file")).toBeInTheDocument();
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("names what the PR pointed at and could not be read", () => {
    stored = {
      ...RECORD,
      missing_context: ["plan file specs/missing.md named in the body but not readable"],
    };
    renderCard();

    expect(screen.getByText("Derived without context the PR points at:")).toBeInTheDocument();
    expect(
      screen.getByText(/plan file specs\/missing\.md named in the body but not readable/),
    ).toBeInTheDocument();
  });

  it("says nothing about missing context when nothing was missing", () => {
    stored = RECORD;
    renderCard();
    expect(
      screen.queryByText("Derived without context the PR points at:"),
    ).not.toBeInTheDocument();
  });

  it("shows what the derivation cost, which D6 promised and Round 1 did not ship", () => {
    stored = RECORD;
    renderCard();
    expect(screen.getByText(/900→120 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.0004/)).toBeInTheDocument();
    expect(screen.getByText(/deepseek\/deepseek-v4-flash/)).toBeInTheDocument();
  });

  it("says unpriced rather than $0.0000 for a model with no known price", () => {
    // Null and free are different facts, and only one of them is worth a number.
    stored = { ...RECORD, cost_usd: null };
    renderCard();
    expect(screen.getByText(/unpriced/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it("prints a genuinely free run as a number, not as unpriced", () => {
    stored = { ...RECORD, cost_usd: 0 };
    renderCard();
    expect(screen.getByText(/\$0\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/unpriced/)).not.toBeInTheDocument();
  });

  it("offers an empty state with a derive action when nothing was derived", () => {
    stored = null;
    renderCard();

    expect(screen.getByText("No intent derived yet")).toBeInTheDocument();
    expect(screen.queryByText("IN SCOPE")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Derive intent"));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("re-derives on demand when one already exists", () => {
    stored = RECORD;
    renderCard();

    fireEvent.click(screen.getByText("Re-derive"));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("renders nothing until the PR id resolves", () => {
    stored = RECORD;
    const { container } = renderCard(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("owns no page-level section, so the PR Brief can absorb it unchanged", () => {
    stored = RECORD;
    const { container } = renderCard();
    expect(container.querySelector("section")).toBeNull();
  });
});
