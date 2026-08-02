import { describe, it, expect } from "vitest";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import { lineLabel, latestReviewFindings } from "./findings";

function finding(id: string): FindingRecord {
  return {
    id,
    severity: "CRITICAL",
    category: "bug",
    title: id,
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev",
    accepted_at: null,
    dismissed_at: null,
  };
}

function review(o: Partial<ReviewRecord> & { id: string }): ReviewRecord {
  return {
    pr_id: "pr1",
    agent_id: "a1",
    agent_name: "Agent",
    run_id: "run-1",
    kind: "review",
    verdict: "comment",
    summary: "s",
    score: 70,
    model: "m",
    created_at: "2026-06-11T18:00:00.000Z",
    findings: [],
    ...o,
  } as ReviewRecord;
}

describe("lineLabel", () => {
  it("collapses a single-line range", () => {
    expect(lineLabel({ start_line: 12, end_line: 12 })).toBe("12");
  });

  it("spells out a multi-line range", () => {
    expect(lineLabel({ start_line: 61, end_line: 74 })).toBe("61-74");
  });
});

describe("latestReviewFindings", () => {
  it("picks the newest review regardless of the order it arrived in", () => {
    const rows = [
      review({
        id: "old",
        created_at: "2026-06-11T18:00:00.000Z",
        findings: [finding("stale")],
      }),
      review({
        id: "new",
        created_at: "2026-06-12T09:00:00.000Z",
        findings: [finding("fresh")],
      }),
    ];
    expect(latestReviewFindings(rows).map((f) => f.id)).toEqual(["fresh"]);
  });

  it("ignores summaries, exactly as the server's tally does", () => {
    // The PR list counts only kind='review'. A summary showing up in the popover
    // would list findings the numbers above it never counted.
    const rows = [
      review({
        id: "summary",
        kind: "summary",
        created_at: "2026-06-13T09:00:00.000Z",
        findings: [finding("summarised")],
      }),
      review({
        id: "review",
        created_at: "2026-06-12T09:00:00.000Z",
        findings: [finding("real")],
      }),
    ];
    expect(latestReviewFindings(rows).map((f) => f.id)).toEqual(["real"]);
  });

  it("is empty when the PR has no reviews at all", () => {
    expect(latestReviewFindings([])).toEqual([]);
  });
});
