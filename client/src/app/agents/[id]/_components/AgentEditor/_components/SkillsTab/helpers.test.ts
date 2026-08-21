import { describe, it, expect } from "vitest";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import { filterRows, orderSkills, reorder, sameOrder } from "./helpers";

const skill = (id: string, name: string, description = ""): Skill => ({
  id,
  name,
  description,
  type: "custom",
  source: "manual",
  body: "b",
  enabled: true,
  version: 1,
  evidence_files: null,
});

const link = (skill_id: string, order: number): AgentSkillLink => ({
  agent_id: "ag1",
  skill_id,
  order,
});

describe("orderSkills", () => {
  const skills = [skill("c", "charlie"), skill("a", "alpha"), skill("b", "bravo")];

  it("puts linked skills first, in LINK order — because that is prompt order", () => {
    const rows = orderSkills(skills, [link("c", 0), link("a", 1)]);
    expect(rows.map((r) => r.skill.id)).toEqual(["c", "a", "b"]);
    expect(rows.map((r) => r.linked)).toEqual([true, true, false]);
  });

  it("does not care what order the links arrive in", () => {
    const rows = orderSkills(skills, [link("a", 1), link("c", 0)]);
    expect(rows.map((r) => r.skill.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts the unlinked remainder alphabetically", () => {
    const rows = orderSkills(skills, []);
    expect(rows.map((r) => r.skill.name)).toEqual(["alpha", "bravo", "charlie"]);
  });
});

describe("reorder", () => {
  it("gives the dragged id the target's position, in both directions", () => {
    expect(reorder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when either end is missing or they are the same row", () => {
    expect(reorder(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    // Dropping onto an UNATTACHED skill: it has no position to take.
    expect(reorder(["a", "b"], "a", "zz")).toEqual(["a", "b"]);
    expect(reorder(["a", "b"], "zz", "a")).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const ids = ["a", "b", "c"];
    reorder(ids, "a", "c");
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("sameOrder", () => {
  it("is order-sensitive, not set-equality", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });
});

describe("filterRows", () => {
  const rows = [
    { skill: skill("a", "secret-gate", "Finds committed secrets"), linked: true },
    { skill: skill("b", "no-then-chains", "Prefer async/await"), linked: false },
  ];

  it("matches on name and on description", () => {
    expect(filterRows(rows, "secret").map((r) => r.skill.id)).toEqual(["a"]);
    expect(filterRows(rows, "async").map((r) => r.skill.id)).toEqual(["b"]);
  });

  it("returns everything for a blank query", () => {
    expect(filterRows(rows, "   ")).toHaveLength(2);
  });
});
