import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../lib/toast";

const update = vi.fn();
vi.mock("../../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: update, isPending: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
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

beforeEach(() => update.mockClear());
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
