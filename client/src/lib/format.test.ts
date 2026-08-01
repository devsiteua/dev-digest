/**
 * formatCost — adaptive precision. The design shows costs spanning two orders of
 * magnitude ($0.0013 on one run, $0.06 on another) and every one of them must
 * render from a single formatter, with no per-call-site precision flag.
 */
import { describe, it, expect } from "vitest";
import { formatCost, formatTokenCount, NO_VALUE } from "./format";

describe("formatCost", () => {
  it.each([
    // [usd, expected, where the design shows it]
    [0.06, "$0.06", "run trace Stats tile"],
    [0.014, "$0.014", "PR list column"],
    [0.041, "$0.041", "PR list column"],
    [0.003, "$0.003", "PR list column"],
    [0.0013, "$0.0013", "Agent runs timeline row"],
    [0.001, "$0.001", "review runs header"],
  ])("renders %s as %s (%s)", (usd, expected) => {
    expect(formatCost(usd)).toBe(expected);
  });

  it("renders a genuinely free run as $0.00, not a dash", () => {
    // A model priced 0/0 (e.g. z-ai/glm-4.7-flash) really did cost nothing.
    expect(formatCost(0)).toBe("$0.00");
  });

  it("renders unknown cost as a dash, not $0.00", () => {
    expect(formatCost(null)).toBe(NO_VALUE);
    expect(formatCost(undefined)).toBe(NO_VALUE);
  });

  it("keeps two decimals once the cost reaches a dollar", () => {
    // Regression guard: stripping trailing zeros with a naive /0+$/ replace
    // turns "10.0000" into "1". Precision is computed, never string-trimmed.
    expect(formatCost(10)).toBe("$10.00");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(100)).toBe("$100.00");
    expect(formatCost(0.1)).toBe("$0.10");
  });

  it("does not crash on a non-finite cost", () => {
    expect(formatCost(Number.NaN)).toBe(NO_VALUE);
  });
});

describe("formatTokenCount", () => {
  it("groups thousands", () => {
    expect(formatTokenCount(9119)).toBe("9,119");
    expect(formatTokenCount(12011)).toBe("12,011");
    expect(formatTokenCount(150)).toBe("150");
  });
});
