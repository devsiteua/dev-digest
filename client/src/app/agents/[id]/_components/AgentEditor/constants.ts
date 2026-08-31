import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Evals / Stats arrive with later lessons. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" },
];

/**
 * The tab keys `?tab=` may carry, derived rather than re-listed on the route:
 * a second hand-written copy silently swallows any tab added here, and the
 * symptom (a tab that renders and then bounces back to Config) looks like a
 * broken tab bar rather than a stale allow-list. The first entry is the
 * fallback for anything unrecognised.
 */
export const TAB_KEYS: readonly string[] = TABS.map((tb) => tb.key);
