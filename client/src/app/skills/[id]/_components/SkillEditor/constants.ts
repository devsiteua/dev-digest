import type { IconName } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";

export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Config is the skill; Preview is how the reviewing agent receives it. The
 * design's Evals / Stats / Versions tabs belong to later lessons — body snapshots
 * are already written to `skill_versions`, there is just no UI over them yet.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
];

export const TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Keep in step with MAX_BODY_CHARS in the server's skills module. */
export const MAX_BODY_CHARS = 40_000;
