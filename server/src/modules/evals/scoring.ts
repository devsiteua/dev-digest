import type { EvalExpectation } from '@devdigest/shared';

/**
 * Eval scoring — three numbers, computed by arithmetic alone.
 *
 * Nothing to do with a model reaches this file — no provider, no dependency
 * registry, no outbound port — and nothing ever will: a metric produced by asking
 * a model whether the model did well is not a measurement, it is the same opinion
 * twice.
 *
 * That is enforced by a ZERO-COUNT grep over this file for the vocabulary of a
 * model call. Zero-count, because a positive count cannot tell an import line
 * from a call site — and zero means there is no such line at all, in code OR in a
 * comment. If this paragraph ever names one of those symbols, the gate fires, and
 * the gate is right.
 *
 * Everything here is pure and total: no clock, no randomness, no I/O, and no
 * throw on an empty input.
 */

/** A metric and the two numbers it was computed from. Never one without the other. */
export interface Ratio {
  value: number;
  numerator: number;
  denominator: number;
}

/**
 * AC-20 — an empty denominator yields `1`, and the denominator travels with it.
 *
 * `1` is what the contract requires on the wire (`EvalRun.recall` is
 * `z.number().min(0).max(1)` and cannot carry `null`), and it is also a lie on
 * its own: nothing was asked, so nothing was answered correctly. The denominator
 * is what makes it honest, and it is why the screen renders `—` rather than 100%.
 */
export function ratio(numerator: number, denominator: number): Ratio {
  return { value: denominator === 0 ? 1 : numerator / denominator, numerator, denominator };
}

/** The finding fields matching reads. */
export interface LocatedFinding {
  file: string;
  start_line: number;
  end_line: number;
}

/** Two closed line ranges, treated as inclusive on both ends. */
export interface LineRange {
  start_line: number;
  end_line: number;
}

/**
 * AC-18's first half — do two inclusive line ranges intersect?
 *
 * Inclusive on both ends, so ranges that merely TOUCH (1-5 and 5-9) overlap,
 * while adjacent-but-disjoint ranges (1-5 and 6-9) do not. Each range is
 * normalised first, so a caller that hands them over backwards still gets the
 * right answer instead of a silent `false`.
 */
export function rangesOverlap(a: LineRange, b: LineRange): boolean {
  const aLo = Math.min(a.start_line, a.end_line);
  const aHi = Math.max(a.start_line, a.end_line);
  const bLo = Math.min(b.start_line, b.end_line);
  const bHi = Math.max(b.start_line, b.end_line);
  return aLo <= bHi && bLo <= aHi;
}

/**
 * AC-18 — a finding matches an expectation when the FILE is equal and the line
 * ranges intersect. Nothing else is compared.
 *
 * Deliberately not: severity, category, title or wording. Two runs of the same
 * agent phrase the same defect differently, and a matcher that compared prose
 * would report a regression every time the model chose another verb.
 */
export function matches(finding: LocatedFinding, expectation: EvalExpectation): boolean {
  if (finding.file !== expectation.file) return false;
  return rangesOverlap(finding, expectation);
}

/** One case's contribution to the batch's three ratios. */
export interface CaseScore {
  pass: boolean;
  /** `must_find` expectations met — 0 or 1, since a case carries one expectation. */
  matchedCount: number;
  /** `must_find` expectations asserted — 1 for `must_find`, 0 for `must_not_flag`. */
  expectedCount: number;
  /** Every finding the run reported for this case. Descriptive, not a denominator. */
  reportedCount: number;
  /** Findings that landed on a `must_find` range: precision's numerator. */
  correctCount: number;
  /**
   * Findings that landed on a `must_not_flag` range — noise the reviewer was
   * told, by a decision someone actually made, to stop reporting.
   */
  violationCount: number;
}

