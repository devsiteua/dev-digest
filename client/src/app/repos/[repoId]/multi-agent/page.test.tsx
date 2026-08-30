/**
 * /repos/:repoId/multi-agent?pr=<number> — the results page.
 *
 * Four of its rules are only decidable HERE, at the page, because they live in
 * state and in callbacks the page hands down (`client/INSIGHTS.md`, 2026-08-30 —
 * the same reason `skills/[id]/page.test.tsx` exists, and the mock shape is
 * copied from it):
 *
 *   AC-24 — a live event for ONE column leaves the other columns' status alone.
 *           The page merges the SSE map into the server's columns; the views
 *           render whatever they are handed.
 *   AC-25 — `View trace` in the second column opens the drawer with the SECOND
 *           run's id. `onOpenTrace` is a closure the page owns; a `ColumnsView`
 *           test would only prove it calls whatever it was given.
 *   AC-26 — two modes over ONE fetched object: toggling does not refetch, and
 *           both modes render the same run.
 *   AC-27, AC-28 — the detail card's fields and its two honest stubs, reached
 *           through the mode toggle rather than mounted directly, so the page's
 *           own wiring of `groups` and `prId` is in the path.
 *
 * Interaction is `fireEvent`: `@testing-library/user-event` is not installed.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, FindingGroup, MultiAgentRun, RunEvent } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import multiAgent from "../../../../../messages/en/multiAgent.json";
import runs from "../../../../../messages/en/runs.json";
import shell from "../../../../../messages/en/shell.json";

// ---------------------------------------------------------------------------
// Mocks — every module the page reaches for, and nothing below them.
// ---------------------------------------------------------------------------

const push = vi.fn();
const replace = vi.fn();
let params = new URLSearchParams({ pr: "482" });

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => params,
}));

// The shell mounts the command palette and the global shortcuts; a page test
// renders neither.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/lib/hooks/core", () => ({
  usePulls: () => ({ data: [{ id: "pr-1", number: 482, title: "Add rate limiting" }], isLoading: false }),
}));

const findingAction = vi.fn();
let events: RunEvent[] = [];
let streaming = false;
/** Every run-id set the page ever subscribed to — AC-24's other half. */
const subscriptions: string[][] = [];

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [] }),
  useRunEvents: (ids: string[]) => {
    subscriptions.push(ids);
    return { events, running: streaming };
  },
  useFindingAction: () => ({ mutate: findingAction, isPending: false }),
}));

const refetch = vi.fn();
/** Every prId `useMultiAgentRun` was called with — one query key means one fetch. */
const queriedPrIds: (string | null)[] = [];
let run: {
  data?: MultiAgentRun;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} = { isLoading: false, isError: false, error: null };

// The hooks are stubbed, but `isNoMultiAgentRun` is the REAL one: it is the rule
// that decides between "this PR has no run yet" (a screen state) and "the engine
// is unreachable" (an error), and a restatement of it here would test my copy of
// the rule rather than the shipped one. The error fixtures below are real
// `ApiError`s for the same reason.
vi.mock("@/lib/hooks/multi-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks/multi-agent")>();
  return {
    isNoMultiAgentRun: actual.isNoMultiAgentRun,
    useMultiAgentRun: (prId: string | null) => {
      queriedPrIds.push(prId);
      return { ...run, refetch };
    },
    useRunEstimate: () => ({ data: [], isLoading: false }),
    useStartMultiAgentRun: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});

vi.mock("../pulls/[number]/_components/MultiAgentPicker", () => ({
  MultiAgentPicker: ({ prId, prControl }: { prId: string | null; prControl?: React.ReactNode }) => (
    <div data-testid="picker">
      picker · {String(prId)}
      {prControl}
    </div>
  ),
}));

/** Every set of props the drawer was mounted with, newest last. */
const drawerMounts: { runId: string; agentName: string | null; running: boolean }[] = [];

