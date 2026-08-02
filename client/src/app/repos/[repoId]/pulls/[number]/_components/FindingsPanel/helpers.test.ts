/**
 * visibleFindings is the one place confidence, severity and sort order meet.
 * The first test is the regression that matters: the two-argument call must keep
 * behaving exactly as it did before the severity filter existed.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { visibleFindings, confidenceFiltered } from "./helpers";

function f(id: string, severity: string, confidence = 0.9): FindingRecord {
  return {
    id,
    severity: severity as FindingRecord["severity"],
    category: "bug",
    title: id,
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  };
}

// Deliberately out of severity order, so the sort has something to do.
const FINDINGS = [
  f("sugg", "SUGGESTION"),
  f("crit", "CRITICAL"),
  f("warn", "WARNING"),
  f("lowSugg", "SUGGESTION", 0.2),
];

const ids = (rows: FindingRecord[]) => rows.map((r) => r.id);

describe("confidenceFiltered", () => {
  it("passes everything through when the toggle is off", () => {
    expect(confidenceFiltered(FINDINGS, false)).toHaveLength(4);
  });

  it("drops findings below the threshold when the toggle is on", () => {
    expect(ids(confidenceFiltered(FINDINGS, true))).toEqual(["sugg", "crit", "warn"]);
  });
});

describe("visibleFindings", () => {
  it("sorts CRITICAL → WARNING → SUGGESTION with no severity filter (unchanged behaviour)", () => {
    expect(ids(visibleFindings(FINDINGS, false))).toEqual(["crit", "warn", "sugg", "lowSugg"]);
  });

  it("still applies the confidence gate before sorting", () => {
    expect(ids(visibleFindings(FINDINGS, true))).toEqual(["crit", "warn", "sugg"]);
  });

  it("narrows to a single selected severity", () => {
    expect(ids(visibleFindings(FINDINGS, false, ["WARNING"]))).toEqual(["warn"]);
  });

  it("shows the union of two selected severities, still sorted", () => {
    expect(ids(visibleFindings(FINDINGS, false, ["SUGGESTION", "CRITICAL"]))).toEqual([
      "crit",
      "sugg",
      "lowSugg",
    ]);
  });

  it("treats an empty selection as no filter", () => {
    expect(visibleFindings(FINDINGS, false, [])).toHaveLength(4);
  });

  it("ignores a selected severity that matches nothing, rather than emptying the list", () => {
    // The panel would otherwise be stuck: a zero-count chip renders inert, so the
    // user could not un-toggle it.
    const noSuggestions = [f("crit", "CRITICAL"), f("warn", "WARNING")];
    expect(ids(visibleFindings(noSuggestions, false, ["SUGGESTION"]))).toEqual(["crit", "warn"]);
  });

  it("keeps a real selection when only part of it is empty", () => {
    const noSuggestions = [f("crit", "CRITICAL"), f("warn", "WARNING")];
    expect(ids(visibleFindings(noSuggestions, false, ["SUGGESTION", "CRITICAL"]))).toEqual([
      "crit",
    ]);
  });

  it("empties the list only when the underlying set is empty", () => {
    expect(visibleFindings([], false, ["CRITICAL"])).toEqual([]);
  });
});
