import { REF_MAX_CHARS } from "./constants";

/**
 * Split a reference into the file it names and the line it points at.
 *
 * The suffix rule is the server's: a `file_refs` entry is checked on the part
 * BEFORE its first `:`, so `path:12` and `path:12-30` both resolve to `path`.
 * The same split is applied here so a click lands on the same file the
 * allow-list approved, and the first number of a range is the line to open —
 * a range has to start somewhere, and its start is where a reader reads from.
 *
 * A Windows-style `C:\…` cannot appear: these come from git paths.
 */
export function splitRef(ref: string): { path: string; line: number | null } {
  const at = ref.indexOf(":");
  if (at < 0) return { path: ref, line: null };
  const path = ref.slice(0, at);
  const match = /^(\d+)/.exec(ref.slice(at + 1));
  return { path, line: match ? Number(match[1]) : null };
}

/**
 * Elide the MIDDLE of an over-long reference, never its end.
 *
 * The end is the part that distinguishes two files in the same deep directory,
 * and a trailing `…` would throw away exactly that. Callers keep the full value
 * in `title`, so nothing is actually lost.
 */
export function middleTruncate(value: string, max = REF_MAX_CHARS): string {
  if (value.length <= max) return value;
  // One character of the budget goes to the ellipsis itself.
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
