import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../lib/toast";

const update = vi.fn();
const restore = vi.fn();

/**
 * `stats` and `versions` are mutable so a test can choose what the tab receives.
 * Both hooks are declared even for the Config/Preview tests: a module mock that
 * omits a binding the imported tree reaches for leaves it `undefined`, and the
 * failure surfaces as a render crash far from the missing key.
 */
let stats: unknown = null;
let versions: unknown = null;

vi.mock("../../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: update, isPending: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillStats: () => ({ data: stats, isError: false }),
  useSkillVersions: () => ({ data: versions, isError: false }),
  useRestoreSkillVersion: () => ({ mutate: restore, isPending: false, variables: undefined }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SkillEditor } from "./SkillEditor";

const SKILL: Skill = {
  id: "s1",
  name: "no-then-chains",
  description: "Prefer async/await.",
  type: "convention",
  source: "manual",
  body: "# No .then() chains\n\nUse async/await.",
  enabled: true,
  version: 2,
  evidence_files: null,
};

const STATS = {
  used_by: [
    { agent_id: "ag1", agent_name: "Test Quality Reviewer", agent_enabled: true },
    { agent_id: "ag2", agent_name: "API Contract Reviewer", agent_enabled: false },
  ],
  window_days: 30,
  runs: 7,
  findings: 9,
  accepted: 6,
  dismissed: 3,
  accept_rate: 6 / 9,
  by_category: [
    { category: "bug", count: 5 },
    { category: "style", count: 4 },
  ],
};

const VERSIONS = [
  { skill_id: "s1", version: 2, body: "# Current text", created_at: "2026-08-07T10:00:00.000Z" },
  { skill_id: "s1", version: 1, body: "# The first draft", created_at: "2026-08-01T10:00:00.000Z" },
];

beforeEach(() => {
  update.mockClear();
  restore.mockClear();
  stats = null;
  versions = null;
});
afterEach(cleanup);

const renderEditor = (skill: Skill = SKILL, tab = "config") =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillEditor skill={skill} tab={tab} onTab={() => {}} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

describe("SkillEditor → Config", () => {
  it("renders the skill's fields", () => {
    renderEditor();
    expect(screen.getByDisplayValue("no-then-chains")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Prefer async/await.")).toBeInTheDocument();
    expect(screen.getByText("Save skill")).toBeInTheDocument();
  });

  it("tells the user the description is the skill's interface", () => {
    renderEditor();
    expect(screen.getByText(/State directly when it applies/)).toBeInTheDocument();
  });

  it("tells the user the body is the only text the model sees", () => {
    renderEditor();
    expect(screen.getByText(/only text sent to the model/)).toBeInTheDocument();
  });

  it("shows a token estimate for the body, so the prompt cost is visible while editing", () => {
    renderEditor();
    // 37 chars ⇒ ceil(37/4) = 10 tokens.
    expect(screen.getByText(/~10 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/37/)).toBeInTheDocument();
  });

  it("saves the edited fields", () => {
    renderEditor();
    fireEvent.change(screen.getByDisplayValue("Prefer async/await."), {
      target: { value: "Reworded." },
    });
    fireEvent.click(screen.getByText("Save skill"));

    expect(update).toHaveBeenCalledWith(
      { id: "s1", patch: expect.objectContaining({ description: "Reworded." }) },
      expect.anything(),
    );
  });

  it("warns that changing the body cuts a new version", () => {
    renderEditor();
    const body = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(screen.queryByText(/snapshots the body as v3/)).not.toBeInTheDocument();

    fireEvent.change(body, { target: { value: "# Revised" } });
    expect(screen.getByText(/snapshots the body as v3/)).toBeInTheDocument();
  });

  it("will not save an empty body", () => {
    renderEditor();
    const body = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "   " } });
    expect(screen.getByText("Save skill").closest("button")).toBeDisabled();
  });
});

describe("SkillEditor → Preview", () => {
  it("renders the body as markdown", () => {
    renderEditor(SKILL, "preview");
    expect(screen.getByText("No .then() chains")).toBeInTheDocument();
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
  });

  it("warns about a body that came from outside this workspace", () => {
    renderEditor({ ...SKILL, source: "imported_file" }, "preview");
    expect(screen.getByText(/must be vetted before it is enabled/)).toBeInTheDocument();
  });

  it("does not warn about a hand-written body", () => {
    renderEditor(SKILL, "preview");
    expect(screen.queryByText(/must be vetted/)).not.toBeInTheDocument();
  });
});

describe("SkillEditor → Stats", () => {
  it("says the numbers belong to the agents, not to the skill", () => {
    stats = STATS;
    renderEditor(SKILL, "stats");
    expect(screen.getByText(/A finding records the agent that produced it/)).toBeInTheDocument();
  });

  it("renders usage over the reported window", () => {
    stats = STATS;
    renderEditor(SKILL, "stats");
    expect(screen.getByText("Runs (30d)")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    // 6/9 rounds to 67, printed twice: the tile's number and the ring's own label.
    expect(screen.getAllByText("67")).toHaveLength(2);
    expect(screen.getByText("6 accepted / 9 triaged")).toBeInTheDocument();
    expect(screen.getByText("Test Quality Reviewer")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
  });

  it("marks an agent that is switched off, because a disabled agent never runs", () => {
    stats = STATS;
    renderEditor(SKILL, "stats");
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("shows a dash rather than 0% while nothing has been triaged", () => {
    stats = { ...STATS, accepted: 0, dismissed: 0, accept_rate: null };
    renderEditor(SKILL, "stats");
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/triaged/)).not.toBeInTheDocument();
  });

  it("replaces the whole tab with an empty state when no agent uses the skill", () => {
    stats = { ...STATS, used_by: [] };
    renderEditor(SKILL, "stats");
    expect(screen.getByText("No usage yet")).toBeInTheDocument();
    expect(screen.queryByText("Runs (30d)")).not.toBeInTheDocument();
  });
});

describe("SkillEditor → Versions", () => {
  it("lists the snapshots and marks the current one", () => {
    versions = VERSIONS;
    renderEditor(SKILL, "versions"); // SKILL is v2
    expect(screen.getByText("2 versions")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    // The current row offers no restore — restoring what is already live is a no-op.
    expect(screen.getAllByText("Restore")).toHaveLength(1);
  });

  it("says restoring appends rather than rewrites", () => {
    versions = VERSIONS;
    renderEditor(SKILL, "versions");
    expect(screen.getByText(/appends the old text as a new version/)).toBeInTheDocument();
  });

  it("shows a past body only on request", () => {
    versions = VERSIONS;
    renderEditor(SKILL, "versions");
    expect(screen.queryByText("# The first draft")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("View"));
    expect(screen.getByText("# The first draft")).toBeInTheDocument();
  });

  it("restores the version of the row that was clicked", () => {
    versions = VERSIONS;
    renderEditor(SKILL, "versions");
    fireEvent.click(screen.getByText("Restore"));
    expect(restore).toHaveBeenCalledWith({ id: "s1", version: 1 }, expect.anything());
  });
});
