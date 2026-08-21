import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, ConventionExtractResult } from "@devdigest/shared";
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
const updateMutateAsync = vi.fn().mockResolvedValue(undefined);
const createSkillMutate = vi.fn();
const extractState = {
  isPending: false,
  isError: false,
  error: null as Error | null,
  data: undefined as ConventionExtractResult | undefined,
};
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => useConventions(),
  useExtractConventions: () => ({ ...extractState, mutate: extractMutate }),
  useUpdateConvention: () => ({
    mutate: updateMutate,
    mutateAsync: updateMutateAsync,
    isPending: false,
    variables: undefined,
  }),
  // The merge modal is rendered for real here — it is what decides which
  // candidates end up in the skill body.
  useCreateSkillFromConventions: () => ({
    mutate: createSkillMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
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
  updateMutateAsync.mockClear();
  createSkillMutate.mockClear();
  Object.assign(extractState, {
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
  });
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

  // A short list means one thing when the model returned three rules and quite
  // another when it returned twenty. Without these numbers the screen quietly
  // presents a heavily filtered result as the whole truth.
  it("reports what the last scan kept and what it threw away", () => {
    extractState.data = {
      candidates: [],
      sampled_files: ["src/a.ts", "src/b.ts", "src/c.ts"],
      discarded: [
        { rule: "Wrap every handler in a try/catch", reason: "evidence snippet was not found in src/a.ts near lines 3-9" },
        { rule: "Name constants in SCREAMING_SNAKE_CASE", reason: "duplicate of a rule with higher confidence" },
      ],
    };
    renderView();
    expect(
      screen.getByText(/read 3 files\. The model proposed 2 rules: 0 kept, 2 discarded/),
    ).toBeInTheDocument();
    expect(screen.getByText(/evidence snippet was not found/)).toBeInTheDocument();
    expect(screen.getByText(/duplicate of a rule with higher confidence/)).toBeInTheDocument();
  });

  it("collapses the tail of a long discard list into a count", () => {
    extractState.data = {
      candidates: [],
      sampled_files: ["src/a.ts"],
      discarded: Array.from({ length: 8 }, (_, i) => ({
        rule: `Rule ${i}`,
        reason: "evidence snippet was not found",
      })),
    };
    renderView();
    expect(screen.getByText("…and 3 more")).toBeInTheDocument();
  });

  it("holds the scan report back while a scan is running", () => {
    Object.assign(extractState, {
      isPending: true,
      data: { candidates: [], sampled_files: ["src/a.ts"], discarded: [] },
    });
    renderView();
    expect(screen.queryByText(/The model proposed/)).not.toBeInTheDocument();
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

  it("persists a reworded rule through PATCH", async () => {
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "Reworded rule" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: "c1",
        patch: { rule: "Reworded rule", category: "naming" },
      }),
    );
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

describe("ConventionsView → merge to skill", () => {
  it("cannot create a skill until something is accepted", () => {
    useConventions.mockReturnValue({
      data: [candidate("c1", "Name constants in SCREAMING_SNAKE_CASE")],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();
  });

  it("merges the accepted candidates only — pending and rejected stay out of the body", () => {
    useConventions.mockReturnValue({
      data: [
        candidate("c1", "Pending rule nobody approved"),
        candidate("c2", "Return early with a typed error", { status: "accepted" }),
        candidate("c3", "Rejected rule the user threw away", { status: "rejected" }),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    const body = (document.querySelector("textarea") as HTMLTextAreaElement).value;
    expect(body).toContain("Return early with a typed error");
    expect(body).not.toContain("Pending rule nobody approved");
    expect(body).not.toContain("Rejected rule the user threw away");
    expect(screen.getByText(/1 accepted convention/)).toBeInTheDocument();
  });
});
