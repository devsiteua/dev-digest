import type { AgentSkillLink, Skill } from "@devdigest/shared";

export interface SkillRow {
  skill: Skill;
  linked: boolean;
}

/**
 * Order the workspace's skills for the tab: the agent's linked skills first, in
 * LINK order (which is prompt order), then everything else alphabetically.
 *
 * Prompt order is the thing the user is editing here, so it has to be the thing
 * they see — sorting linked skills alphabetically would quietly hide it.
 */
export function orderSkills(skills: Skill[], links: AgentSkillLink[]): SkillRow[] {
  const rank = new Map(
    [...links].sort((a, b) => a.order - b.order).map((l, i) => [l.skill_id, i]),
  );
  const linked = skills
    .filter((s) => rank.has(s.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    .map((skill) => ({ skill, linked: true }));
  const rest = skills
    .filter((s) => !rank.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({ skill, linked: false }));
  return [...linked, ...rest];
}

/** Move an id one place towards the front or back. Returns a new array. */
export function move(ids: string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Same ids in the same order? Drives the "unsaved changes" state. */
export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Free-text filter over name and description. */
export function filterRows(rows: SkillRow[], search: string): SkillRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    `${r.skill.name} ${r.skill.description}`.toLowerCase().includes(q),
  );
}
