import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, ProjectContextDoc } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

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

const listState = {
  data: undefined as ProjectContextDoc[] | undefined,
  isLoading: false,
  isError: false,
};
const previewState = {
  data: undefined as ProjectContextDoc | undefined,
  isLoading: false,
  isError: false,
};
const uploadState = { isPending: false, isError: false, error: null as Error | null };
const uploadMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const reorderMutate = vi.fn();

vi.mock("@/lib/hooks/context", () => ({
  useProjectContext: () => ({ ...listState, refetch: vi.fn() }),
  useProjectContextDoc: () => ({ ...previewState, refetch: vi.fn() }),
  useUploadProjectContextDoc: () => ({ ...uploadState, mutate: uploadMutate }),
  useUpdateProjectContextDoc: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteProjectContextDoc: () => ({ mutate: deleteMutate, isPending: false }),
  useReorderProjectContext: () => ({ mutate: reorderMutate, isPending: false }),
}));

const agentsState = { data: undefined as Agent[] | undefined };
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => agentsState }));

import { ProjectContextView } from "./ProjectContextView";
import { SKELETON_ROWS } from "./constants";

const doc = (over: Partial<ProjectContextDoc> = {}): ProjectContextDoc => ({
  id: "d1",
  title: "Public API PRD",
  path_label: "public-api.md",
  enabled: true,
  order: 0,
  size_bytes: 2048,
  updated_at: "2026-08-29T10:00:00.000Z",
  ...over,
});

const agent = (over: Partial<Agent> = {}): Agent =>
  ({
    id: "a1",
    name: "Security Reviewer",
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "review",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    project_context: true,
    enabled: true,
    version: 1,
    ...over,
  }) as Agent;

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  listState.data = undefined;
  listState.isLoading = false;
  listState.isError = false;
  previewState.data = undefined;
  previewState.isLoading = false;
  previewState.isError = false;
  uploadState.isPending = false;
  uploadState.isError = false;
  uploadState.error = null;
  agentsState.data = undefined;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("AC-21 — the documents, in order, with their labels and a count", () => {
  it("lists every document in the order the server returned, with its path label", () => {
    listState.data = [
      doc({ id: "d1", title: "PRD", path_label: "prd.md" }),
      doc({ id: "d2", title: "ADR-7", path_label: "adr-7.md", order: 1 }),
    ];
    renderView();

    const rows = screen.getAllByTestId("context-doc-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("PRD")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("prd.md")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("ADR-7")).toBeInTheDocument();
  });

  it("summarises the set with a document count and a total size", () => {
    listState.data = [doc({ size_bytes: 1024 }), doc({ id: "d2", size_bytes: 3072 })];
    renderView();

    expect(screen.getByText(/2 documents/)).toBeInTheDocument();
    expect(screen.getByText(/4kb total/)).toBeInTheDocument();
  });

  it("says the path label is a label, not a folder to cd into", () => {
    listState.data = [doc()];
    renderView();
    expect(screen.getAllByText(messages.pathLabelNote).length).toBeGreaterThan(0);
  });
});

describe("AC-22 — the empty state", () => {
  it("explains what the folder is for and offers the upload", () => {
    listState.data = [];
    renderView();

    expect(screen.getByText(messages.empty.title)).toBeInTheDocument();
    expect(screen.getByText(messages.empty.body)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.upload.action })).toBeInTheDocument();
  });

  it("promises no folder on disk", () => {
    listState.data = [];
    renderView();
    expect(screen.queryByText(/\.devdigest\/specs/)).not.toBeInTheDocument();
  });
});

describe("AC-23 — the preview is read-only", () => {
  it("renders the body with no textarea and no Edit control", () => {
    listState.data = [doc()];
    previewState.data = doc({ body: "# Public API\n\nRate-limit everything." });
    const { container } = renderView();

    expect(screen.getByText(/Rate-limit everything/)).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Preview$/)).not.toBeInTheDocument();
  });
});

