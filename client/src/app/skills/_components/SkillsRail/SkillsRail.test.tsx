import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const useSkills = vi.fn();
vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => useSkills(),
  useUpdateSkill: () => ({ mutate: vi.fn() }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportPreview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillsRail } from "./SkillsRail";

const skill = (id: string, name: string): Skill => ({
  id,
  name,
  description: `what ${name} is for`,
  type: "rubric",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 1,
  evidence_files: null,
});

const SKILLS = [skill("s1", "test-coverage-rubric"), skill("s2", "no-then-chains")];

const renderRail = (tab = "config") =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsRail selectedId="s1" tab={tab} />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  push.mockClear();
  useSkills.mockReturnValue({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() });
});
afterEach(cleanup);

describe("SkillsRail", () => {
  it("lists every skill and marks the open one as active", () => {
    renderRail();
    const selected = screen.getByRole("button", { name: "test-coverage-rubric" });
    const other = screen.getByRole("button", { name: "no-then-chains" });
    expect(selected.getAttribute("style")).toContain("var(--bg-hover)");
    expect(other.getAttribute("style")).not.toContain("var(--bg-hover)");
  });

  it("keeps the open tab when switching to another skill", () => {
    renderRail("preview");
    fireEvent.click(screen.getByRole("button", { name: "no-then-chains" }));
    expect(push).toHaveBeenCalledWith("/skills/s2?tab=preview");
  });

  it("filters the rail without losing the selection semantics", () => {
    renderRail();
    fireEvent.change(screen.getByLabelText("Search skills…"), { target: { value: "then" } });
    expect(screen.getByRole("button", { name: "no-then-chains" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "test-coverage-rubric" })).not.toBeInTheDocument();
  });
});
