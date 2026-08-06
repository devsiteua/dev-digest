/**
 * Token estimation, shared by the run-trace drawer and the skill editor.
 *
 * Both screens answer the same question — "what does this text cost in a prompt?"
 * — so they must answer it the same way, or a skill's editor and the trace it
 * later appears in would disagree about the same body.
 *
 * Estimated, not exact. The server counts with a real tokenizer (js-tiktoken) and
 * writes that number to the run log; this is the ~4-chars-per-token heuristic,
 * which is good enough for a badge and, unlike a recorded count, also works on
 * traces written before per-block accounting existed.
 */

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Compact label for a block of prompt text, e.g. "~1.2k tokens". */
export function formatBlockTokens(text: string): string {
  const n = approxTokens(text);
  return n >= 1000 ? `~${(n / 1000).toFixed(1)}k tokens` : `~${n} tokens`;
}
