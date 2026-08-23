import type {
  FindingRecord,
  PrFile,
  SmartDiff,
  SmartDiffFile,
  SmartDiffRole,
} from "@devdigest/shared";
import { SEVERITY_KEYS, type SeverityKey } from "@/lib/severity";
import { ROLE_ORDER } from "./constants";

/** One file card: what the server said about it, and the patch to render. */
export interface SmartDiffRow {
  meta: SmartDiffFile;
  file: PrFile;
}

export interface SmartDiffGroupRows {
  role: SmartDiffRole;
  rows: SmartDiffRow[];
}

/** A file the smart diff knows about but the detail has no patch for. */
function fileFromMeta(meta: SmartDiffFile): PrFile {
  return {
    path: meta.path,
    additions: meta.additions,
    deletions: meta.deletions,
    patch: null,
  };
}

/** A file the detail has but the smart diff never classified. */
function metaFromFile(file: PrFile): SmartDiffFile {
  return {
    path: file.path,
    pseudocode_summary: null,
    additions: file.additions,
    deletions: file.deletions,
    finding_lines: [],
  };
}

/**
 * Join the server's groups to the detail's files, by path.
 *
 * The two lists come from two requests over the same table, and `GET /pulls/:id`
 * rewrites that table on every detail load — so they CAN disagree. The rule for
 * every disagreement is the same: nothing disappears.
 *
 *  - a path in a group with no `PrFile` still renders, with no patch text;
 *  - a `PrFile` in no group is appended to `core`, because an unclassified file
 *    is the case where a reviewer most needs to see it, not least.
 */
export function buildGroupRows(
  groups: SmartDiff["groups"],
  files: PrFile[],
): SmartDiffGroupRows[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const claimed = new Set<string>();

  const out: SmartDiffGroupRows[] = groups.map((group) => ({
    role: group.role,
    rows: group.files.map((meta) => {
      claimed.add(meta.path);
      return { meta, file: byPath.get(meta.path) ?? fileFromMeta(meta) };
    }),
  }));

  const orphans = files.filter((f) => !claimed.has(f.path));
  if (orphans.length === 0) return out;

  const core = out.find((g) => g.role === "core");
  const rows = orphans.map((file) => ({ meta: metaFromFile(file), file }));
  if (core) core.rows.push(...rows);
  else out.unshift({ role: "core", rows });

  // A group invented here has to land in the right place, not at the end.
  return [...out].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

export interface FindingOverlay {
  /** Flagged lines per path, ascending and unique. */
  lines: Record<string, number[]>;
  /** Severity per flagged line, per path. */
  severity: Record<string, Record<number, SeverityKey>>;
}

/**
 * The client's own view of which lines are flagged.
 *
 * It exists because of a timing problem the server cannot solve: a review is
 * fire-and-forget, so the smart-diff response was computed before the run that
 * is finishing right now. `usePrReviews` IS refreshed when a run settles
 * (`page.tsx` `onRunDone`), so overlaying its findings is what makes the badges
 * appear without a reload — and it is also the only source of SEVERITY, which
 * the contract's `finding_lines` has no room for.
 *
 * A line flagged by two findings keeps the WORST severity, in the same order the
 * rest of the app ranks them.
 */
export function buildFindingOverlay(findings: FindingRecord[]): FindingOverlay {
  const lines: Record<string, Set<number>> = {};
  const severity: Record<string, Record<number, SeverityKey>> = {};

  for (const f of findings) {
    const key = f.severity as SeverityKey;
    if (!SEVERITY_KEYS.includes(key)) continue;
    (lines[f.file] ??= new Set()).add(f.start_line);
    const perLine = (severity[f.file] ??= {});
    const current = perLine[f.start_line];
    if (!current || SEVERITY_KEYS.indexOf(key) < SEVERITY_KEYS.indexOf(current)) {
      perLine[f.start_line] = key;
    }
  }

  return {
    lines: Object.fromEntries(
      Object.entries(lines).map(([path, set]) => [path, [...set].sort((a, b) => a - b)]),
    ),
    severity,
  };
}

/**
 * Which lines to badge for one file.
 *
 * The overlay wins whenever the client actually has reviews, because it is the
 * newer of the two answers. Before they load — or on a PR nobody has reviewed —
 * the server's `finding_lines` is all there is, and it is right.
 */
export function findingLinesFor(
  meta: SmartDiffFile,
  overlay: FindingOverlay | null,
): number[] {
  if (!overlay) return meta.finding_lines;
  return overlay.lines[meta.path] ?? [];
}

/** Total additions/deletions across the files the detail actually has. */
export function totalStat(files: PrFile[]): { additions: number; deletions: number } {
  return files.reduce(
    (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
    { additions: 0, deletions: 0 },
  );
}
