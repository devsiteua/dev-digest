import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const del = vi.fn();
vi.mock("../../../../lib/hooks/skills", () => ({
  useDeleteSkill: () => ({ mutate: del, isPending: false }),
}));

import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "s1",
  name: "no-then-chains",
  description: "Prefer async/await over .then() chains.",
  type: "convention",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 2,
  evidence_files: null,
};

const renderCard = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("SkillCard", () => {
  it("renders the name, description, type and provenance", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.getByText("no-then-chains")).toBeInTheDocument();
    expect(screen.getByText("Prefer async/await over .then() chains.")).toBeInTheDocument();
    expect(screen.getByText("convention")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when there is no description", () => {
    renderCard(<SkillCard skill={{ ...SKILL, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("marks a skill that came from outside as needing vetting", () => {
    renderCard(<SkillCard skill={{ ...SKILL, source: "imported_file" }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
  });

  it("does not badge a hand-written skill", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("toggles without opening the skill — the switch is not a click on the card", () => {
    const onClick = vi.fn();
    const onToggle = vi.fn();
    renderCard(<SkillCard skill={SKILL} onClick={onClick} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("dims a disabled skill", () => {
    const { container } = renderCard(<SkillCard skill={{ ...SKILL, enabled: false }} />);
    expect(container.firstElementChild?.getAttribute("style")).toContain("opacity: 0.6");
  });

  it("is reachable and activatable by keyboard, not only by mouse", () => {
    const onClick = vi.fn();
    renderCard(<SkillCard skill={SKILL} onClick={onClick} />);
    const card = screen.getByRole("button", { name: "no-then-chains" });
    expect(card).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});