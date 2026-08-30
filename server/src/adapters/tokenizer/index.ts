/**
 * tokenizer adapter — the process-wide token counter.
 *
 * Two consumers today, and the second is why the old "ONLY under
 * modules/repo-intel" scope line is gone rather than merely widened:
 *   - the repo-map renderer (pipeline/repo-map.ts) binary-searches the largest
 *     set of symbols that fits a token budget; that loop calls `count()`
 *     ≤ ~13 times;
 *   - `modules/brief` spends an 8 000-token input budget with it, counting the
 *     concatenated system + user message once per rung of its trim ladder.
 *
 * Default impl: js-tiktoken `cl100k_base` (pure-JS, no natives). The encoder is
 * lazy-initialised (loading the BPE ranks is the heavy part) and any failure
 * falls back to the `ceil(chars / 4)` heuristic — the renderer must never throw.
 *
 * That fallback is STICKY per instance (`broken` below): once the BPE load has
 * failed, this counter answers `ceil(chars / 4)` for the rest of the process's
 * life. For the repo map that costs a slightly wrong budget. For the brief it
 * costs more: the ladder can trim differently, so the assembled input differs,
 * so the SHA-256 `state_key` differs — a brief generated on a healthy process
 * reads STALE on a broken one, and vice versa. Reported as staleness, never as
 * an error, which is the honest direction but is worth knowing before debugging
 * a brief that will not stop being stale.
 *
 * Swappable in tests via a mock counter (ContainerOverrides.tokenizer), which is
 * also what keeps the ladder's unit tests deterministic.
 */
import { getEncoding, type Tiktoken } from 'js-tiktoken';

export interface Tokenizer {
  count(text: string): number;
}

/** Heuristic fallback used before/instead of a real encoder. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class TiktokenTokenizer implements Tokenizer {
  private enc?: Tiktoken;
  private broken = false;

  count(text: string): number {
    if (this.broken) return approxTokens(text);
    try {
      this.enc ??= getEncoding('cl100k_base');
      return this.enc.encode(text).length;
    } catch {
      // BPE load failed once — don't retry per call; stick to the heuristic.
      this.broken = true;
      return approxTokens(text);
    }
  }
}
