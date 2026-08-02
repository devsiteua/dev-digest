/**
 * FindingsTooltip is presentational, so the tests are about what it promises the
 * two counter surfaces: a count that matches the list, a file:line anchor, and a
 * rationale that stays a preview rather than becoming the finding.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { FindingsTooltip } from "./FindingsTooltip";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: o.id,
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "A literal `sk_live_` key is **committed**.",
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

function renderTooltip(props: React.ComponentProps<typeof FindingsTooltip>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsTooltip {...props} />
    </NextIntlClientProvider>,
  );
}

describe("FindingsTooltip", () => {
  it("headlines the number of findings it lists", () => {
    renderTooltip({
      items: [finding({ id: "a" }), finding({ id: "b", severity: "WARNING", category: "perf" })],
    });
    expect(screen.getByText("2 findings")).toBeInTheDocument();
  });

  it("anchors each finding to file:line, collapsing a single-line range", () => {
    renderTooltip({ items: [finding({ id: "a" })] });
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
  });

  it("spells out a multi-line range", () => {
    renderTooltip({ items: [finding({ id: "a", start_line: 61, end_line: 74 })] });
    expect(screen.getByText("src/config.ts:61-74")).toBeInTheDocument();
  });

  it("strips markdown from the rationale preview", () => {
    // It is clamped to two lines at 11.5px; backticks and asterisks would render
    // as literal punctuation there.
    renderTooltip({ items: [finding({ id: "a" })] });
    expect(screen.getByText("A literal sk_live_ key is committed.")).toBeInTheDocument();
  });

  it("renders nothing at all when there is nothing to show", () => {
    const { container } = renderTooltip({ items: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
