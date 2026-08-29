import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, Skill } from "@devdigest/shared";
import agentMessages from "../../../../../../../../messages/en/agents.json";
import skillMessages from "../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../../lib/toast";

const save = vi.fn();
const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "test-coverage-rubric",
    description: "Enumerate branches.",
    type: "rubric",
    source: "manual",
    body: "b",
    enabled: true,
    version: 1,
    evidence_files: null,
  },
  {
    id: "s2",
    name: "flaky-test-smells",
    description: "Find non-determinism.",
    type: "custom",
    source: "manual",
    body: "b",
    enabled: false,
    version: 1,
    evidence_files: null,
  },
  {
    id: "s3",
    name: "api-contract-compat",
    description: "Classify breaking changes.",
    type: "rubric",
    source: "manual",
    body: "b",
    enabled: true,
    version: 1,
    evidence_files: null,
  },
];

/** Mutable so a test can simulate a refetch handing back a fresh array. */
let links: { agent_id: string; skill_id: string; order: number }[] = [];
let linksError = false;

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentSkills: () => ({
    data: links,
    isLoading: false,
    isError: linksError,
    refetch: vi.fn(),
  }),
  useSetAgentSkills: () => ({ mutate: save, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";

const AGENT: Agent = {
  id: "ag1",
  name: "Test Quality Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "x",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  project_context: true,
  enabled: false,
  version: 1,
};

beforeEach(() => {
  save.mockClear();
  links = [
    { agent_id: "ag1", skill_id: "s1", order: 0 },
    { agent_id: "ag1", skill_id: "s2", order: 1 },
  ];
  linksError = false;
});
afterEach(cleanup);

function renderTab() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ agents: agentMessages, skills: skillMessages }}
    >
      <ToastProvider>
        <SkillsTab agent={AGENT} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

/** The row element for a skill, so assertions can be scoped to it. */
const rowFor = (name: string) => screen.getByRole("listitem", { name });

/**
 * jsdom implements no DataTransfer, so `fireEvent` has to be handed one. The
 * payload only matters on `drop` — and only as the fallback path, which is what
 * passing an id here exercises.
 */
const dt = (payload = "") => ({
  effectAllowed: "",
  dropEffect: "",
  setData: vi.fn(),
  getData: () => payload,
});

