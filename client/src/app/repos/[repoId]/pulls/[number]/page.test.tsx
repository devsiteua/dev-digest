/**
 * The route's own contract: what a manual tab change does to the URL.
 *
 * This is the test no component below the page could be (AC-36). `setTab` lives
 * here because the page owns the URL — `PrDetailHeader` is handed an `onSetTab`
 * and calls whatever it is given, so its own tests pass no matter which params
 * that callback drops. The rule "changing tab by hand clears `findingId`, `file`
 * and `line`" is therefore only decidable at this level, against the URL the
 * router is actually handed. It is the same reason `skills/[id]/page.test.tsx`
 * exists for its own `?tab=` resolution.
 *
 * Interaction is driven with `fireEvent`: `@testing-library/user-event` is not
 * a dependency of this package (`client/INSIGHTS.md`, 2026-08-22).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { PrDetail } from "@devdigest/shared";
import prReview from "../../../../../../messages/en/prReview.json";
import runs from "../../../../../../messages/en/runs.json";
import shell from "../../../../../../messages/en/shell.json";

const replace = vi.fn();
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1", number: "482" }),
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => params,
}));

// The shell mounts the command palette and the global shortcuts; a page test
// renders neither, exactly as the skills page test does.
vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/api" } }),
  useRepoNotFound: () => false,
}));

vi.mock("../../../../../lib/hooks", () => ({
  usePulls: () => ({ data: [{ id: "pr-1", number: 482 }], isLoading: false }),
  usePullDetail: () => ({
    data: PR,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// One mock for the whole reviews module: the page reads runs from it and the
// Files tab reads comments from it, and they are the same module.
vi.mock("../../../../../lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [], refetch: vi.fn() }),
  usePrActiveRuns: () => ({ data: [] }),
  usePrRuns: () => ({ data: [] }),
  useCancelRun: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRun: () => ({ mutate: vi.fn(), isPending: false }),
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunReview: () => ({ mutate: vi.fn(), isPending: false }),
  // Reached only through the run-trace drawer, which a `?trace=` in the URL
  // mounts — see the second test.
  useRunEvents: () => ({ events: [], running: false }),
}));

vi.mock("@/lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/lib/hooks/smart-diff", () => ({
  // Nothing classified → the flat viewer, which is the lighter branch and says
  // nothing about the URL rule under test.
  useSmartDiff: () => ({ data: undefined }),
  smartDiffKey: (prId: string) => ["smart-diff", prId],
}));

vi.mock("../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [], isLoading: false }),
}));

import PRDetailPage from "./page";

const PR: PrDetail = {
  id: "pr-1",
  number: 482,
  title: "Add rate limiting to the public API",
  author: "kate",
  branch: "feat/ratelimit",
  base: "main",
  head_sha: "abc1234",
  additions: 88,
  deletions: 4,
  files_count: 2,
  status: "open",
  opened_at: "2026-08-20T10:00:00.000Z",
  updated_at: "2026-08-21T10:00:00.000Z",
  body: null,
  files: [
    { path: "src/middleware/ratelimit.ts", additions: 84, deletions: 0, patch: null },
    { path: "src/config.ts", additions: 4, deletions: 4, patch: null },
  ],
  commits: [],
};

/** The query string handed to `router.replace`, parsed. */
const replacedParams = () => {
  const [url] = replace.mock.calls.at(0) ?? [];
  if (typeof url !== "string") throw new Error("router.replace was never called");
  const [path = "", query = ""] = url.split("?");
  return { path, sp: new URLSearchParams(query) };
};

const renderAt = (query: string) => {
  params = new URLSearchParams(query);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NextIntlClientProvider locale="en" messages={{ prReview, runs, shell }}>
        <PRDetailPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => replace.mockClear());
afterEach(cleanup);

describe("/repos/:repoId/pulls/:number — changing tab by hand", () => {
  it("drops file, line and findingId in one navigation", () => {
    // The state a review-focus click leaves behind, plus a finding opened
    // earlier: all three describe a place the reader is about to leave.
    renderAt("tab=diff&findingId=f-1&file=src/config.ts&line=42");

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    // ONE call: `setParams` writes every key in a single `replace`, and two
    // calls in the same tick would lose the first one's params.
    expect(replace).toHaveBeenCalledTimes(1);
    const { path, sp } = replacedParams();
    expect(path).toBe("/repos/r1/pulls/482");
    // The whole key set, not three `toBeNull()`s: a param that survives this
    // switch has to be one the rule deliberately keeps, and nothing else was in
    // the URL to keep.
    expect([...sp.keys()]).toEqual(["tab"]);
    expect(sp.get("tab")).toBe("overview");
  });

  it("leaves the params it was not asked to clear alone", () => {
    // A targeted patch, not a reset: `trace` names an open run drawer and has
    // nothing to do with the tab. Dropping it here would make the clear rule a
    // URL wipe, which is not what AC-36 asks for.
    renderAt("tab=diff&file=src/config.ts&line=42&trace=run-7");

    fireEvent.click(screen.getByRole("button", { name: /^Agent runs/ }));

    const { sp } = replacedParams();
    expect(sp.get("tab")).toBe("findings");
    expect(sp.get("trace")).toBe("run-7");
    expect(sp.get("file")).toBeNull();
    expect(sp.get("line")).toBeNull();
  });
});
