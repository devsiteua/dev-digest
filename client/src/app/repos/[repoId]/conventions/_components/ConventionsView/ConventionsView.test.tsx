import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

// The shell pulls in repo context, theme and the PR query; none of that is what
// this screen is about (client/INSIGHTS.md, 2026-08-06).
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));

const useConventions = vi.fn();
const extractMutate = vi.fn();
const updateMutate = vi.fn();
const extractState = { isPending: false, isError: false, error: null as Error | null };
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => useConventions(),
  useExtractConventions: () => ({ ...extractState, mutate: extractMutate }),
  useUpdateConvention: () => ({ mutate: updateMutate, isPending: false, variables: undefined }),
}));

import { ConventionsView } from "./ConventionsView";

const candidate = (id: string, rule: string, over: Partial<ConventionCandidate> = {}): ConventionCandidate => ({
  id,
  repo_id: "r1",
  rule,
  category: "naming",
  evidence_path: "src/config.ts",
  evidence_snippet: "export const config = {};",
  evidence_start_line: 8,
  evidence_end_line: 11,
  confidence: 0.9,
  status: "pending",
  skill_id: null,
  created_at: "2026-08-06T10:00:00.000Z",
  ...over,
});

const LIST = [
  candidate("c1", "Name constants in SCREAMING_SNAKE_CASE"),
  candidate("c2", "Return early with a typed error", { status: "accepted" }),
];

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionsView />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  extractMutate.mockClear();
  updateMutate.mockClear();
  Object.assign(extractState, { isPending: false, isError: false, error: null });
  useConventions.mockReturnValue({
    data: LIST,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});
afterEach(cleanup);

describe("ConventionsView", () => {
  it("lists every candidate with the accepted tally", () => {
    renderView();
    expect(screen.getByText("Name constants in SCREAMING_SNAKE_CASE")).toBeInTheDocument();
    expect(screen.getByText("Return early with a typed error")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();
  });

  it("accepts only the candidates that are not accepted yet", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "accepted" } });
  });

  it("writes one accept when a card's Accept is clicked", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "accepted" } });
  });

  it("writes one reject when a card's Reject is clicked", () => {
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" })[0]!);
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "rejected" } });
  });

  it("shows the empty state and runs extraction from its CTA", () => {
    useConventions.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    // No list → no bulk bar.
    expect(screen.queryByRole("button", { name: "Accept all" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run extraction" }));
    expect(extractMutate).toHaveBeenCalled();
  });

  it("surfaces the server's reason when extraction fails", () => {
    Object.assign(extractState, {
      isError: true,
      error: new Error("Repo acme/payments-api is not indexed yet — index it first."),
    });
    renderView();
    expect(screen.getByRole("alert")).toHaveTextContent("Extraction failed");
    expect(screen.getByRole("alert")).toHaveTextContent("is not indexed yet");
  });

  it("shows the load error with a retry", () => {
    const refetch = vi.fn();
    useConventions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: null,
      refetch,
    });
    renderView();
    expect(screen.getByText("Could not load conventions.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});