/**
 * Score one case against the findings a run produced for it.
 *
 * `must_find` passes when at least one finding lands on the expected range.
 * `must_not_flag` passes when NO finding does — and it contributes nothing to
 * recall's denominator, because it asserts an absence, not a discovery.
 *
 * **What counts against precision, and what does not.** Only findings this set
 * has an opinion about: a hit on a `must_find` range is right, a hit on a
 * `must_not_flag` range is noise, and everything else the agent reported is
 * UNJUDGED — nobody ever accepted or dismissed it, so it is neither.
 *
 * Charging every unjudged finding to precision was the first reading, and it is
 * wrong twice over. A case stores the whole PR diff while asserting one
 * expectation, so the agent legitimately reports findings the case says nothing
 * about; counting those as false positives makes precision a measure of how
 * talkative the model is, pins it near zero, and — the part that matters — makes
 * it move for reasons that have nothing to do with the prompt under test. Under
 * this reading, deliberately breaking a prompt so the agent starts flagging what
 * was dismissed moves precision DOWN, visibly, which is the behaviour the whole
 * dismissed half of the dataset exists to produce.
 */
export function scoreCase(expectation: EvalExpectation, findings: LocatedFinding[]): CaseScore {
  const hits = findings.filter((f) => matches(f, expectation));

  if (expectation.kind === 'must_find') {
    const matched = hits.length > 0 ? 1 : 0;
    return {
      pass: matched === 1,
      matchedCount: matched,
      expectedCount: 1,
      reportedCount: findings.length,
      correctCount: hits.length,
      violationCount: 0,
    };
  }

  return {
    pass: hits.length === 0,
    matchedCount: 0,
    expectedCount: 0,
    reportedCount: findings.length,
    correctCount: 0,
    violationCount: hits.length,
  };
}

/**
 * The two drop lists a review carries, plus what survived both gates.
 *
 * Arrays rather than counts so a caller can hand a `ReviewOutcome` over directly
 * and the reading below stays visible at the call site.
 */
export interface GroundingCounts {
  /** `review.findings` — what survived BOTH the grounding gate and the scope gate. */
  findings: readonly unknown[];
  /** `ReviewOutcome.dropped` — dropped by the grounding gate: a hallucinated location. */
  dropped: readonly unknown[];
  /** `ReviewOutcome.scopeDropped` — dropped by the SCOPE gate: a real location, other job. */
  scopeDropped: readonly unknown[];
}

/**
 * AC-19 — the fraction of findings that survived the GROUNDING gate.
 *
 * A review passes through two gates, and `review.findings` is what came out of
 * both. `scopeDropped` therefore sits on the NUMERATOR side: those findings were
 * grounded — their file and lines were real — and were removed afterwards for
 * being about something this pull request does not change. Charging them to
 * citation accuracy would make an unrelated policy look like a hallucination and
 * would move this metric every time the scope gate is retuned.
 *
 *   (findings + scopeDropped) / (findings + scopeDropped + dropped)
 */
export function citationAccuracy(counts: GroundingCounts): Ratio {
  const grounded = counts.findings.length + counts.scopeDropped.length;
  return ratio(grounded, grounded + counts.dropped.length);
}

/** The three ratios of one batch, each with the denominator it was computed over. */
export interface BatchScore {
  recall: Ratio;
  precision: Ratio;
  citationAccuracy: Ratio;
}

/**
 * Aggregate a batch from its per-case scores and per-case grounding results.
 *
 * The three denominators are the ones the spec names, and they are different
 * populations on purpose:
 *   recall     — `must_find` EXPECTATIONS asserted by the set
 *   precision  — findings this set has an OPINION about: hits on a `must_find`
 *                range plus hits on a `must_not_flag` one. Not every finding
 *                reported; see `scoreCase`
 *   citation   — FINDINGS the model produced, before the grounding gate
 *
 * The two lists are matched positionally by the caller; a batch with no cases
 * returns three vacuous `1`s over three zero denominators, which is AC-20.
 */
export function scoreBatch(cases: CaseScore[], grounding: GroundingCounts[]): BatchScore {
  let matched = 0;
  let expected = 0;
  let correct = 0;
  let violations = 0;

  for (const c of cases) {
    matched += c.matchedCount;
    expected += c.expectedCount;
    correct += c.correctCount;
    violations += c.violationCount;
  }

  let grounded = 0;
  let dropped = 0;
  for (const g of grounding) {
    grounded += g.findings.length + g.scopeDropped.length;
    dropped += g.dropped.length;
  }

  return {
    recall: ratio(matched, expected),
    precision: ratio(correct, correct + violations),
    citationAccuracy: ratio(grounded, grounded + dropped),
  };
}
