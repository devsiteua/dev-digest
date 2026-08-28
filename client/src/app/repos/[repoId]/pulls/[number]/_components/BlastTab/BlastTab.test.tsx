import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

const resync = vi.fn();
let stored: BlastRadiusResponse | null = null;
let loading = false;
let lastEnabled: boolean | undefined;

vi.mock("@/lib/hooks/blast", () => ({
  useBlast: (_prId: string | null, enabled?: boolean) => {
    lastEnabled = enabled;
    return { data: stored, isLoading: loading };
  },
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate: resync, isPending: false }),
}));

import { BlastTab } from "./BlastTab";

const SHA = "13d9abb35ff2c4c29f061c5ae9910fda5a2878ff";

const POPULATED: BlastRadiusResponse = {
  changed_symbols: [
    { name: "canManageUsers", file: "src/auth/authorization.ts", kind: "function" },
    { name: "canViewOrder", file: "src/auth/authorization.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "canManageUsers",
      callers: [{ name: "listDirectory", file: "src/api/admin-router.ts", line: 28 }],
      endpoints_affected: ["GET /admin/users"],
      crons_affected: [],
    },
    {
      symbol: "canViewOrder",
      callers: [
        { name: "assertOrderVisible", file: "src/orders/order-access.ts", line: 5 },
        { name: "runOrderDigest", file: "src/jobs/order-digest.ts", line: 18 },
      ],
      endpoints_affected: ["GET /orders", "GET /orders/:id"],
      crons_affected: ["0 * * * *"],
    },
  ],
  summary: "2 symbols changed → 3 callers, 3 endpoints, 1 cron/job, as indexed at 13d9abb.",
  status: "ok",
  reason: null,
  indexed_sha: SHA,
};

const renderTab = (over: Partial<React.ComponentProps<typeof BlastTab>> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastTab
        prId="pr-1"
        repoId="repo-1"
        repoFullName="devsiteua/devdigest-review-fixtures"
        ready
        {...over}
      />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  stored = null;
  loading = false;
  lastEnabled = undefined;
  resync.mockReset();
});
afterEach(cleanup);

describe("BlastTab — the populated map", () => {
  beforeEach(() => {
    stored = POPULATED;
  });

  it("shows the four stats over DISTINCT endpoints and crons", () => {
    renderTab();
    // Each stat is one span reading "<n><label>".
    expect(screen.getByText("symbols")).toHaveTextContent("2symbols");
    expect(screen.getByText("callers")).toHaveTextContent("3callers");
    // Three routes across the two symbols, counted once each.
    expect(screen.getByText("endpoints")).toHaveTextContent("3endpoints");
    expect(screen.getByText("cron/jobs")).toHaveTextContent("1cron/jobs");
  });

  it("lists every changed symbol with its caller count, collapsed", () => {
    renderTab();
    expect(screen.getByText("canManageUsers()")).toBeInTheDocument();
    expect(screen.getByText("canViewOrder()")).toBeInTheDocument();
    expect(screen.getByText("1 callers")).toBeInTheDocument();
    expect(screen.getByText("2 callers")).toBeInTheDocument();
    // Callers only appear once a symbol is expanded.
    expect(screen.queryByText(/order-access\.ts:5/)).not.toBeInTheDocument();
  });

  it("reveals callers, endpoint badges and cron badges when a symbol is opened", () => {
    renderTab();
    fireEvent.click(screen.getByText("canViewOrder()"));

    expect(screen.getByText("src/orders/order-access.ts:5")).toBeInTheDocument();
    expect(screen.getByText("src/jobs/order-digest.ts:18")).toBeInTheDocument();
    expect(screen.getByText("GET /orders")).toBeInTheDocument();
    expect(screen.getByText("GET /orders/:id")).toBeInTheDocument();
    expect(screen.getByText("0 * * * *")).toBeInTheDocument();
  });

  it("links a caller's file:line to github at the INDEXED sha, on the recorded line", () => {
    renderTab();
    fireEvent.click(screen.getByText("canViewOrder()"));

    const link = screen.getByText("src/orders/order-access.ts:5").closest("a");
    // The sha is the index's, never the PR's head: the line number came out of
    // the index built at that commit.
    expect(link).toHaveAttribute(
      "href",
      `https://github.com/devsiteua/devdigest-review-fixtures/blob/${SHA}/src/orders/order-access.ts#L5`,
    );
  });

  it("renders the file:line as plain text when the repository name is unknown", () => {
    renderTab({ repoFullName: null });
    fireEvent.click(screen.getByText("canViewOrder()"));
    expect(screen.getByText("src/orders/order-access.ts:5").closest("a")).toBeNull();
  });

  it("says which commit the map was read at", () => {
    renderTab();
    expect(screen.getByText("Indexed at 13d9abb")).toBeInTheDocument();
  });

  it("switches to the graph and back", () => {
    renderTab();
    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("graph"));
    const svg = screen.getByRole("img", { name: "Blast radius graph" });
    expect(svg).toBeInTheDocument();
    // The graph opens on the symbol that reaches the most, not on the first.
    // Node labels are trimmed to what fits the box, so the parens are cut.
    expect(svg).toHaveTextContent("canViewOrder");

    fireEvent.click(screen.getByText("tree"));
    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();
  });

  it("waits for the PR detail before asking for a map", () => {
    renderTab({ ready: false });
    // `GET /pulls/:id` rewrites `pr_files` in a transaction; a map fetched
    // before it lands would describe a file list the page does not have.
    expect(lastEnabled).toBe(false);
  });
});

