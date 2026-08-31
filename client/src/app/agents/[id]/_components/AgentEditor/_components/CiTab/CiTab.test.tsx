import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentCiView, CiInstallation, CiRun } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/ci.json";

const agentCi = vi.fn();
const exportMutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/ci", () => ({
  useAgentCi: () => agentCi(),
  // The tab mounts the wizard, which reads these two.
  useCiPreview: () => ({ data: [], isLoading: false, isError: false, isSuccess: false, error: null }),
  useExportToCi: () => ({
    mutate: exportMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
  }),
}));

const updateMutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: updateMutate, isPending: false, isSuccess: false }),
}));

import { CiTab } from "./CiTab";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4",
  system_prompt: "x",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  project_context: true,
  enabled: true,
  version: 1,
};

const INSTALLATION: CiInstallation = {
  id: "inst1",
  agent_id: "ag1",
  repo: "acme/payments-api",
  target_type: "gha",
  installed_at: "2026-08-29T09:15:00.000Z",
};

const RUN: CiRun = {
  id: "cr1",
  ci_installation_id: "inst1",
  repo: "acme/payments-api",
  pr_number: 412,
  ran_at: "2026-08-29T10:15:00.000Z",
  status: "failed",
  findings_count: 7,
  cost_usd: 0.0132,
  github_url: "https://github.com/acme/payments-api/actions/runs/9001",
  source: "gha",
  agent: "Security Reviewer",
  duration_s: 42.4,
};

const VIEW: AgentCiView = {
  installations: [INSTALLATION],
  runs: [RUN],
  runner_version: "1",
};

const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiTab agent={AGENT} />
    </NextIntlClientProvider>,
  );

/** The patch handed to the agent update, or a failure naming the miss. */
function updateCall() {
  const [arg] = updateMutate.mock.calls.at(0) ?? [];
  if (!arg || typeof arg !== "object") throw new Error("useUpdateAgent().mutate was never called");
  return arg as { id: string; patch: Record<string, unknown> };
}

beforeEach(() => {
  updateMutate.mockClear();
  exportMutate.mockClear();
  agentCi.mockReturnValue({ data: VIEW, isLoading: false, isError: false, refetch: vi.fn() });
});
afterEach(cleanup);

describe("Agent editor → CI tab", () => {
  // AC-27 — installations, the runner version, this agent's recent runs and the
  // gate, and nothing `ci_installations` does not carry.
  it("renders the installation, the runner version, recent runs and the gate", () => {
    renderTab();

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("gha")).toBeInTheDocument();
    expect(screen.getByText(/^installed .*2026/)).toBeInTheDocument();

    // `Runner v1` comes from the constant the engine reports, not from a column.
    expect(screen.getByText("Runner v1")).toBeInTheDocument();

    expect(screen.getByText("Recent CI runs")).toBeInTheDocument();
    expect(screen.getByText("#412")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View job" })).toHaveAttribute(
      "href",
      RUN.github_url,
    );

    expect(screen.getByText("Fail CI on")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("critical");
  });

  // AC-01 — «Add to CI» on the populated tab opens the wizard modal.
  it("opens the Export Wizard from Add to CI", () => {
    renderTab();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add to CI" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // AC-28 — the gate is saved through the ordinary agent update, and that is
  // the whole request: a rule living in a callback is invisible to a grep, so
  // it is asserted on the mutation's arguments.
  it("saves Fail CI on through the agent update and issues no other request", () => {
    renderTab();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "any" } });

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateCall()).toEqual({ id: "ag1", patch: { ci_fail_on: "any" } });
    // Exactly one key: the tab may change the gate and nothing else about the agent.
    expect(Object.keys(updateCall().patch)).toEqual(["ci_fail_on"]);
    // And no CI endpoint of its own was added for it.
    expect(exportMutate).not.toHaveBeenCalled();
  });

  // AC-29 — no installation is a designed state, told apart from "we have not
  // asked yet" by the loading screen above it.
  it("renders the Not exported to CI empty state with its Export to CI CTA", () => {
    agentCi.mockReturnValue({
      data: { installations: [], runs: [], runner_version: "1" } satisfies AgentCiView,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderTab();

    expect(screen.getByText("Not exported to CI")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export to CI" })).toBeInTheDocument();
    // The populated tab's controls must not render beside the empty state.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent CI runs")).not.toBeInTheDocument();
  });

  // AC-29 — and the loading state is not the empty state.
  it("does not offer an export while the tab is still loading", () => {
    agentCi.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    renderTab();

    expect(screen.queryByText("Not exported to CI")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export to CI" })).not.toBeInTheDocument();
  });
});
