/* nav.ts — sidebar nav groups + keyboard shortcut registry.
   hrefs use :repoId token; the web app fills it from the active repo. */
import type { IconName } from "./icons";

export interface NavItemDef {
  key: string;
  label: string;
  icon: IconName;
  /** Route template; :repoId is replaced with the active repo id by the app. */
  href: string;
  /** Optional g-nav shortcut suffix (e.g. "p" → g then p). */
  gKey?: string;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItemDef[];
}

/**
 * Two sections, as in the design: what you review lives under WORKSPACE, what
 * reviews it lives under SKILLS LAB. The split is not decoration — an agent, a
 * skill and a convention are one workflow (write a rule → attach it → extract
 * more from the code), and a flat list gave no hint that they belong together.
 *
 * The design's third group (GLOBAL: Memory, Multi-Agent Review, Agent
 * Performance, CI Runs) is a later lesson, so it is absent rather than disabled
 * — a nav entry to a route that does not exist is worse than no entry. The
 * `eval` item WAS in that category and no longer is: `/eval` exists as of L06,
 * so the entry follows its route rather than preceding it.
 *
 * Both consumers (`useGlobalShortcuts`, `useShellCommands`) flatten NAV, so the
 * grouping is a Sidebar concern only and adding a section changes no shortcut.
 */
export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
    ],
  },
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
      { key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "c" },
      // Deliberately no `gKey`: "c" is Conventions', and reshuffling a shipped
      // shortcut is a worse change than one nav entry without one (AC-25).
      { key: "context", label: "Project Context", icon: "FileText", href: "/repos/:repoId/context" },
      // Also no `gKey`, for the same reason and one more: the design gives this
      // item no shortcut at all, so inventing one would be the nav diverging
      // from the artboard rather than following it.
      { key: "eval", label: "Eval Dashboard", icon: "Gauge", href: "/eval" },
    ],
  },
];

export const SETTINGS_ITEM: NavItemDef = {
  key: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings/api-keys",
  gKey: ",",
};

export const SETTINGS_SECTIONS = [
  { key: "api-keys", label: "API Keys" },
  { key: "models", label: "Feature Models" },
] as const;

/** Keyboard shortcut registry. Wiring is finalized by A6. */
export interface ShortcutDef {
  keys: string;
  label: string;
  group: "Navigation" | "Findings" | "Actions" | "Global";
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
  { keys: "g c", label: "Go to Conventions", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}
