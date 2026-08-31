/**
 * "Where agents disagree" — the block under both view modes.
 *
 * Two rules live only here. `Show only conflicts` has to HIDE the places the
 * agents agreed about, which is why the block is handed the groups as well as
 * the conflicts: a block that could only ever show conflicts would give the
 * switch nothing to do (AC-29). And an agent that finished and stayed silent
 * renders as `did not flag` — the server leaves that take's note empty on
 * purpose, so the English is the client's (AC-29).
 *
 * The third is AC-37's line: when some agent of the run did not finish, the
 * block says how many of them it speaks for.
 *
 * Interaction is `fireEvent`; `@testing-library/user-event` is not installed.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Conflict, FindingGroup } from "@devdigest/shared";
import multiAgent from "../../../../../../../messages/en/multiAgent.json";
import runs from "../../../../../../../messages/en/runs.json";

import { DisagreeBlock } from "./DisagreeBlock";

// ---------------------------------------------------------------------------
// Fixtures — the shape the server returns for the seeded demo run.
// ---------------------------------------------------------------------------

const member = (agent: string, over: Partial<FindingGroup["members"][number]> = {}) => ({
  finding_id: `f-${agent}`,
  agent_id: `ag-${agent}`,
  agent_name: agent,
  run_id: `run-${agent}`,
  title: "Hardcoded Stripe secret key",
  rationale: "A live key is committed.",
  suggestion: null,
  severity: "CRITICAL" as const,
  confidence: 0.95,
  ...over,
});

/** Every agent flagged this one — an agreement, and the thing the switch hides. */
const AGREED: FindingGroup = {
  key: "src/config.ts:12:f-sec",
  file: "src/config.ts",
  start_line: 12,
  title: "Hardcoded Stripe secret key",
  severity: "CRITICAL",
  members: [member("Security"), member("General"), member("Performance")],
};

/** One agent flagged this one; the other two finished and did not. */
const CONTENDED: FindingGroup = {
  key: "src/api/users.ts:45:f-perf",
  file: "src/api/users.ts",
  start_line: 45,
  title: "N+1 query in the user list endpoint",
  severity: "WARNING",
  members: [
    member("Performance", {
      finding_id: "f-perf",
      title: "N+1 query in the user list endpoint",
      severity: "WARNING",
    }),
  ],
};

const CONFLICT: Conflict = {
  file: "src/api/users.ts",
  line: 45,
  title: "N+1 query in the user list endpoint",
  takes: [
    {
      agent_id: "ag-Performance",
      persona: "Performance Reviewer",
      verdict: "WARNING",
      note: "N+1 query in the user list endpoint",
    },
    // The server writes an EMPTY note for a silent agent: an absent stance is
    // not English the server owns.
    { agent_id: "ag-Security", persona: "Security Reviewer", verdict: "ignored", note: "" },
    { agent_id: "ag-General", persona: "General Reviewer", verdict: "ignored", note: "" },
  ],
};

const renderBlock = (
  over: Partial<React.ComponentProps<typeof DisagreeBlock>> = {},
) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent, runs }}>
      <DisagreeBlock
        groups={[AGREED, CONTENDED]}
        conflicts={[CONFLICT]}
        agentsConsidered={3}
        agentCount={3}
        {...over}
      />
    </NextIntlClientProvider>,
  );

const onlyConflictsSwitch = () => screen.getByRole("switch");

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("DisagreeBlock — Show only conflicts (AC-29)", () => {
  it("lists both the contended place and the agreed one while the switch is off", () => {
    renderBlock();

    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    // The agreed place says how many agents were behind it, rather than pretending
    // to be a disagreement.
    expect(screen.getByText("3 agents flagged this place")).toBeInTheDocument();
    expect(onlyConflictsSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("hides every non-conflict group when the switch is on, and shows them again when it is off", () => {
    renderBlock();

    fireEvent.click(onlyConflictsSwitch());

    expect(onlyConflictsSwitch()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("src/api/users.ts:45")).toBeInTheDocument();
    // The place all three agreed on is gone — that is the whole job of the switch.
    expect(screen.queryByText("src/config.ts:12")).not.toBeInTheDocument();
    expect(screen.queryByText("3 agents flagged this place")).not.toBeInTheDocument();

    fireEvent.click(onlyConflictsSwitch());
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
  });

  it("renders an `ignored` take as `did not flag`, under the agent's own name", () => {
    renderBlock();

    // One take per agent: the flagger keeps its severity, the two that finished
    // and said nothing read as `did not flag`.
    expect(screen.getAllByText("did not flag")).toHaveLength(2);
    expect(screen.getByText("WARNING")).toBeInTheDocument();
    for (const persona of ["Performance Reviewer", "Security Reviewer", "General Reviewer"]) {
      expect(screen.getByText(persona)).toBeInTheDocument();
    }
  });

  it("says the agents agree when there is nothing to show at all", () => {
    renderBlock({ groups: [], conflicts: [] });

    expect(
      screen.getByText("No conflicts — the agents agree on every flagged location."),
    ).toBeInTheDocument();
  });

  it("still says so when the switch hides the only groups there were", () => {
    // Groups but no conflicts: with the switch on there is genuinely nothing
    // left, and an empty list would be a blank block.
    renderBlock({ groups: [AGREED], conflicts: [] });

    fireEvent.click(onlyConflictsSwitch());
    expect(
      screen.getByText("No conflicts — the agents agree on every flagged location."),
    ).toBeInTheDocument();
  });
});

describe("DisagreeBlock — how many agents it speaks for (AC-37)", () => {
  it("says `2 of 3` when one agent of the run did not finish", () => {
    renderBlock({ agentsConsidered: 2, agentCount: 3 });

    expect(
      screen.getByText(
        "2 of 3 agents considered — the rest did not finish, so their silence is not a disagreement.",
      ),
    ).toBeInTheDocument();
  });

  it("says nothing when every agent finished", () => {
    // "3 of 3" is noise. The line exists to explain a missing opinion, so it
    // appears only when one is missing.
    renderBlock({ agentsConsidered: 3, agentCount: 3 });

    expect(screen.queryByText(/agents considered/)).not.toBeInTheDocument();
  });

  it("says `0 of 3` when nothing finished, rather than staying silent", () => {
    renderBlock({ agentsConsidered: 0, agentCount: 3, groups: [], conflicts: [] });

    expect(screen.getByText(/^0 of 3 agents considered/)).toBeInTheDocument();
  });
});
