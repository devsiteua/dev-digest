/**
 * The Files tab, seen only through the focus the URL hands it.
 *
 * Everything else this tab does — comments, the smart/flat choice — is covered
 * where it lives (`SmartDiffViewer.test.tsx`, the diff-viewer suite). What is
 * only decidable here is AC-35: a `?file=` naming a path this PR does not change
 * must SAY so, on both branches, rather than focusing nothing in silence.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

let smartDiff: SmartDiff | undefined;

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/smart-diff", () => ({
  useSmartDiff: () => ({ data: smartDiff }),
}));

import { DiffTab } from "./DiffTab";

const FILES: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 84, deletions: 0, patch: null },
  { path: "src/config.ts", additions: 4, deletions: 0, patch: null },
];

const CLASSIFIED: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: null,
          additions: 84,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 88, proposed_splits: [] },
} as unknown as SmartDiff;

function renderTab(props: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab prId="pr-1" filesCount={FILES.length} files={FILES} {...props} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  smartDiff = undefined;
  cleanup();
});

describe("DiffTab", () => {
  it("names the file the URL asked for when this PR does not change it", () => {
    smartDiff = CLASSIFIED;
    renderTab({ focusFile: "src/gone.ts", focusLine: 12 });

    expect(screen.getByText(prReview.diffFocus.unknownFile)).toBeInTheDocument();
    // The path itself, not just a generic apology: the reader has to be able to
    // tell WHICH link was stale.
    expect(screen.getByText("src/gone.ts")).toBeInTheDocument();
  });

  it("still names it when nothing was classified and the flat viewer is the fallback", () => {
    // The notice sits above both branches for this reason: an unknown path is a
    // fact about the PR, not about which viewer happened to render.
    smartDiff = undefined;
    renderTab({ focusFile: "src/gone.ts", focusLine: 12 });

    expect(screen.getByText(prReview.diffFocus.unknownFile)).toBeInTheDocument();
  });

  it("says nothing when the file is one this PR changes", () => {
    smartDiff = CLASSIFIED;
    renderTab({ focusFile: "src/config.ts", focusLine: 12 });

    expect(screen.queryByText(prReview.diffFocus.unknownFile)).not.toBeInTheDocument();
  });

  it("says nothing when the URL asks for no file at all", () => {
    smartDiff = CLASSIFIED;
    renderTab();

    expect(screen.queryByText(prReview.diffFocus.unknownFile)).not.toBeInTheDocument();
  });
});
