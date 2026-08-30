/**
 * The PR brief card.
 *
 * What is worth testing here is the handful of promises a screenshot cannot
 * check: that the empty state spends nothing until it is clicked, that a stale
 * brief is still readable, that the seven blocks arrive in the order AC-32
 * fixes, that a focus row navigates exactly once with ITS OWN file and line, and
 * that an endpoint row is text rather than a control.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefResponse } from "@devdigest/shared";
import brief from "../../../../../../../../messages/en/brief.json";

const generate = vi.fn();
let stored: PrBriefResponse | null = null;
let loading = false;

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: () => ({ data: stored, isLoading: loading }),
  useGenerateBrief: () => ({ mutate: generate, isPending: false }),
}));

import { PrBriefCard } from "./PrBriefCard";

const BRIEF: PrBriefResponse = {
  pr_id: "pr-1",
  what: "Adds a distributed rate limiter in front of the public API.",
  why: "Anonymous traffic has been able to exhaust the order endpoints since the CDN rule was removed.",
  risk_level: "high",
  risks: [
    {
      kind: "security",
      title: "Auth surface touched",
      explanation: "The middleware reads the Authorization header to bucket traffic.",
      severity: "high",
      file_refs: ["src/middleware/ratelimit.ts:12-18"],
    },
    {
      kind: "deps",
      title: "New dependency: ioredis",
      explanation: "Adds ioredis@5.4.1 for the distributed token bucket.",
      severity: "medium",
      // Every reference this risk named was dropped by grounding — the risk
      // survives, its list does not (AC-18).
      file_refs: [],
    },
  ],
  review_focus: [
    {
      kind: "file",
      ref: "src/middleware/ratelimit.ts",
      line: 40,
      why: "The bucket arithmetic is the whole change.",
    },
    {
      kind: "file",
      ref: "src/config.ts",
      line: 12,
      why: "Where the Redis URL is read.",
    },
    {
      kind: "endpoint",
      ref: "GET /orders",
      line: null,
      why: "The busiest route behind the new limiter.",
    },
  ],
  state_key: "a".repeat(64),
  head_sha: "13d9abb35ff2c4c29f061c5ae9910fda5a2878ff",
  missing_inputs: [],
  dropped_refs: [],
  trimmed: [],
  input_tokens: 3120,
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  tokens_in: 100,
  tokens_out: 380,
  cost_usd: 0.0012,
  duration_ms: 2400,
  generated_at: "2026-08-30T10:00:00.000Z",
  stale: false,
  history: [],
} as unknown as PrBriefResponse;

const withBrief = (patch: Partial<PrBriefResponse>): PrBriefResponse =>
  ({ ...BRIEF, ...patch }) as PrBriefResponse;

function renderCard(onOpenFile = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ brief }}>
      <PrBriefCard prId="pr-1" onOpenFile={onOpenFile} />
    </NextIntlClientProvider>,
  );
  return { ...view, onOpenFile };
}

beforeEach(() => {
  generate.mockReset();
  stored = BRIEF;
  loading = false;
});
afterEach(cleanup);

describe("PrBriefCard", () => {
  it("offers to generate a brief, and spends nothing until the button is clicked", () => {
    stored = null;
    renderCard();

    expect(screen.getByText(brief.unavailable)).toBeInTheDocument();
    // AC-30: the CTA is an offer. Rendering the card must not POST.
    expect(generate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: brief.card.generate }));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("keeps a stale brief on screen, behind a banner with its own Regenerate", () => {
    // AC-31: staleness is reported, not hidden. The brief is still the answer —
    // it just describes an earlier state.
    stored = withBrief({ stale: true });
    renderCard();

    expect(screen.getByText(brief.card.stale.title)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.queryByText(brief.unavailable)).not.toBeInTheDocument();
    // Two Regenerate buttons: the header's and the banner's. The banner is the
    // one with an argument for pressing it, which is why it has its own.
    expect(screen.getAllByRole("button", { name: brief.card.regenerate })).toHaveLength(2);
  });

  it("lays the card out in AC-32's order", () => {
    // Read off `data-block` rather than off text: two of the seven blocks are
    // dividers, and there is no accessible query for "the fifth thing here".
    const { container } = renderCard();
    const order = Array.from(container.querySelectorAll("[data-block]")).map((el) =>
      el.getAttribute("data-block"),
    );
    expect(order).toEqual([
      "header",
      "prose",
      "divider-risks",
      "risks",
      "divider-focus",
      "focus",
      "timeline",
    ]);
  });

  it("navigates once, to the row's own file and line", () => {
    // AC-33's navigation half. Three rows, and the accessible name is what tells
    // them apart — a shared label would make a flow's `--name` locator mean
    // "whichever comes first".
    const { onOpenFile } = renderCard();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open src/config.ts at line 12 in the Files tab",
      }),
    );
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith("src/config.ts", 12);
  });

  it("renders an endpoint focus row as text with nowhere to go", () => {
    // AC-37. An endpoint has no line, so there is nothing in the diff viewer to
    // open — and a control that navigates nowhere is worse than no control.
    renderCard();

    expect(screen.getByText("GET /orders")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open GET \/orders/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps a risk whose references were all dropped, and says so", () => {
    // AC-18's second half, seen from the card: the explanation survives with an
    // empty list rather than the risk disappearing.
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /New dependency: ioredis/ }));
    expect(screen.getByText(/Adds ioredis@5\.4\.1/)).toBeInTheDocument();
    expect(screen.getByText(brief.card.droppedRefsOnRisk)).toBeInTheDocument();
  });

  it("states a degraded input beside the claim it weakens", () => {
    stored = withBrief({
      missing_inputs: ["No intent has been derived for this pull request"],
      dropped_refs: ["src/invented.ts"],
      trimmed: ["project context: architecture.md"],
    });
    renderCard();

    expect(screen.getByText(brief.card.missingInputs)).toBeInTheDocument();
    expect(screen.getByText("· No intent has been derived for this pull request")).toBeInTheDocument();
    expect(screen.getByText(brief.card.droppedRefs)).toBeInTheDocument();
    expect(screen.getByText("· src/invented.ts")).toBeInTheDocument();
    // `trimmed` reaches the header's meta line as well as its own note, because
    // a reader comparing two briefs needs to know one of them was asked less.
    expect(screen.getByText(new RegExp(brief.card.trimmedShort))).toBeInTheDocument();
  });

  it("shows the Why Timeline behind its count, newest first", () => {
    stored = withBrief({
      history: [
        {
          seq: 2,
          state_key: "b".repeat(64),
          head_sha: "13d9abb35ff2c4c29f061c5ae9910fda5a2878ff",
          risk_level: "high",
          what: "Adds a distributed rate limiter.",
          generated_at: "2026-08-30T10:00:00.000Z",
          delta: {
            risk_level_from: "medium",
            risk_level_to: "high",
            risks_added: ["Auth surface touched"],
            risks_removed: [],
            focus_added: [],
            focus_removed: [],
          },
        },
        {
          seq: 1,
          state_key: "c".repeat(64),
          head_sha: "0000000000000000000000000000000000000000",
          risk_level: "medium",
          what: "Adds an in-process rate limiter.",
          generated_at: "2026-08-29T10:00:00.000Z",
          delta: null,
        },
      ],
    } as Partial<PrBriefResponse>);
    const { container } = renderCard();

    const timeline = container.querySelector('[data-block="timeline"]') as HTMLElement;
    fireEvent.click(within(timeline).getByRole("button"));

    // The order is the server's `seq`, not a re-sort here: two rows written in
    // one transaction tie on `generated_at` to the microsecond.
    const whats = within(timeline)
      .getAllByText(/rate limiter/)
      .map((el) => el.textContent);
    expect(whats).toEqual(["Adds a distributed rate limiter.", "Adds an in-process rate limiter."]);
    // The delta is computed by code, and the oldest entry has nothing behind it.
    expect(within(timeline).getByText(/risk medium → high/)).toBeInTheDocument();
    expect(within(timeline).getByText(brief.timeline.first)).toBeInTheDocument();
  });
});
