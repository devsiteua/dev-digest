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

/**
 * Move `dragId` to the position `targetId` currently occupies. Returns a new
 * array, or the same one when either id is missing or they are the same.
 *
 * Ids, not indices, because the list on screen can be FILTERED: the row a drop
 * lands on is at some position in `visible`, which says nothing about its
 * position in the saved order. Resolving both ends by id makes a drop mean the
 * same thing with a filter applied as without one.
 */
export function reorder(ids: string[], dragId: string, targetId: string): string[] {
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return ids;
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
