import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../messages/en/skills.json";
// The real provider is mounted in the root layout, which a page test does not
// render — every editor tab reaches for `useToast` and throws without it.
import { ToastProvider } from "../../../lib/toast";

/**
 * The route's own contract: `?tab=` picks the editor pane.
 *
 * This is the test the tab bar could not be: the SkillEditor renders whatever
 * `tab` it is handed, so its tests passed while the PAGE quietly rejected two of
 * the four keys and fell back to Config. Anything that resolves `?tab=` against
 * a list needs a case per tab, or the list drifts and only a browser notices.
 */

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "s1" }),
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => params,
}));

vi.mock("../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../lib/hooks/skills", () => ({
  useSkill: () => ({ data: SKILL, isLoading: false, isError: false, refetch: vi.fn() }),
  useSkills: () => ({ data: [SKILL], isLoading: false, isError: false }),
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillStats: () => ({ data: STATS, isError: false }),
  useSkillVersions: () => ({ data: VERSIONS, isError: false }),
  useRestoreSkillVersion: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

import SkillEditorPage from "./page";

const SKILL: Skill = {
  id: "s1",
  name: "no-then-chains",
  description: "Prefer async/await.",
  type: "convention",
  source: "manual",
  body: "# No .then() chains",
  enabled: true,
  version: 2,
  evidence_files: null,
};

const STATS = {
  used_by: [{ agent_id: "ag1", agent_name: "Test Quality Reviewer", agent_enabled: true }],
  window_days: 30,
  runs: 3,
  findings: 0,
  accepted: 0,
  dismissed: 0,
  accept_rate: null,
  by_category: [],
};

const VERSIONS = [
  { skill_id: "s1", version: 2, body: "# current", created_at: "2026-08-07T10:00:00.000Z" },
  { skill_id: "s1", version: 1, body: "# first", created_at: "2026-08-01T10:00:00.000Z" },
];

const renderAt = (tab?: string) => {
  params = new URLSearchParams(tab ? { tab } : {});
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillEditorPage />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
};

beforeEach(() => replace.mockClear());
afterEach(cleanup);

describe("/skills/:id — ?tab= resolution", () => {
  it("opens Config with no tab in the URL", () => {
    renderAt();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("opens each of the editor's tabs", () => {
    renderAt("preview");
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
    cleanup();

    renderAt("stats");
    expect(screen.getByText("Usage")).toBeInTheDocument();
    cleanup();

    renderAt("versions");
    expect(screen.getByText("Version history")).toBeInTheDocument();
  });

  it("falls back to Config on a tab that does not exist", () => {
    renderAt("evals");
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });
});