vi.mock("../pulls/[number]/_components/RunTraceDrawer", () => ({
  default: (props: { runId: string; agentName: string | null; running: boolean }) => {
    drawerMounts.push(props);
    return <div data-testid="trace-drawer">trace of {props.runId}</div>;
  },
}));

import MultiAgentReviewPage from "./page";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const column = (over: Partial<AgentColumn> & Pick<AgentColumn, "run_id" | "agent_name">): AgentColumn => ({
  agent_id: `ag-${over.run_id}`,
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  status: "done",
  error: null,
  verdict: "comment",
  score: 66,
  summary: "Readable middleware, one blocker.",
  duration_ms: 7_640,
  cost_usd: 0.0038,
  findings: [],
  ...over,
});

const FINDING_ONE = {
  id: "f-1",
  severity: "CRITICAL" as const,
  category: "security",
  title: "Hardcoded Stripe secret key committed to config",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "A live key sits in the repository and ships with the build.",
  suggestion: "Move it to an environment variable and rotate it.",
  confidence: 0.95,
  kind: "finding",
};

const FINDING_TWO = {
  id: "f-2",
  severity: "WARNING" as const,
  category: "perf",
  title: "N+1 query in the user list endpoint",
  file: "src/api/users.ts",
  start_line: 45,
  end_line: 52,
  rationale: "The loop issues one query per user.",
  suggestion: null,
  confidence: 0.84,
  kind: "finding",
};

const GROUP: FindingGroup = {
  key: "src/config.ts:12:f-1",
  file: "src/config.ts",
  start_line: 12,
  title: FINDING_ONE.title,
  severity: "CRITICAL",
  members: [
    {
      finding_id: "f-1",
      agent_id: "ag-run-1",
      agent_name: "Agent One",
      run_id: "run-1",
      title: FINDING_ONE.title,
      rationale: FINDING_ONE.rationale,
      suggestion: FINDING_ONE.suggestion,
      severity: "CRITICAL",
      confidence: 0.95,
    },
    {
      finding_id: "f-3",
      agent_id: "ag-run-2",
      agent_name: "Agent Two",
      run_id: "run-2",
      title: "Hardcoded Stripe secret key in config",
      rationale: "Not a performance problem, but it outranks one.",
      suggestion: null,
      severity: "CRITICAL",
      confidence: 0.9,
    },
  ],
};

const baseRun = (over: Partial<MultiAgentRun> = {}): MultiAgentRun => ({
  id: "mar-1",
  pr_id: "pr-1",
  pr_number: 482,
  ran_at: "2026-08-30T10:00:00.000Z",
  agent_count: 3,
  agents_considered: 3,
  total_duration_ms: 23_740,
  total_cost_usd: 0.0121,
  columns: [],
  groups: [],
  conflicts: [],
  ...over,
});

/** Three finished agents, two of them with a finding each. */
const FINISHED = baseRun({
  columns: [
    column({ run_id: "run-1", agent_name: "Agent One", findings: [FINDING_ONE] }),
    column({ run_id: "run-2", agent_name: "Agent Two", findings: [FINDING_TWO] }),
    column({ run_id: "run-3", agent_name: "Agent Three", findings: [] }),
  ],
  groups: [GROUP],
});

/** The same run mid-flight: every column still running, nothing decided yet. */
const IN_FLIGHT = baseRun({
  columns: ["run-1", "run-2", "run-3"].map((id, i) =>
    column({
      run_id: id,
      agent_name: ["Agent One", "Agent Two", "Agent Three"][i]!,
      status: "running",
      score: null,
      summary: null,
      duration_ms: null,
      cost_usd: null,
    }),
  ),
  agents_considered: 0,
  total_cost_usd: null,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent, runs, shell }}>
      <MultiAgentReviewPage />
    </NextIntlClientProvider>,
  );

/**
 * One agent's column card, found by walking up from its name to the first
 * ancestor that also holds the column's `View trace` link.
 *
 * A named helper that throws rather than a `!` on a query result:
 * `noUncheckedIndexedAccess` is on, and the throw names what was expected when
 * the column is simply not on the page.
 */
