import { describe, it, expect } from "vitest";
import { approxTokens, formatBlockTokens, formatSeconds, formatTokens } from "./helpers";

describe("approxTokens", () => {
  it("uses the ~4-chars-per-token heuristic, rounding up", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("abc")).toBe(1);
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2);
  });
});

describe("formatBlockTokens", () => {
  it("counts small blocks exactly and abbreviates large ones", () => {
    expect(formatBlockTokens("x".repeat(40))).toBe("~10 tokens");
    expect(formatBlockTokens("x".repeat(8000))).toBe("~2.0k tokens");
  });

  it("labels an empty block as zero rather than blank", () => {
    expect(formatBlockTokens("")).toBe("~0 tokens");
  });
});

describe("existing trace formatters still behave", () => {
  it("formats duration and the in→out token summary", () => {
    expect(formatSeconds(8420)).toBe("8.4s");
    expect(formatTokens(7310, 1809)).toBe("7k→1.8k");
  });
});
