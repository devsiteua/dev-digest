/**
 * The multi-agent picker: which agents, what it is likely to cost, and the one
 * action that starts them.
 *
 * Four promises here are not visible in a screenshot. That every agent of the
 * workspace gets a checkbox and a disabled agent still says so (AC-20). That the
 * button's label carries the count (AC-20) and that zero selected means a
 * disabled button AND no request (AC-21) — two different rules, because
 * `fireEvent` will happily click a disabled button and so will a keyboard. That
 * an agent with no completed run reads as a sentence rather than a zero or a
 * dash (AC-22), and that the numbers are labelled as estimates (AC-23). And that
 * a workspace with nothing enabled gets a way out instead of an empty grid
 * (AC-31).
 *
 * Interaction is driven with `fireEvent`: `@testing-library/user-event` is not a
 * dependency of this package (`client/INSIGHTS.md`, 2026-08-22).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, RunEstimate } from "@devdigest/shared";
import multiAgent from "../../../../../../../../messages/en/multiAgent.json";

const push = vi.fn();
const mutateAsync = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ push, replace: vi.fn() }),
}));

let agents: Agent[] = [];
let agentsLoading = false;
let estimates: RunEstimate[] | undefined = [];
let estimatesLoading = false;

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: agents, isLoading: agentsLoading }),
}));

vi.mock("@/lib/hooks/core", () => ({
  usePulls: () => ({ data: [{ id: "pr-1", number: 482, title: "Add rate limiting" }] }),
}));

vi.mock("@/lib/hooks/multi-agent", () => ({
  useRunEstimate: () => ({ data: estimates, isLoading: estimatesLoading }),
  useStartMultiAgentRun: () => ({
    mutateAsync,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { MultiAgentPicker } from "./MultiAgentPicker";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const agent = (id: string, name: string, enabled = true): Agent =>
  ({
    id,
    name,
    description: "",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    system_prompt: "s",
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    project_context: true,
    enabled,
    version: 1,
  }) as unknown as Agent;

const estimate = (
  agentId: string,
  over: Partial<RunEstimate> = {},
): RunEstimate => ({
  agent_id: agentId,
  agent_name: agentId,
  enabled: true,
  runs_sampled: 3,
  avg_duration_ms: 8_000,
  avg_cost_usd: 0.004,
  ...over,
});

/** The five agents of a seeded workspace: three enabled, two not. */
const FIVE = [
  agent("a-general", "General Reviewer"),
  agent("a-security", "Security Reviewer"),
  agent("a-performance", "Performance Reviewer"),
  agent("a-test", "Test Quality Reviewer", false),
  agent("a-contract", "API Contract Reviewer", false),
];

const renderPicker = (prId: string | null = "pr-1") =>
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
      <MultiAgentPicker prId={prId} />
    </NextIntlClientProvider>,
  );

/** The run button, by its accessible name — the label carries the count. */
const runButton = () => screen.getByRole("button", { name: /Run multi-agent review/ });

/** A checkbox by the agent it belongs to; throws rather than returning undefined. */
const checkboxFor = (name: string): HTMLElement => {
  const box = screen.getAllByRole("checkbox").find((el) => el.closest("label")?.textContent?.includes(name));
  if (!box) throw new Error(`no checkbox for agent "${name}"`);
  return box;
};

beforeEach(() => {
  agents = FIVE;
  agentsLoading = false;
  estimates = FIVE.map((a) => estimate(a.id));
  estimatesLoading = false;
  push.mockClear();
  mutateAsync.mockClear();
  mutateAsync.mockResolvedValue({ pr_id: "pr-1", runs: [{ run_id: "run-1" }], reviews: [] });
});
afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("MultiAgentPicker — the agents (AC-20, AC-31)", () => {
  it("gives every agent of the workspace a checkbox, and says which ones are disabled", () => {
    renderPicker();

    // Five agents, five checkboxes — a disabled agent is still shown, because
    // its absence would read as "this workspace has three agents".
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    for (const a of FIVE) expect(screen.getByText(a.name)).toBeInTheDocument();

    // Three of them are enabled: the marker appears exactly twice.
    expect(screen.getAllByText(/· disabled$/)).toHaveLength(2);
  });

  it("starts with nothing ticked, because a run costs money", () => {
    renderPicker();
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).toHaveAttribute("aria-checked", "false");
    }
  });

  it("shows the empty state with a way to /agents when nothing is enabled (AC-31)", () => {
    agents = FIVE.map((a) => agent(a.id, a.name, false));
    renderPicker();

    expect(screen.getByText("Enable agents to run reviews")).toBeInTheDocument();
    // Not an empty grid of columns, and not a dead end.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Go to Agents" }));
    expect(push).toHaveBeenCalledWith("/agents");
  });

  it("shows the same empty state when the workspace has no agents at all (AC-31)", () => {
    agents = [];
    renderPicker();
    expect(screen.getByText("Enable agents to run reviews")).toBeInTheDocument();
  });
});

