/**
 * severityCountsByRun bridges two lists the tab already holds: runs (which know
 * their totals but not the breakdown) and reviews (which carry the findings).
 */
import { describe, it, expect } from "vitest";
import type { ReviewRecord, FindingRecord } from "@devdigest/shared";
import { severityCountsByRun } from "./helpers";

function finding(severity: string): FindingRecord {
  return {
    id: `f-${severity}-${Math.random()}`,
    severity: severity as FindingRecord["severity"],
    category: "bug",
    title: severity,
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
    created_at: "2026-06-11T18:44:34.000Z",
    findings: [],
    ...o,
  } as ReviewRecord;
}

describe("severityCountsByRun", () => {
  it("keys each review's tally by its run id", () => {
    const map = severityCountsByRun([
      review({
        id: "rev-1",
        run_id: "run-a",
        findings: [finding("CRITICAL"), finding("CRITICAL"), finding("WARNING")],
      }),
      review({ id: "rev-2", run_id: "run-b", findings: [finding("SUGGESTION")] }),
    ]);
    expect(map["run-a"]).toEqual({ critical: 2, warning: 1, suggestion: 0 });
    expect(map["run-b"]).toEqual({ critical: 0, warning: 0, suggestion: 1 });
  });

  it("skips a review with no run id rather than keying it under undefined", () => {
    const map = severityCountsByRun([
      review({ id: "rev-1", run_id: null, findings: [finding("CRITICAL")] }),
    ]);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("leaves a run with no review absent, so the row can fall back to its text", () => {
    const map = severityCountsByRun([review({ id: "rev-1", run_id: "run-a" })]);
    expect(map["run-b"]).toBeUndefined();
  });

  it("reports zeros for a review that kept no findings", () => {
    const map = severityCountsByRun([review({ id: "rev-1", run_id: "run-a", findings: [] })]);
    expect(map["run-a"]).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});
