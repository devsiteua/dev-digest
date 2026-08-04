/**
 * severityCounts mirrors the server's rollupSeverities, including the part that
 * matters: `findings.severity` is an unconstrained text column, so an unknown
 * level must be skipped rather than bucketed anywhere.
 */
import { describe, it, expect } from "vitest";
import { severityCounts, countFor, totalCount, EMPTY_COUNTS } from "./severity";

describe("severityCounts", () => {
  it("tallies the three levels and ignores an unknown one", () => {
    expect(
      severityCounts([
        { severity: "CRITICAL" },
        { severity: "CRITICAL" },
        { severity: "WARNING" },
        { severity: "SUGGESTION" },
        { severity: "INFO" }, // exists in the UI kit, never reachable from the API
        { severity: "WEIRD" },
      ]),
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  it("is all-zero for no findings", () => {
    expect(severityCounts([])).toEqual(EMPTY_COUNTS);
  });

  it("does not mutate EMPTY_COUNTS between calls", () => {
    severityCounts([{ severity: "CRITICAL" }]);
    expect(EMPTY_COUNTS).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

describe("countFor / totalCount", () => {
  const counts = { critical: 2, warning: 1, suggestion: 1 };

  it("reads one bucket by its uppercase severity key", () => {
    expect(countFor(counts, "CRITICAL")).toBe(2);
    expect(countFor(counts, "WARNING")).toBe(1);
    expect(countFor(counts, "SUGGESTION")).toBe(1);
  });

  it("sums the three buckets", () => {
    expect(totalCount(counts)).toBe(4);
    expect(totalCount(EMPTY_COUNTS)).toBe(0);
  });
});
