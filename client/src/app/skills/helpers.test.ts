import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { filterSkills } from "./helpers";

/** The filter is shared by the `/skills` tile grid and the `/skills/:id` rail. */

const skill = (name: string, description: string): Skill => ({
  id: name,
  name,
  description,
  type: "custom",
  source: "manual",
  body: "b",
  enabled: true,
  version: 1,
  evidence_files: null,
});

const SKILLS = [
  skill("secret-leakage-gate", "Detects committed credentials"),
  skill("no-then-chains", "Prefer async/await"),
];

describe("filterSkills", () => {
  it("matches on the name", () => {
    expect(filterSkills(SKILLS, "secret").map((s) => s.name)).toEqual(["secret-leakage-gate"]);
  });

  it("matches on the description too — that is where the 'when to apply' lives", () => {
    expect(filterSkills(SKILLS, "async").map((s) => s.name)).toEqual(["no-then-chains"]);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(filterSkills(SKILLS, "  CREDENTIALS ")).toHaveLength(1);
  });

  it("returns everything for a blank query", () => {
    expect(filterSkills(SKILLS, "   ")).toHaveLength(2);
  });
});
