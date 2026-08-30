import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiFile } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/ci.json";

const preview = vi.fn();
const installMutate = vi.fn();
const install = vi.fn();
vi.mock("../../../../../../../lib/hooks/ci", () => ({
  useCiPreview: () => preview(),
  useExportToCi: () => install(),
}));

import { ExportWizard } from "./ExportWizard";

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

/**
 * The bundle as the engine sends it: the manifest, one file per attached skill
 * and the workflow carry contents; each of the three runner files carries a
 * byte count and an empty `contents`, because the bundle never crosses the API.
 */
const FILES: CiFile[] = [
  {
    path: ".devdigest/agents/security-reviewer.yaml",
    contents: "name: Security Reviewer",
    editable: true,
  },
  {
    path: ".devdigest/skills/secret-leakage-gate.md",
    contents: "# Secret leakage gate",
    editable: true,
  },
  {
    path: ".github/workflows/devdigest-review.yml",
    contents: "permissions: contents read",
    editable: true,
  },
  { path: ".devdigest/runner/index.js", contents: "", editable: false, bytes: 1604629 },
  { path: ".devdigest/runner/300.index.js", contents: "", editable: false, bytes: 5796 },
  { path: ".devdigest/runner/package.json", contents: "", editable: false, bytes: 23 },
];

const renderWizard = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <ExportWizard agent={AGENT} installations={[]} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  installMutate.mockClear();
  preview.mockReturnValue({
    data: FILES,
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  });
  install.mockReturnValue({
    mutate: installMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
  });
});
afterEach(cleanup);

/** Type a valid repository and leave the Target step. */
function toPreview() {
  fireEvent.change(screen.getByLabelText("Target repository"), {
    target: { value: "acme/payments-api" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

function toConfigure() {
  toPreview();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

function toInstall() {
  toConfigure();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

/**
 * The Target step's card grid, reached from the one card it contains. Counting
 * its children is the assertion: a re-added CircleCI card fails it, which a
 * "GitHub Actions is present" check never would.
 */
function targetGrid(): HTMLElement {
  const name = screen.getByText("GitHub Actions");
  const grid = name.parentElement?.parentElement?.parentElement;
  if (!(grid instanceof HTMLElement)) throw new Error("the Target card grid was not rendered");
  return grid;
}

/** Every row of Preview's file list, in the order the pane lists them. */
function fileRows(): HTMLElement[] {
  const label = screen.getByText("FILES TO CREATE");
  const list = label.parentElement;
  if (!list) throw new Error("Preview's file list was not rendered");
  return Array.from(list.querySelectorAll("button"));
}

/** The body handed to the export mutation, or a failure naming the miss. */
function installedBody() {
  const [arg] = installMutate.mock.calls.at(0) ?? [];
  if (!arg || typeof arg !== "object") throw new Error("the export mutation was never called");
  return arg as { agentId: string; body: Record<string, unknown> };
}

describe("Export Wizard", () => {
  // AC-01 — the modal is the four-step wizard, rendered by `ExportWizardSteps`.
  it("opens on Target with the four step labels and their numbers", () => {
    renderWizard();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    for (const label of ["Target", "Preview", "Configure", "Install"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // `ExportWizardSteps` numbers every step it has not passed; on Target that
    // is all four, which is what tells the labels apart from any other copy.
    for (const n of ["1", "2", "3", "4"]) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
  });

  // AC-02 — a target is shown only where a generator exists, and only the
  // GitHub Actions generator does.
  it("renders exactly one target card", () => {
    renderWizard();

    expect(targetGrid().children).toHaveLength(1);
    expect(screen.getByText("GitHub Actions")).toBeInTheDocument();
    expect(screen.queryByText(/CircleCI/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Jenkins/)).not.toBeInTheDocument();
  });

  // AC-03 — every file to be created is listed, in order.
  it("lists the manifest, each skill, the workflow and the three runner files", () => {
    renderWizard();
    toPreview();

    expect(fileRows().map((row) => row.textContent)).toEqual(FILES.map((f) => f.path));
    // Counted, not spot-checked: an export that dropped back to a single
    // runner file would still list "index.js" and must still fail here.
    expect(screen.getAllByRole("button", { name: /^\.devdigest\/runner\// })).toHaveLength(3);
  });

  // AC-03 — contents for the three generated kinds, path and bytes for a runner file.
  it("shows contents for the generated files and only a byte size for a runner file", () => {
    const { container } = renderWizard();
    toPreview();

    // Preview opens on the workflow: its `permissions` block is what the
    // reviewer of the generated pull request is asked to approve.
    expect(screen.getByText("permissions: contents read")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ".devdigest/agents/security-reviewer.yaml" }));
    expect(screen.getByText("name: Security Reviewer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ".devdigest/skills/secret-leakage-gate.md" }));
    expect(screen.getByText("# Secret leakage gate")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ".devdigest/runner/index.js" }));
    expect(screen.getByText("1604629 bytes")).toBeInTheDocument();
    // No contents pane at all for a runner file — the bundle's bytes never
    // cross the API, so there is nothing to show.
    expect(container.querySelector("pre")).toBeNull();
  });

  // AC-12 — exactly three events and exactly three publish modes, with the
  // defaults the criterion fixes.
  it("offers three trigger events and three publish modes with their defaults", () => {
    renderWizard();
    toConfigure();

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: "pull_request: opened" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "pull_request: synchronize" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "pull_request: reopened" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    const postAs = screen.getByRole("combobox");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(postAs).toHaveValue("github_review");
  });

  // AC-12 — the Configure step's state is what the Install request carries.
  it("hands the changed triggers and publish mode to the export mutation", () => {
    renderWizard();
    toConfigure();

    fireEvent.click(screen.getByRole("checkbox", { name: "pull_request: reopened" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pr_comment" } });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(installMutate).toHaveBeenCalledTimes(1);
    expect(installedBody()).toEqual({
      agentId: "ag1",
      body: {
        repo: "acme/payments-api",
        target: "gha",
        action: "open_pr",
        post_as: "pr_comment",
        triggers: ["opened", "synchronize", "reopened"],
      },
    });
  });

  // AC-12 — unchecking is carried too, and the order is the workflow's own.
  it("carries an unchecked event out of the request", () => {
    renderWizard();
    toInstall();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "pull_request: synchronize" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(installedBody().body.triggers).toEqual(["opened"]);
  });
});