describe("Agent editor → Skills tab", () => {
  it("lists every workspace skill and counts the linked ones", () => {
    renderTab();
    for (const s of SKILLS) expect(screen.getByText(s.name)).toBeInTheDocument();
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
  });

  it("shows linked skills first, numbered in prompt order", () => {
    renderTab();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "test-coverage-rubric",
      "flaky-test-smells",
      "api-contract-compat",
    ]);
    // The numbers are the positions of the blocks in the assembled prompt.
    expect(within(rows[0]!).getByText("1")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("2")).toBeInTheDocument();
  });

  it("says nothing needs saving until something changes", () => {
    renderTab();
    expect(screen.getByText("Up to date with the saved order.")).toBeInTheDocument();
    expect(screen.getByText("Save skills").closest("button")).toBeDisabled();
  });

  it("attaching a skill appends it and enables saving", () => {
    renderTab();
    fireEvent.click(within(rowFor("api-contract-compat")).getByRole("checkbox"));

    const btn = screen.getByText("Save skills").closest("button")!;
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(save).toHaveBeenCalledWith(["s1", "s2", "s3"], expect.anything());
  });

  it("dragging a row onto another posts the new order, which is the order of the prompt blocks", () => {
    renderTab(); // saved order: s1, s2
    const dragged = rowFor("flaky-test-smells");
    const target = rowFor("test-coverage-rubric");

    fireEvent.dragStart(dragged, { dataTransfer: dt() });
    fireEvent.dragOver(target, { dataTransfer: dt() });
    fireEvent.drop(target, { dataTransfer: dt("s2") });

    fireEvent.click(screen.getByText("Save skills").closest("button")!);
    expect(save).toHaveBeenCalledWith(["s2", "s1"], expect.anything());
  });

  it("renumbers the rows as soon as the drop lands, before any save", () => {
    renderTab();
    fireEvent.dragStart(rowFor("flaky-test-smells"), { dataTransfer: dt() });
    fireEvent.drop(rowFor("test-coverage-rubric"), { dataTransfer: dt("s2") });

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "flaky-test-smells",
      "test-coverage-rubric",
      "api-contract-compat",
    ]);
    expect(within(rows[0]!).getByText("1")).toBeInTheDocument();
  });

  it("does not offer a drag on a skill that is not attached", () => {
    renderTab();
    expect(rowFor("api-contract-compat")).toHaveAttribute("draggable", "false");
    expect(rowFor("test-coverage-rubric")).toHaveAttribute("draggable", "true");
  });

  it("dropping on an unattached row changes nothing — it has no position to take", () => {
    renderTab();
    fireEvent.dragStart(rowFor("test-coverage-rubric"), { dataTransfer: dt() });
    fireEvent.drop(rowFor("api-contract-compat"), { dataTransfer: dt("s1") });

    expect(screen.getByText("Save skills").closest("button")).toBeDisabled();
    expect(screen.getByText("Up to date with the saved order.")).toBeInTheDocument();
  });

  it("detaching everything posts an empty list rather than doing nothing", () => {
    renderTab();
    fireEvent.click(within(rowFor("test-coverage-rubric")).getByRole("checkbox"));
    fireEvent.click(within(rowFor("flaky-test-smells")).getByRole("checkbox"));

    fireEvent.click(screen.getByText("Save skills").closest("button")!);
    expect(save).toHaveBeenCalledWith([], expect.anything());
  });

  it("marks a linked skill that is switched off globally instead of hiding it", () => {
    renderTab();
    // s2 is linked but disabled — the link is intact, the master switch is not.
    expect(within(rowFor("flaky-test-smells")).getByText("off")).toBeInTheDocument();
    expect(within(rowFor("test-coverage-rubric")).queryByText("off")).not.toBeInTheDocument();
  });

  it("filters the list without touching the draft", () => {
    renderTab();
    fireEvent.change(screen.getByPlaceholderText("Filter skills…"), {
      target: { value: "contract" },
    });
    expect(screen.getByText("api-contract-compat")).toBeInTheDocument();
    expect(screen.queryByText("flaky-test-smells")).not.toBeInTheDocument();
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
  });

  it("keeps an in-progress edit when the links query hands back a fresh array", () => {
    // The invalidation this tab's own save triggers gives `links` a new identity.
    // Resetting the draft on that would silently discard what the user is doing —
    // and a mock returning a frozen literal can never catch it.
    const { rerender } = renderTab();
    fireEvent.click(within(rowFor("api-contract-compat")).getByRole("checkbox"));
    expect(screen.getByText("Save skills").closest("button")).not.toBeDisabled();

    links = links.map((l) => ({ ...l })); // same contents, new identity
    rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ agents: agentMessages, skills: skillMessages }}
      >
        <ToastProvider>
          <SkillsTab agent={AGENT} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Save skills").closest("button")).not.toBeDisabled();
    fireEvent.click(screen.getByText("Save skills").closest("button")!);
    expect(save).toHaveBeenCalledWith(["s1", "s2", "s3"], expect.anything());
  });

  it("refuses to render the list when the links fetch failed", () => {
    // Falling through would show "0 of 3 enabled" — indistinguishable from an
    // agent with no skills — and the next Save would POST a replacement set that
    // deletes the links this tab never loaded.
    linksError = true;
    renderTab();
    expect(screen.queryByText("Save skills")).not.toBeInTheDocument();
    expect(screen.queryByText("test-coverage-rubric")).not.toBeInTheDocument();
    expect(screen.getByText("Could not load skills.")).toBeInTheDocument();
  });

  it("names each checkbox for a screen reader", () => {
    renderTab();
    expect(
      screen.getByRole("checkbox", { name: /Attach api-contract-compat/ }),
    ).toBeInTheDocument();
  });

  it("dropping a row onto itself is not a change", () => {
    renderTab();
    const row = rowFor("test-coverage-rubric");
    fireEvent.dragStart(row, { dataTransfer: dt() });
    fireEvent.drop(row, { dataTransfer: dt("s1") });

    expect(screen.getByText("Up to date with the saved order.")).toBeInTheDocument();
  });
});