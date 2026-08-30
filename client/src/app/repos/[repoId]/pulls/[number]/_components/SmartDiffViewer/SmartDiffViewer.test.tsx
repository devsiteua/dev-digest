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

  it("clears the highlight on the file it left when the reader jumps to another", async () => {
    // One focus, two cards: the card jumped to FIRST must not keep its outline,
    // or two lines claim to be the one the reader asked for.
    renderViewer();
    const badges = screen.getAllByLabelText("1 flagged line(s) — jump to the first");
    fireEvent.click(badges[0]!);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const first = scrollIntoView.mock.instances[0] as HTMLElement;
    await waitFor(() =>
      expect(first.querySelector("div")?.getAttribute("style") ?? "").toContain("outline:"),
    );

    fireEvent.click(badges[1]!);
    await waitFor(() =>
      expect(first.querySelector("div")?.getAttribute("style") ?? "").not.toContain("outline:"),
    );
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

  it("keeps a recovered file when the reader switches to the flat order", () => {
    // The detail knows one file; the smart diff knows three. Switching views is
    // not allowed to drop the two only the server told us about.
    renderViewer({ files: [FILES[0]!] });
    fireEvent.click(screen.getByText("Original order"));
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
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

/**
 * The other half of a badge: not "where in this file", which the header badge
 * answers, but "what did the reviewer actually say", which only the Findings
 * tab can. The viewer's whole job here is to hand the page the right id — the
 * navigation itself is the page's, and is tested where it lives.
 */
describe("SmartDiffViewer — the badge on a line opens its finding", () => {
  const FINDINGS = [
    finding("src/middleware/ratelimit.ts", 28, "CRITICAL"),
    finding("src/config.ts", 12, "WARNING"),
  ];

  it("asks the page to open the finding the clicked line carries", () => {
    const onOpenFinding = vi.fn();
    renderViewer({ findings: FINDINGS, onOpenFinding });
    fireEvent.click(screen.getByText("blocker"));
    expect(onOpenFinding).toHaveBeenCalledWith("src/middleware/ratelimit.ts:28");
  });

  it("names the finding on the line clicked, not the first one on the PR", () => {
    const onOpenFinding = vi.fn();
    renderViewer({ findings: FINDINGS, onOpenFinding });
    fireEvent.click(screen.getByText("warning"));
    expect(onOpenFinding).toHaveBeenCalledWith("src/config.ts:12");
  });

  it("carries the id of the WORST finding when two share a line", () => {
    // The word says "blocker", so the card it opens must be the CRITICAL one —
    // the severity and the id come from the same tie-break for exactly this.
    const onOpenFinding = vi.fn();
    const sameLine = [
      finding("src/config.ts", 12, "WARNING"),
      finding("src/config.ts", 12, "CRITICAL"),
    ];
    // Two findings with one id each: `finding()` keys the id off file:line, so
    // give the critical one its own to tell them apart.
    sameLine[1]!.id = "the-critical-one";
    renderViewer({ findings: sameLine, onOpenFinding });
    fireEvent.click(screen.getByText("blocker"));
    expect(onOpenFinding).toHaveBeenCalledWith("the-critical-one");
  });

  it("names each badge by its own line, so a screenful of them stays distinct", () => {
    // Not decoration: this label is the accessible name a screen reader reads
    // out, and it is also the only locator `09-pr-smart-diff.flow.json` has for
    // picking ONE of a dozen identical-looking words on the page.
    renderViewer({ findings: FINDINGS, onOpenFinding: vi.fn() });
    expect(
      screen.getByRole("button", { name: "Open the blocker on line 28 in the Findings tab" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open the warning on line 12 in the Findings tab" }),
    ).toBeInTheDocument();
  });

  it("badges the file but not the line while the reviews have not loaded", () => {
    // `findings={null}` is the pre-load state. Severity and finding id both come
    // from the overlay, so neither exists yet: the file still carries its header
    // badge from the server's `finding_lines`, and the LINE carries nothing —
    // not the severity word, and so not a control with nowhere to go either.
    const onOpenFinding = vi.fn();
    renderViewer({ findings: null, onOpenFinding });
    expect(screen.getAllByLabelText("1 flagged line(s) — jump to the first")).toHaveLength(2);
    expect(screen.queryByText("blocker")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open the .* on line/ }),
    ).not.toBeInTheDocument();
  });

  it("drops the way in when the latest review no longer reports the line", () => {
    // The inverse, and the one that can regress: findings ARE loaded, so the
    // overlay exists — it just holds nothing for this file. The badge, the word
    // and the button all have to go together.
    const onOpenFinding = vi.fn();
    renderViewer({ findings: [], onOpenFinding });
    expect(screen.queryByText("blocker")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open the .* on line/ }),
    ).not.toBeInTheDocument();
  });

  it("jumps to the line the URL asked for, with no click at all", async () => {
    // AC-33's landing half and AC-34 in one assertion: the focus arrives as a
    // prop from the page, is turned into the same token a badge click produces,
    // and lands on the line. A reload is exactly this — a first render with the
    // props already set — so if this passes, the reload does too.
    renderViewer({ focusFile: "src/config.ts", focusLine: 12 });

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const target = scrollIntoView.mock.instances[0] as HTMLElement;
    expect(target.getAttribute("data-line")).toBe("12");
  });

  it("opens the file the URL names even when it carries no line", async () => {
    // `line` is optional in the URL, and `FileCard`'s jump effect returns early
    // without one — so the file has to be revealed by being open, or `?file=`
    // alone would do nothing visible and be indistinguishable from a bug.
    renderViewer({ focusFile: "package-lock.json", focusLine: null });

    // The lock file is the hard case: it is collapsed unconditionally by role.
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/No diff text available/)).toBeInTheDocument());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

