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
// The third card, mocked for the same reason as the two above: it calls
// `useTranslations`, `useParams` and three query hooks, and a tab test that had
// to mount an intl provider and a QueryClient to assert an ORDER would be
// testing the providers. Its own behaviour is covered in
// `MultiAgentPicker/MultiAgentPicker.test.tsx`.
vi.mock("../MultiAgentPicker", () => ({
  MultiAgentPicker: ({ prId }: { prId: string | null }) => (
    <div data-card="picker">picker · {String(prId)}</div>
  ),
}));

import { OverviewTab } from "./OverviewTab";

afterEach(cleanup);

describe("OverviewTab", () => {
  it("puts the brief above the intent card, and the picker below both", () => {
    const { container } = render(
      <OverviewTab prId="pr-1" prBody={null} onOpenFile={vi.fn()} />,
    );
    const order = Array.from(container.querySelectorAll("[data-card]")).map((el) =>
      el.getAttribute("data-card"),
    );
    expect(order).toEqual(["brief", "intent", "picker"]);
  });

  it("hands the picker the PR it is mounted on, and no PR control", () => {
    // The picker's first mount point: the pull request is already fixed by the
    // route, so the tab passes `prId` and nothing else. The second mount point —
    // the Multi-Agent Review route — is the one that passes a control.
    render(<OverviewTab prId="pr-1" prBody={null} onOpenFile={vi.fn()} />);
    expect(screen.getByText("picker · pr-1")).toBeInTheDocument();
  });

  it("forwards the page's openFile down to the card", () => {
    // The typecheck is the real gate — `onOpenFile` is required at every hop —
    // but this pins that the tab passes it on rather than swallowing it.
    render(<OverviewTab prId="pr-1" prBody={null} onOpenFile={vi.fn()} />);
    expect(screen.getByText(/brief · function/)).toBeInTheDocument();
  });
});