const columnCard = (agentName: string): HTMLElement => {
  let node: HTMLElement | null = screen.getByText(agentName);
  while (node && !node.textContent?.includes("View trace")) node = node.parentElement;
  if (!node) throw new Error(`no column card for "${agentName}"`);
  return node;
};

/**
 * The Tabs + detail panel, scoped away from `Where agents disagree`.
 *
 * Both blocks are on screen at once and both name the same place — that is the
 * design, not a bug: the disagreement block is a summary OF the findings the
 * panel lists. A bare `getByText` would therefore match twice and say nothing
 * about which block it found.
 */
const detailPanel = (): HTMLElement => {
  let node: HTMLElement | null = screen.getByRole("button", { name: /^Agent One/ });
  while (node && !node.textContent?.includes("Suggested fix:")) node = node.parentElement;
  if (!node) throw new Error("the Tabs + detail panel is not on screen");
  return node;
};

/** The props the drawer was last mounted with; throws when it never was. */
const lastDrawer = () => {
  const mount = drawerMounts.at(-1);
  if (!mount) throw new Error("the run-trace drawer was never mounted");
  return mount;
};

const modeChip = (label: string) => screen.getByRole("button", { name: label });

beforeEach(() => {
  params = new URLSearchParams({ pr: "482" });
  run = { data: FINISHED, isLoading: false, isError: false, error: null };
  events = [];
  streaming = false;
  drawerMounts.length = 0;
  subscriptions.length = 0;
  queriedPrIds.length = 0;
  push.mockClear();
  replace.mockClear();
  refetch.mockClear();
  findingAction.mockClear();
});
afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("the results page — live column status (AC-24)", () => {
  it("subscribes only to the runs that are still going", () => {
    run = { data: IN_FLIGHT, isLoading: false, isError: false, error: null };
    streaming = true;
    renderPage();

    expect(subscriptions.at(0)).toEqual(["run-1", "run-2", "run-3"]);
    // And nothing is subscribed once every run is terminal — a finished run has
    // no stream to read.
    cleanup();
    subscriptions.length = 0;
    streaming = false;
    run = { data: FINISHED, isLoading: false, isError: false, error: null };
    renderPage();
    expect(subscriptions.at(0)).toEqual([]);
  });

  it("a result event for one column leaves the other two running", () => {
    run = { data: IN_FLIGHT, isLoading: false, isError: false, error: null };
    streaming = true;
    events = [
      { runId: "run-2", kind: "result", message: "done", ts: "2026-08-30T10:00:05.000Z" },
    ] as unknown as RunEvent[];
    renderPage();

    // The event names ONE run id, and only that column moves.
    expect(within(columnCard("Agent Two")).getByText("done")).toBeInTheDocument();
    expect(within(columnCard("Agent One")).getByText("running")).toBeInTheDocument();
    expect(within(columnCard("Agent Three")).getByText("running")).toBeInTheDocument();
  });

  it("an error event marks that column failed and nothing else", () => {
    run = { data: IN_FLIGHT, isLoading: false, isError: false, error: null };
    streaming = true;
    events = [
      { runId: "run-3", kind: "error", message: "provider refused", ts: "2026-08-30T10:00:05.000Z" },
    ] as unknown as RunEvent[];
    renderPage();

    expect(within(columnCard("Agent Three")).getByText("failed")).toBeInTheDocument();
    expect(within(columnCard("Agent One")).getByText("running")).toBeInTheDocument();
  });

  it("never downgrades a column the server already reported as finished", () => {
    // The server's answer wins for a terminal run: a replayed event from an
    // earlier subscription must not turn a done column back into a stream's idea
    // of it.
    events = [
      { runId: "run-1", kind: "error", message: "stale replay", ts: "2026-08-30T10:00:05.000Z" },
    ] as unknown as RunEvent[];
    renderPage();

    expect(within(columnCard("Agent One")).getByText("done")).toBeInTheDocument();
  });
});