describe("MultiAgentPicker — the button (AC-20, AC-21)", () => {
  it("carries the number of ticked agents in its label", () => {
    renderPicker();
    expect(runButton()).toHaveTextContent("Run multi-agent review (0)");

    fireEvent.click(checkboxFor("Security Reviewer"));
    expect(runButton()).toHaveTextContent("Run multi-agent review (1)");

    fireEvent.click(checkboxFor("General Reviewer"));
    expect(runButton()).toHaveTextContent("Run multi-agent review (2)");

    // And back down: the label follows the count in both directions.
    fireEvent.click(checkboxFor("Security Reviewer"));
    expect(runButton()).toHaveTextContent("Run multi-agent review (1)");
  });

  it("is disabled with nothing selected, and sends no request when clicked anyway (AC-21)", () => {
    renderPicker();

    expect(runButton()).toBeDisabled();
    // The second half of the criterion, and the reason it is not the same
    // assertion twice: `fireEvent` clicks disabled elements that `userEvent`
    // would refuse, so this is the guard inside the handler being tested.
    fireEvent.click(runButton());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("is disabled while no pull request is chosen, even with agents ticked", () => {
    renderPicker(null);
    fireEvent.click(checkboxFor("Security Reviewer"));

    expect(runButton()).toBeDisabled();
    fireEvent.click(runButton());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("posts exactly the ticked agents, and lands on the results route", async () => {
    renderPicker();
    fireEvent.click(checkboxFor("Security Reviewer"));
    fireEvent.click(checkboxFor("Performance Reviewer"));

    fireEvent.click(runButton());
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    expect(mutateAsync).toHaveBeenCalledWith({
      prId: "pr-1",
      agentIds: ["a-security", "a-performance"],
    });
    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent?pr=482"),
    );
  });

  // Found by hand, not by this suite: on the results route the picker's success
  // path was `router.push` to the URL the browser was ALREADY on — a no-op. The
  // picker stayed open, the click read as "nothing happened", and pressing again
  // started another real run. Four three-agent runs were billed before anyone
  // realised. A parent that hands in `onStarted` owns the transition and must be
  // told instead of navigated.
  it("tells a parent on the results route rather than pushing the URL it is already on", async () => {
    const onStarted = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
        <MultiAgentPicker prId="pr-1" onStarted={onStarted} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(checkboxFor("Security Reviewer"));

    fireEvent.click(runButton());
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));

    // The run really was started, and the dead push is gone.
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("MultiAgentPicker — the estimate (AC-22, AC-23)", () => {
  it("says there is no data rather than showing a zero or a dash (AC-22)", () => {
    estimates = FIVE.map((a) =>
      estimate(a.id, { runs_sampled: 0, avg_duration_ms: null, avg_cost_usd: null }),
    );
    renderPicker();

    // Per agent, and in words: "no data yet — …". A "$0.00" here would claim the
    // run is free and a "—" would claim nothing at all.
    expect(screen.getAllByText(/no data yet/)).toHaveLength(5);
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();

    fireEvent.click(checkboxFor("Security Reviewer"));
    expect(
      screen.getByText("Estimated total: no completed runs to estimate from yet"),
    ).toBeInTheDocument();
  });

  it("says it per agent, so one agent without history does not blank the panel (AC-22)", () => {
    estimates = [
      estimate("a-general"),
      estimate("a-security"),
      estimate("a-performance"),
      estimate("a-test", { runs_sampled: 0, avg_duration_ms: null, avg_cost_usd: null }),
      estimate("a-contract", { runs_sampled: 0, avg_duration_ms: null, avg_cost_usd: null }),
    ];
    renderPicker();

    expect(screen.getAllByText(/no data yet/)).toHaveLength(2);
    expect(screen.getAllByText(/^est\. ~/)).toHaveLength(3);
  });

  it("labels the numbers as estimates rather than as facts (AC-23)", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Security Reviewer"));
    fireEvent.click(checkboxFor("General Reviewer"));

    // Per agent: the qualifier is in the copy, not in a tooltip.
    expect(screen.getAllByText("est. ~8.0s · ~$0.004").length).toBeGreaterThan(0);
    // And the total sums only the ticked ones — two of the five.
    expect(
      screen.getByText("Estimated total for the selection: ~16.0s · ~$0.008"),
    ).toBeInTheDocument();
  });

  it("keeps the duration and drops the cost when a model is unpriced", () => {
    // Null is unknown, 0 is free. A total that folded an unpriced model in as a
    // zero would quote a number it knows to be too low.
    estimates = [estimate("a-security", { avg_cost_usd: null }), estimate("a-general")];
    renderPicker();
    fireEvent.click(checkboxFor("Security Reviewer"));
    fireEvent.click(checkboxFor("General Reviewer"));

    expect(
      screen.getByText(
        "Estimated total for the selection: ~16.0s · cost not recorded for these models",
      ),
    ).toBeInTheDocument();
  });

  it("shows no per-agent estimate at all until a pull request is chosen", () => {
    renderPicker(null);
    expect(screen.queryByText(/no data yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^est\. ~/)).not.toBeInTheDocument();
  });
});