describe("BlastTab — a symbol nothing calls", () => {
  it("renders it as a collapsed row saying 0 callers, rather than omitting it", () => {
    stored = {
      ...POPULATED,
      downstream: [
        ...POPULATED.downstream,
        { symbol: "unusedHelper", callers: [], endpoints_affected: [], crons_affected: [] },
      ],
    };
    renderTab();
    expect(screen.getByText("unusedHelper()")).toBeInTheDocument();
    expect(screen.getByText("0 callers")).toBeInTheDocument();
  });
});

describe("BlastTab — the honest empty states", () => {
  const empty = (reason: BlastRadiusResponse["reason"]): BlastRadiusResponse => ({
    changed_symbols: [],
    downstream: [],
    summary: "…",
    status: "ok",
    reason,
    indexed_sha: SHA,
  });

  it('says "no indexed symbols", names the sha, and offers no resync', () => {
    stored = empty("no_indexed_symbols");
    renderTab();
    expect(screen.getByText("No indexed symbols in these files")).toBeInTheDocument();
    expect(screen.getByText("Indexed at 13d9abb")).toBeInTheDocument();
    // Nothing is broken, so there is nothing to re-analyze.
    expect(screen.queryByText("Re-analyze")).not.toBeInTheDocument();
  });

  it('sends a PR with no recorded files to the Files tab', () => {
    stored = empty("no_changed_files");
    renderTab();
    expect(screen.getByText("No changed files are recorded yet")).toBeInTheDocument();
    expect(screen.getByText(/Files changed tab/)).toBeInTheDocument();
  });

  it("says nothing calls the symbols, counting them", () => {
    stored = { ...empty("no_callers"), changed_symbols: POPULATED.changed_symbols };
    renderTab();
    expect(screen.getByText("Nothing calls these symbols")).toBeInTheDocument();
    expect(
      screen.getByText("2 changed symbol(s), no downstream callers found."),
    ).toBeInTheDocument();
  });
});

describe("BlastTab — degraded and partial", () => {
  it("renders the degraded banner with a working Re-analyze", () => {
    stored = {
      changed_symbols: [],
      downstream: [],
      summary: "This repository has no usable index, so nothing was analysed …",
      status: "degraded",
      reason: "index_missing",
      indexed_sha: null,
    };
    renderTab();

    expect(screen.getByText("This repository has no usable index")).toBeInTheDocument();
    expect(screen.getByText(/not a claim that the pull request affects nothing/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Re-analyze"));
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it("draws a partial map AND warns that callers may be missing", () => {
    stored = { ...POPULATED, status: "partial", reason: "index_partial" };
    renderTab();

    expect(screen.getByText("The index is incomplete")).toBeInTheDocument();
    // The point of `partial` rather than `degraded`: the map is still shown.
    expect(screen.getByText("canViewOrder()")).toBeInTheDocument();
    expect(screen.getByText("Re-analyze")).toBeInTheDocument();
  });

  it("offers no Re-analyze for a switched-off feature, which a resync cannot fix", () => {
    stored = {
      changed_symbols: [],
      downstream: [],
      summary: "…",
      status: "degraded",
      reason: "repo_intel_disabled",
      indexed_sha: null,
    };
    renderTab();
    expect(screen.getByText("Repository intelligence is switched off")).toBeInTheDocument();
    expect(screen.queryByText("Re-analyze")).not.toBeInTheDocument();
  });
});