describe("AC-24 — the agent counter", () => {
  it("counts enabled agents that read project context, out of all enabled agents", () => {
    listState.data = [doc()];
    agentsState.data = [
      agent({ id: "a1", project_context: true }),
      agent({ id: "a2", project_context: false }),
      agent({ id: "a3", project_context: true, enabled: false }),
    ];
    renderView();

    expect(screen.getByText("Read by 1 of 2 enabled agents")).toBeInTheDocument();
  });

  it("says 0 of 0 rather than nothing when there are no agents", () => {
    listState.data = [doc()];
    agentsState.data = [];
    renderView();
    expect(screen.getByText("Read by 0 of 0 enabled agents")).toBeInTheDocument();
  });
});

describe("the controls", () => {
  it("disables a document through the toggle without touching its text", () => {
    listState.data = [doc({ id: "d1", enabled: true })];
    renderView();

    fireEvent.click(screen.getByRole("switch"));
    expect(updateMutate).toHaveBeenCalledWith({ id: "d1", patch: { enabled: false } });
  });

  it("marks a disabled document as disabled", () => {
    listState.data = [doc({ enabled: false })];
    renderView();
    expect(screen.getByText(messages.doc.disabled)).toBeInTheDocument();
  });

  it("deletes a document", () => {
    listState.data = [doc({ id: "d9" })];
    renderView();

    fireEvent.click(screen.getByRole("button", { name: messages.doc.delete }));
    expect(deleteMutate).toHaveBeenCalledWith("d9");
  });

  it("reorders by sending the whole id list", () => {
    listState.data = [doc({ id: "a" }), doc({ id: "b", order: 1 }), doc({ id: "c", order: 2 })];
    renderView();

    const rows = screen.getAllByTestId("context-doc-row");
    fireEvent.click(within(rows[2]!).getByRole("button", { name: messages.doc.moveUp }));
    expect(reorderMutate).toHaveBeenCalledWith(["a", "c", "b"]);
  });

  it("does not move the first document up — `fireEvent` will click it, and nothing happens", () => {
    listState.data = [doc({ id: "a" }), doc({ id: "b", order: 1 })];
    renderView();

    const rows = screen.getAllByTestId("context-doc-row");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: messages.doc.moveUp }));
    expect(reorderMutate).not.toHaveBeenCalled();
  });

  it("selects a document to preview it", () => {
    listState.data = [doc({ id: "d1", title: "PRD" }), doc({ id: "d2", title: "ADR" })];
    renderView();

    const rows = screen.getAllByTestId("context-doc-row");
    fireEvent.click(within(rows[1]!).getByRole("button", { name: /ADR/ }));
    expect(within(rows[1]!).getByRole("button", { name: /ADR/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("the states the artboard omits", () => {
  it("shows placeholders while the list loads", () => {
    listState.isLoading = true;
    const { container } = renderView();
    expect(container.querySelectorAll(".skeleton")).toHaveLength(SKELETON_ROWS);
    expect(screen.queryByText(messages.empty.title)).not.toBeInTheDocument();
  });

  it("offers a retry when the list fails", () => {
    listState.isError = true;
    renderView();
    expect(screen.getByText(messages.loadError)).toBeInTheDocument();
  });

  it("renders the server's own rejection message for a refused upload", () => {
    // AC-05 to AC-08 all arrive here: the server's sentence names the limit it
    // enforced, and the screen must not replace it with a generic failure.
    listState.data = [doc()];
    uploadState.isError = true;
    uploadState.error = new Error("Only .md and .txt documents can be uploaded.");
    renderView();

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(messages.upload.failed)).toBeInTheDocument();
    expect(
      within(alert).getByText("Only .md and .txt documents can be uploaded."),
    ).toBeInTheDocument();
  });

  it("disables the upload control while an upload is in flight", () => {
    listState.data = [doc()];
    uploadState.isPending = true;
    renderView();

    const button = screen.getByRole("button", { name: messages.upload.busy });
    expect(button).toBeDisabled();
  });
});
