import type { SkillSource, SkillType } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/**
 * Shared vocabulary for presenting a skill.
 *
 * Lives in `lib/` rather than inside the `/skills` route because two unrelated
 * route subtrees render skills: the Skills screen and the agent editor's Skills
 * tab. A palette imported out of another route's `_components/` folder would be
 * reaching into a tree whose `_` prefix says it is private.
 */

/** Accent per skill type — the palette the design reference uses. */
export const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "#3b82f6",
  convention: "#10b981",
  security: "var(--crit)",
  custom: "var(--text-muted)",
};

/** Icon per provenance. Anything that is not `manual` came from outside. */
export const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  imported_file: "Upload",
  imported_url: "Link",
  extracted: "Wrench",
  community: "Globe",
};

/**
 * Whether a skill's body is third-party text.
 *
 * The UI flags it wherever the skill appears; independently, the server wraps
 * such a body in `<untrusted source="skill:…">` at prompt assembly. Neither
 * relies on the other.
 */
export function isUntrusted(source: SkillSource): boolean {
  return source !== "manual";
}
