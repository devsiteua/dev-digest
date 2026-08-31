import type { EvalCase, EvalExpectation, EvalRunBatch } from "@devdigest/shared";

/** The expectation stored on a case, or null when the blob is not one. */
export function expectationOf(c: EvalCase): EvalExpectation | null {
  const e = c.expected_output as Partial<EvalExpectation> | null | undefined;
  if (!e || typeof e !== "object" || !e.kind || !e.file) return null;
  return e as EvalExpectation;
}

/** `file:line` or `file:start-end` — the source the case was cut from. */
export function sourceLabel(e: EvalExpectation): string {
  return e.start_line === e.end_line
    ? `${e.file}:${e.start_line}`
    : `${e.file}:${e.start_line}-${e.end_line}`;
}

/**
 * A batch is incomplete when fewer cases ran than the set held.
 *
 * Read off the two counters rather than off `status === "partial"`, so a batch
 * that ends `done` with a mismatch — which would be a bug worth seeing — still
 * shows the marker instead of hiding behind a status word.
 */
export function isIncomplete(b: EvalRunBatch): boolean {
  return b.cases_ran < b.cases_total;
}

/**
 * The run to compare a batch against: the next one DOWN the list.
 *
 * The list is newest-first, so a batch's predecessor is at `index + 1`. The
 * oldest batch has none, and the compare control is absent rather than disabled
 * there — a control that can never work is worse than no control.
 */
export function previousBatch(batches: EvalRunBatch[], index: number): EvalRunBatch | undefined {
  return batches[index + 1];
}