describe("the results page — View trace (AC-25)", () => {
  it("opens no drawer until something is clicked", () => {
    renderPage();
    expect(screen.queryByTestId("trace-drawer")).not.toBeInTheDocument();
  });

  it("hands the drawer the run id of the column that was clicked", () => {
    renderPage();

    fireEvent.click(within(columnCard("Agent Two")).getByText("View trace"));

    // The SECOND column's run, not the first and not the page's own run id.
    expect(screen.getByTestId("trace-drawer")).toHaveTextContent("trace of run-2");
    expect(lastDrawer().runId).toBe("run-2");
    expect(lastDrawer().agentName).toBe("Agent Two");
    expect(lastDrawer().running).toBe(false);
  });

  it("opens a different run when a different column is clicked", () => {
    renderPage();

    fireEvent.click(within(columnCard("Agent Three")).getByText("View trace"));
    expect(lastDrawer().runId).toBe("run-3");

    fireEvent.click(within(columnCard("Agent One")).getByText("View trace"));
    expect(lastDrawer().runId).toBe("run-1");
  });

  it("carries the click through from the Tabs mode too", () => {
    renderPage();
    fireEvent.click(modeChip("Tabs + detail"));

    fireEvent.click(screen.getByRole("button", { name: /^Agent Two/ }));
    fireEvent.click(screen.getByText("View trace"));

    expect(lastDrawer().runId).toBe("run-2");
  });
});

describe("the results page — two modes, one fetch (AC-26)", () => {
  it("renders the same run in both modes, and toggling twice refetches nothing", () => {
    renderPage();

    // Columns mode: one card per agent.
    expect(screen.getByText("Agent One")).toBeInTheDocument();
    expect(screen.getByText("Agent Three")).toBeInTheDocument();

    fireEvent.click(modeChip("Tabs + detail"));
    // Tabs mode, same three agents and the same finding — one object, two views.
    expect(screen.getByRole("button", { name: /^Agent Three/ })).toBeInTheDocument();
    expect(within(detailPanel()).getByText(FINDING_ONE.title)).toBeInTheDocument();

    fireEvent.click(modeChip("Columns"));
    expect(screen.getByText("Agent Two")).toBeInTheDocument();

    fireEvent.click(modeChip("Tabs + detail"));
    fireEvent.click(modeChip("Columns"));

    // The criterion: no second request. The page holds one query and never
    // refetches on a mode change.
    expect(refetch).not.toHaveBeenCalled();
    expect(new Set(queriedPrIds)).toEqual(new Set(["pr-1"]));
  });

  it("shows the run's totals above both modes", () => {
    renderPage();
    expect(screen.getByText("3 agents · 23.7s total · $0.0121")).toBeInTheDocument();
  });
});

