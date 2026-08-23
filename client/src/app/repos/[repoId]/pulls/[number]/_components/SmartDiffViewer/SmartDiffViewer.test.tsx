/**
 * The Smart Diff surface.
 *
 * What is worth testing here is not that three headers render — it is the four
 * promises the feature makes that a screenshot cannot check: the lock file stays
 * collapsed while a flagged file opens, a badge click actually scrolls the diff,
 * the flat order is the PR's own, and no changed file can disappear between the
 * two requests this screen joins.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

const patchFor = (line: number) =>
  [`@@ -${line - 1},2 +${line - 1},3 @@`, " context", `+flagged line ${line}`, " tail"].join("\n");

const FILES: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 84, deletions: 0, patch: patchFor(28) },
  { path: "src/config.ts", additions: 4, deletions: 0, patch: patchFor(12) },
  { path: "package-lock.json", additions: 92, deletions: 24, patch: null },
];

const GROUPS: SmartDiff["groups"] = [
  {
    role: "core",
    files: [
      {
        path: "src/middleware/ratelimit.ts",
        pseudocode_summary: null,
        additions: 84,
        deletions: 0,
        finding_lines: [28],
      },
    ],
  },
  {
    role: "wiring",
    files: [
      {
        path: "src/config.ts",
        pseudocode_summary: null,
        additions: 4,
        deletions: 0,
        finding_lines: [12],
      },
    ],
  },
  {
    role: "boilerplate",
    files: [
      {
        path: "package-lock.json",
        pseudocode_summary: null,
        additions: 92,
        deletions: 24,
        finding_lines: [],
      },
    ],
  },
];

const SPLIT: SmartDiff["split_suggestion"] = {
  too_big: false,
  total_lines: 204,
  proposed_splits: [],
};

const finding = (file: string, line: number, severity: string): FindingRecord =>
  ({
    id: `${file}:${line}`,
    file,
    start_line: line,
    end_line: line,
    severity,
    category: "security",
    title: `finding in ${file}`,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
  }) as unknown as FindingRecord;

function renderViewer(props: Partial<React.ComponentProps<typeof SmartDiffViewer>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <SmartDiffViewer
        groups={GROUPS}
        splitSuggestion={SPLIT}
        files={FILES}
        findings={null}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

/** jsdom implements no scrolling at all — the jump is observed through this. */
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(cleanup);

describe("SmartDiffViewer", () => {
  it("renders one header per group, in review order", () => {
    renderViewer();
    const labels = screen.getAllByText(/Core logic|Wiring|Boilerplate/);
    expect(labels.map((el) => el.textContent)).toEqual(["Core logic", "Wiring", "Boilerplate"]);
  });

  it("opens a flagged file and leaves the lock file collapsed", () => {
    renderViewer();
    // The flagged core file's patch is rendered…
    expect(screen.getByText(/flagged line 28/)).toBeInTheDocument();
    // …while the boilerplate card shows only its header.
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
    expect(screen.queryByText(/No diff text available/)).not.toBeInTheDocument();
  });

  it("badges each file the server flagged, with the number of lines", () => {
    renderViewer();
    // The two files the response carries `finding_lines` for — and not the third.
    const badges = screen.getAllByLabelText("1 flagged line(s) — jump to the first");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("1");
  });

  it("scrolls the diff to the flagged line, and highlights it", async () => {
    renderViewer();
    const badges = screen.getAllByLabelText("1 flagged line(s) — jump to the first");
    fireEvent.click(badges[0]!);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    // The scrolled element is the LINE, not the card: `mock.instances` records
    // the receiver, which is the only way to tell the two jumps apart.
    const target = scrollIntoView.mock.instances[0] as HTMLElement;
    expect(target.getAttribute("data-line")).toBe("28");
    // jsdom drops any declaration containing `var()`, so the highlight is read
    // off the style ATTRIBUTE (client/INSIGHTS.md, 2026-08-02).
    await waitFor(() =>
      expect(
        target.querySelector("div")?.getAttribute("style") ?? "",
      ).toContain("outline: 2px solid var(--accent)"),
    );
  });

  it("falls back to the card header when the flagged line is in no hunk", async () => {
    // A finding on line 900 of a patch that only carries lines 11-13: the click
    // must still take the reader to the right file rather than nowhere.
    renderViewer({ findings: [finding("src/config.ts", 900, "CRITICAL")] });
    fireEvent.click(screen.getByLabelText("1 flagged line(s) — jump to the first"));

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const target = scrollIntoView.mock.instances[0] as HTMLElement;
    expect(target.getAttribute("data-line")).toBeNull();
    expect(target.textContent).toContain("src/config.ts");
  });

  it("takes badges and severity from the client's findings once they load", () => {
    renderViewer({
      findings: [
        finding("src/middleware/ratelimit.ts", 28, "CRITICAL"),
        // A line the server's response knows nothing about: the review that
        // found it finished after the smart diff was computed.
        finding("src/config.ts", 12, "WARNING"),
      ],
    });
    expect(screen.getAllByLabelText("1 flagged line(s) — jump to the first")).toHaveLength(2);
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  it("drops a badge the latest review no longer reports", () => {
    // `[]` is not "unknown" — it is a review that found nothing, and the stale
    // `finding_lines` from the previous one must not survive it.
    renderViewer({ findings: [] });
    expect(screen.queryByLabelText(/flagged line/)).not.toBeInTheDocument();
  });

  it("switches to the PR's own file order, keeping every file", () => {
    renderViewer();
    fireEvent.click(screen.getByText("Original order"));
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    for (const file of FILES) {
      expect(screen.getByText(file.path)).toBeInTheDocument();
    }
  });

  it("renders a changed file the server never classified, rather than dropping it", () => {
    const extra: PrFile = { path: "src/api/new.ts", additions: 3, deletions: 0, patch: null };
    renderViewer({ files: [...FILES, extra] });
    expect(screen.getByText("src/api/new.ts")).toBeInTheDocument();
    // Appended to core: an unclassified file is the one a reviewer most needs.
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getAllByText(/files$/)[0]).toBeTruthy();
  });

  it("renders a classified file the detail has no patch for", () => {
    renderViewer({ files: [FILES[0]!] });
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
  });

  it("shows the split banner only when the server says the PR is too big", () => {
    const { unmount } = renderViewer();
    expect(screen.queryByText(/This PR is large/)).not.toBeInTheDocument();
    unmount();

    renderViewer({
      splitSuggestion: {
        too_big: true,
        total_lines: 812,
        proposed_splits: [
          { name: "src/api", files: ["src/api/a.ts", "src/api/b.ts"] },
          { name: "src/jobs", files: ["src/jobs/a.ts", "src/jobs/b.ts"] },
        ],
      },
    });
    const banner = screen.getByText(/This PR is large \(812 changed lines\)/).parentElement!;
    expect(within(banner).getByText("src/api")).toBeInTheDocument();
    expect(within(banner).getByText("src/jobs")).toBeInTheDocument();
  });
});
