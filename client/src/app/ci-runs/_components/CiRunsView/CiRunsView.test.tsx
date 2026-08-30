import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import messages from "../../../../../messages/en/ci.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// The shell needs repo context, theme and the PR query; none of that is what
// this screen is about, so it is stubbed down to its children.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const useCiRuns = vi.fn();
vi.mock("../../../../lib/hooks/ci", () => ({
  useCiRuns: () => useCiRuns(),
}));

import { CiRunsView } from "./CiRunsView";

/**
 * One run with every column populated, so a dropped column is a red test and
 * not a dash that reads like real data.
 */
const RUN: CiRun = {
  id: "cr1",
  ci_installation_id: "inst1",
  repo: "acme/payments-api",
  pr_number: 412,
  ran_at: "2026-08-29T09:15:00.000Z",
  status: "failed",
  findings_count: 7,
  cost_usd: 0.0132,
  github_url: "https://github.com/acme/payments-api/actions/runs/9001",
  source: "gha",
  agent: "Security Reviewer",
  duration_s: 42.4,
};

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiRunsView />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  push.mockClear();
  useCiRuns.mockReturnValue({
    data: [RUN],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});
afterEach(cleanup);

describe("CI Runs page", () => {
  // AC-24 — the row carries repository, #N, agent, status, findings, cost,
  // duration and a link to the Actions job.
  it("renders every column the criterion names for one run", () => {
    renderView();

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("$0.0132")).toBeInTheDocument();
    expect(screen.getByText("42s")).toBeInTheDocument();

    // The pull request is linked to github.com — the target repository need not
    // be imported into the studio, so there is no local page to open.
    expect(screen.getByRole("link", { name: "#412" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/pull/412",
    );
    // AC-24's last column: the link's href is the job URL as ingested, not a
    // URL rebuilt from parts.
    expect(screen.getByRole("link", { name: "View job" })).toHaveAttribute(
      "href",
      RUN.github_url,
    );
  });

  // AC-25 — no runs is a designed state, not an empty table.
  it("renders the empty state with the export CTA when nothing has run in CI", () => {
    useCiRuns.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();

    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    // The CTA leads to the agents list, which is where an agent is exported from.
    fireEvent.click(screen.getByRole("button", { name: "Set up CI for an agent" }));
    expect(push).toHaveBeenCalledWith("/agents");

    // The table must not render alongside the empty state.
    expect(screen.queryByText("Repository")).not.toBeInTheDocument();
  });
});
