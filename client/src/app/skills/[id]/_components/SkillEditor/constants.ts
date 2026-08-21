import type { IconName } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";

export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Config is the skill; Preview is how the reviewing agent receives it; Stats is
 * what happened after it was attached; Versions is every body it has had.
 *
 * The design's fifth tab, Evals, is absent on purpose — `eval_cases` is empty
 * until L06, and a tab whose only possible content is an empty state teaches the
 * reader nothing.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];

/**
 * The tab keys `?tab=` may carry, derived so the route and the tab bar cannot
 * disagree. A hand-written second copy is what made Stats and Versions render in
 * the bar and then bounce back to Config: the page rejected the value the bar
 * had just set. The first entry is the fallback for anything unrecognised.
 */
export const TAB_KEYS: readonly string[] = TABS.map((tb) => tb.key);

export const TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Keep in step with MAX_BODY_CHARS in the server's skills module. */
export const MAX_BODY_CHARS = 40_000;
