import type { Skill } from "@devdigest/shared";

/**
 * Free-text filter over a skill's name and description.
 *
 * Lives at the route root because both skill lists need it: the tile grid on
 * `/skills` and the rail on `/skills/:id`.
 */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q));
}
