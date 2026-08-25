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
export function metaFromFile(file: PrFile): SmartDiffFile {
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

/**
 * Every row, once, in the PR's own file order.
 *
 * The flat view has the same "nothing disappears" duty as the grouped one, and
 * it cannot get there by iterating the detail's `files`: a path the smart diff
 * classified but the detail has no `PrFile` for would vanish the moment the
 * reader clicks "Original order" — a file visible one click ago, gone with no
 * indication. So the flat list is the JOINED rows, ordered by where the detail
 * put them, with the recovered ones appended.
 */
export function flattenRows(groups: SmartDiffGroupRows[], files: PrFile[]): SmartDiffRow[] {
  const order = new Map(files.map((f, i) => [f.path, i]));
  return [...groups.flatMap((g) => g.rows)].sort(
    (a, b) =>
      (order.get(a.file.path) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.file.path) ?? Number.MAX_SAFE_INTEGER),
  );
}

export interface FindingOverlay {
  /** Flagged lines per path, ascending and unique. */
  lines: Record<string, number[]>;
  /** Severity per flagged line, per path. */
  severity: Record<string, Record<number, SeverityKey>>;
  /**
   * WHICH finding a flagged line carries, per path — the id a badge navigates to.
   *
   * It can only come from here. The contract's `finding_lines` is a list of
   * numbers (Round 1, Decision 8), so before the reviews load the client knows
   * that a line is flagged but not what flagged it — and the badge stays inert
   * rather than becoming a control with nowhere to go.
   */
  findingId: Record<string, Record<number, string>>;
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
 * A line flagged by two findings keeps the WORST severity, and the id of THAT
 * finding — one tie-break, applied once, so the word a reader sees and the card
 * the word opens can never describe two different findings.
 */
export function buildFindingOverlay(findings: FindingRecord[]): FindingOverlay {
  const lines: Record<string, Set<number>> = {};
  const severity: Record<string, Record<number, SeverityKey>> = {};
  const findingId: Record<string, Record<number, string>> = {};

  for (const f of findings) {
    const key = f.severity as SeverityKey;
    if (!SEVERITY_KEYS.includes(key)) continue;
    (lines[f.file] ??= new Set()).add(f.start_line);
    const perLine = (severity[f.file] ??= {});
    const perLineId = (findingId[f.file] ??= {});
    const current = perLine[f.start_line];
    if (!current || SEVERITY_KEYS.indexOf(key) < SEVERITY_KEYS.indexOf(current)) {
      perLine[f.start_line] = key;
      perLineId[f.start_line] = f.id;
    }
  }

  return {
    lines: Object.fromEntries(
      Object.entries(lines).map(([path, set]) => [path, [...set].sort((a, b) => a - b)]),
    ),
    severity,
    findingId,
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

/**
 * Totals over the rows actually rendered.
 *
 * Taken from the joined rows rather than the detail's `files`, so the
 * "N files · +X −Y" line above the groups always describes the cards below it —
 * including a file only the smart diff knew about.
 */
export function totalStat(rows: readonly SmartDiffRow[]): {
  files: number;
  additions: number;
  deletions: number;
} {
  return rows.reduce(
    (acc, r) => ({
      files: acc.files + 1,
      additions: acc.additions + r.file.additions,
      deletions: acc.deletions + r.file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}
