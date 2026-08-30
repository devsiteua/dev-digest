/**
 * The Overview tab.
 *
 * One thing is only decidable here, and it is AC-32's first clause: the brief is
 * the FIRST block of this tab, above `IntentCard`. The rest of what this tab
 * does is tested where it lives.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../PrBriefCard", () => ({
  PrBriefCard: ({ onOpenFile }: { onOpenFile: (p: string, l: number | null) => void }) => (
    // Rendering the callback's presence rather than mocking it away: the point
    // of the test below is that this tab really forwards it.
    <div data-card="brief">brief · {typeof onOpenFile}</div>
  ),
}));
vi.mock("../IntentCard", () => ({
  IntentCard: () => <div data-card="intent">intent</div>,
}));

import { OverviewTab } from "./OverviewTab";

afterEach(cleanup);

describe("OverviewTab", () => {
  it("puts the brief above the intent card", () => {
    const { container } = render(
      <OverviewTab prId="pr-1" prBody={null} onOpenFile={vi.fn()} />,
    );
    const order = Array.from(container.querySelectorAll("[data-card]")).map((el) =>
      el.getAttribute("data-card"),
    );
    expect(order).toEqual(["brief", "intent"]);
  });

  it("forwards the page's openFile down to the card", () => {
    // The typecheck is the real gate — `onOpenFile` is required at every hop —
    // but this pins that the tab passes it on rather than swallowing it.
    render(<OverviewTab prId="pr-1" prBody={null} onOpenFile={vi.fn()} />);
    expect(screen.getByText(/brief · function/)).toBeInTheDocument();
  });
});