describe("the results page — the detail card (AC-27, AC-28)", () => {
  const openDetail = () => {
    renderPage();
    fireEvent.click(modeChip("Tabs + detail"));
  };

  it("shows confidence, the suggested fix and all four actions", () => {
    openDetail();

    // The first card of the active tab opens expanded — the whole point of the
    // mode is that a finding is readable without a second click.
    const panel = within(detailPanel());
    expect(panel.getByText(FINDING_ONE.title)).toBeInTheDocument();
    expect(panel.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(panel.getByText("95% conf")).toBeInTheDocument();
    expect(panel.getByText("Suggested fix:")).toBeInTheDocument();
    expect(panel.getByText(FINDING_ONE.suggestion)).toBeInTheDocument();
    for (const action of ["Accept", "Dismiss", "Learn", "Turn into eval case"]) {
      expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
    }
  });

  it("badges a finding two agents flagged, and shows each agent's own words verbatim", () => {
    openDetail();

    expect(within(detailPanel()).getByText("2 agents flagged this place")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Show what each agent said"));

    // The member's title is the one ITS agent wrote, not the group's.
    expect(screen.getByText("Hardcoded Stripe secret key in config")).toBeInTheDocument();
    expect(screen.getByText("Agent One · CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("Agent Two · CRITICAL")).toBeInTheDocument();
  });

  it("Accept and Dismiss go through the shipped finding action, with the page's PR id", () => {
    openDetail();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(findingAction).toHaveBeenCalledTimes(1);
    expect(findingAction.mock.calls.at(0)?.[0]).toEqual({
      findingId: "f-1",
      action: "accept",
      prId: "pr-1",
    });
  });

  it("Learn says which lesson owns the endpoint, and issues no request (AC-28)", () => {
    openDetail();

    fireEvent.click(screen.getByRole("button", { name: "Learn" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Learn is not wired up yet");
    expect(alert).toHaveTextContent("L07's memory half");
    expect(alert).toHaveTextContent("Nothing was saved.");
    // The stub is honest precisely because nothing was attempted.
    expect(findingAction).not.toHaveBeenCalled();
  });

  it("Turn into eval case names L06, and issues no request (AC-28)", () => {
    openDetail();

    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Turn into eval case is not wired up yet");
    expect(alert).toHaveTextContent("L06");
    expect(findingAction).not.toHaveBeenCalled();
  });

  it("does not hide the message a second later", () => {
    // A stub that disappears is the "pretend it worked" this form exists to
    // avoid: the message stays until the reader navigates away.
    vi.useFakeTimers();
    try {
      openDetail();
      fireEvent.click(screen.getByRole("button", { name: "Learn" }));
      vi.advanceTimersByTime(10_000);
      expect(screen.getByRole("alert")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the results page — the states around the run", () => {
  it("shows the picker, not an empty grid, when this PR has no multi-agent run", () => {
    run = {
      isLoading: false,
      isError: true,
      error: new ApiError(
        "No multi-agent run has been started for this pull request",
        404,
        "no_multi_agent_run",
      ),
    };
    renderPage();

    expect(screen.getByText("No multi-agent run yet")).toBeInTheDocument();
    expect(screen.getByTestId("picker")).toHaveTextContent("picker · pr-1");
    // And it does NOT read as an outage.
    expect(screen.queryByText("Couldn't load this multi-agent run")).not.toBeInTheDocument();
  });

  it("shows an error, not the picker, when the read failed for any other reason", () => {
    run = {
      isLoading: false,
      isError: true,
      error: new ApiError("connection refused", 500, "internal_error"),
    };
    renderPage();

    expect(screen.getByText("Couldn't load this multi-agent run")).toBeInTheDocument();
    expect(screen.queryByTestId("picker")).not.toBeInTheDocument();
  });

  it("shows an error when the request never reached the API at all", () => {
    // Not an `ApiError`: nothing answered, so there is no code to read and the
    // "no run yet" reading would be an invention.
    run = { isLoading: false, isError: true, error: new Error("Failed to fetch") };
    renderPage();

    expect(screen.getByText("Couldn't load this multi-agent run")).toBeInTheDocument();
    expect(screen.queryByTestId("picker")).not.toBeInTheDocument();
  });

  it("re-opens the picker over an existing run on Start New Review, and never auto-starts", () => {
    renderPage();

    // Coming back to the page shows the LAST run — the picker is not on screen
    // until it is asked for.
    expect(screen.queryByTestId("picker")).not.toBeInTheDocument();
    fireEvent.click(modeChip("Start New Review"));

    expect(screen.getByTestId("picker")).toHaveTextContent("picker · pr-1");
    expect(refetch).not.toHaveBeenCalled();
  });

  it("asks for a pull request when the URL names none", () => {
    params = new URLSearchParams();
    run = { isLoading: false, isError: false, error: null };
    renderPage();

    expect(screen.getByText("Pick a pull request")).toBeInTheDocument();
    expect(screen.getByTestId("picker")).toHaveTextContent("picker · null");
  });
});
