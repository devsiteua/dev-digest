import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// The shell needs repo context, theme and the PR query; none of that is what
// this screen is about, so it is stubbed down to its children.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const useSkills = vi.fn();
const updateMutate = vi.fn();
vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => useSkills(),
  useUpdateSkill: () => ({ mutate: updateMutate }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportPreview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillsListView } from "./SkillsListView";

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

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsListView />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  push.mockClear();
  useSkills.mockReturnValue({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() });
});
afterEach(cleanup);

describe("SkillsListView", () => {
  it("renders one tile per skill — the index is a grid, not a picker with an empty pane", () => {
    renderView();
    expect(screen.getByRole("button", { name: "test-coverage-rubric" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "no-then-chains" })).toBeInTheDocument();
    // The old two-pane placeholder must not come back.
    expect(screen.queryByText("Select a skill")).not.toBeInTheDocument();
  });

  it("opens a skill on its Config tab", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "no-then-chains" }));
    expect(push).toHaveBeenCalledWith("/skills/s2?tab=config");
  });

  it("filters by the search box", () => {
    renderView();
    fireEvent.change(screen.getByLabelText("Search skills…"), { target: { value: "coverage" } });
    expect(screen.getByRole("button", { name: "test-coverage-rubric" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "no-then-chains" })).not.toBeInTheDocument();
  });

  it("shows the empty state when there is nothing to list", () => {
    useSkills.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderView();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });
});
