import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

/** Set by a test that needs the L03 slot; the drawer reads the trace via the hook. */
let intentSlot: string | null = null;
/** Undefined on every trace written before the scope gate existed. */
let scopeGate: string | undefined;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({
    data: {
      ...TRACE,
      stats: { ...TRACE.stats, ...(scopeGate === undefined ? {} : { scope_gate: scopeGate }) },
      prompt_assembly: { ...TRACE.prompt_assembly, intent: intentSlot },
    },
    isLoading: false,
  }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  intentSlot = null;
  scopeGate = undefined;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("shows what the scope gate did, beside grounding", () => {
    scopeGate = "2/6 in scope; 1 out-of-scope CRITICAL kept as the signal";
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText(/1 out-of-scope CRITICAL kept as the signal/)).toBeInTheDocument();
  });

  it("says nothing about a gate that did not exist when the run was written", () => {
    // `scope_gate` is nullish precisely so a historical trace still opens; the
    // absence must render as no badge, never as a dash.
    scopeGate = undefined;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.queryByText(/in scope/)).not.toBeInTheDocument();
  });

  it("shows the derived-intent prompt block only when the run had one", () => {
    // The slot is absent on most PRs, so "absent" has to render as no block at
    // all rather than an empty labelled one.
    // "Prompt assembly" ships collapsed, so it has to be opened before any of
    // this is on the page at all — asserting against the closed section would
    // pass for both cases and prove nothing.
    intentSlot = null;
    const { unmount } = renderWithIntl(
      <RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.queryByText(/PR intent/)).not.toBeInTheDocument();
    unmount();

    intentSlot = "Kind: feature\nIntent: rate-limit";
    renderWithIntl(
      <RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.getByText(/PR intent/)).toBeInTheDocument();
    intentSlot = null;
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});
