import type { SmartDiffGroup, SmartDiffRole, SmartDiff } from '@devdigest/shared';
import type { PrFileRow } from '../../db/rows.js';
import {
  BOILERPLATE_DIR_SEGMENTS,
  BOILERPLATE_SUFFIXES,
  DEFAULT_ROLE,
  DOC_DIR_SEGMENTS,
  DOC_EXTENSIONS,
  LOCK_FILE_BASENAMES,
  ROLE_ORDER,
  SPLIT_AREA_DEPTH,
  SPLIT_MAX_PROPOSALS,
  SPLIT_MIN_AREA_FILES,
  SPLIT_MIN_PROPOSALS,
  SPLIT_MIN_TOTAL_LINES,
  TEST_DIR_SEGMENTS,
  TEST_FILE_INFIXES,
  WIRING_BASENAMES,
  WIRING_EXTENSIONS,
  WIRING_PATH_INFIXES,
  WIRING_STEMS,
} from './constants.js';

/**
 * The pure half of the Smart Diff: what a file IS, and how a PR would be split.
 *
 * Nothing here reads a database, a request or a clock, so every rule in it is
 * testable as a table. The row type comes from `src/db/rows.ts` — the one path
 * under `src/db/` a non-repository module file may import
 * (`db-schema-only-in-data-layer` is an ERROR for every other one).
 */

/** The fields of a `pr_files` row that classification and ordering actually use. */
export type SmartDiffInputFile = Pick<PrFileRow, 'path' | 'additions' | 'deletions'>;

/** Finding start lines per file path, as the service assembles them. */
export type FindingLinesByPath = Record<string, number[]>;

// ---- Classification --------------------------------------------------------

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function basename(path: string): string {
  const parts = segments(path);
  return parts[parts.length - 1] ?? path;
}

/** The part of a basename before its first dot — `vite.config.ts` → `vite`. */
function stem(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

function isLockFile(name: string): boolean {
  return LOCK_FILE_BASENAMES.includes(name);
}

function isTest(path: string, name: string): boolean {
  if (TEST_FILE_INFIXES.some((infix) => name.includes(infix))) return true;
  return segments(path).slice(0, -1).some((seg) => TEST_DIR_SEGMENTS.includes(seg));
}

function isDoc(path: string, name: string): boolean {
  if (DOC_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return segments(path).slice(0, -1).some((seg) => DOC_DIR_SEGMENTS.includes(seg));
}

function isGenerated(path: string, name: string): boolean {
  if (BOILERPLATE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return segments(path).slice(0, -1).some((seg) => BOILERPLATE_DIR_SEGMENTS.includes(seg));
}

function isWiring(path: string, name: string): boolean {
  if (WIRING_BASENAMES.includes(name)) return true;
  if (WIRING_STEMS.includes(stem(name))) return true;
  if (WIRING_PATH_INFIXES.some((infix) => path.includes(infix))) return true;
  return WIRING_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * What role a changed file plays, from its path alone.
 *
 * A FIRST-MATCH LADDER, evaluated boilerplate → wiring → core on the lowercased
 * repo-relative path. Two properties follow from that order and both are
 * deliberate:
 *
 *  - a lock file is boilerplate even though its manifest is wiring, because the
 *    lock check runs first;
 *  - `core` is the DEFAULT, so a path no rule recognises is treated as business
 *    logic. That is the safe direction: the cost of over-showing a file is a
 *    reviewer's glance, the cost of hiding one is a defect nobody read.
 *
 * Lowercasing is what makes `Dockerfile`, `Makefile` and `Cargo.lock` match
 * one-cased constants; it costs nothing, since no rule here depends on case.
 */
export function classifyPath(path: string): SmartDiffRole {
  const lower = path.toLowerCase();
  const name = basename(lower);

  if (isLockFile(name)) return 'boilerplate';
  if (isGenerated(lower, name)) return 'boilerplate';
  if (isTest(lower, name)) return 'boilerplate';
  if (isDoc(lower, name)) return 'boilerplate';
  if (isWiring(lower, name)) return 'wiring';
  return DEFAULT_ROLE;
}

// ---- Grouping and ordering -------------------------------------------------

/**
 * The files of a PR, split by role and ordered inside each group.
 *
 * In-group order is findings desc → changed lines desc → path asc. The last key
 * is not decoration: without it two files with the same counts come back in
 * whatever order Postgres returned them, and the same request can answer
 * differently twice in a row — the trap the root `CLAUDE.md` records for
 * `defaultNow()`, in its read-side form.
 *
 * Empty groups are omitted rather than sent as `files: []`, so the client never
 * has to decide whether to draw a "Boilerplate · 0 files" header.
 */
export function buildGroups(
  files: readonly SmartDiffInputFile[],
  findingLines: FindingLinesByPath = {},
): SmartDiffGroup[] {
  const byRole = new Map<SmartDiffRole, SmartDiffGroup['files']>();

  for (const file of files) {
    const role = classifyPath(file.path);
    const bucket = byRole.get(role) ?? [];
    bucket.push({
      path: file.path,
      // The contract has room for it, but filling it needs a model call and this
      // endpoint makes none. Explicitly null, not absent: "we did not derive it"
      // is a different answer from "the field does not exist here".
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLines[file.path] ?? [],
    });
    byRole.set(role, bucket);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of ROLE_ORDER) {
    const bucket = byRole.get(role);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort(
      (a, b) =>
        b.finding_lines.length - a.finding_lines.length ||
        b.additions + b.deletions - (a.additions + a.deletions) ||
        a.path.localeCompare(b.path),
    );
    groups.push({ role, files: bucket });
  }
  return groups;
}

// ---- Split suggestion ------------------------------------------------------

/** `src/api/public/webhooks.ts` → `src/api`; a root file is its own area. */
function areaOf(path: string): string {
  const parts = segments(path);
  return parts.slice(0, SPLIT_AREA_DEPTH).join('/');
}

/**
 * Whether this PR is too big, and by which seams it would come apart.
 *
 * `total_lines` counts EVERY file, because that is the number a reviewer feels.
 * The proposals count only `core` and `wiring` files: a lock file follows
 * whichever PR changes its manifest, so listing it as a split of its own would
 * be advice nobody can take.
 *
 * `too_big` needs BOTH a large enough diff and at least `SPLIT_MIN_PROPOSALS`
 * qualifying areas. One area, however large, is not a PR that wants splitting —
 * it is a PR about one thing.
 */
export function buildSplitSuggestion(
  files: readonly SmartDiffInputFile[],
): SmartDiff['split_suggestion'] {
  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  const byArea = new Map<string, { files: string[]; lines: number }>();
  for (const file of files) {
    if (classifyPath(file.path) === 'boilerplate') continue;
    const area = areaOf(file.path);
    const entry = byArea.get(area) ?? { files: [], lines: 0 };
    entry.files.push(file.path);
    entry.lines += file.additions + file.deletions;
    byArea.set(area, entry);
  }

  const candidates = [...byArea.entries()]
    .filter(([, entry]) => entry.files.length >= SPLIT_MIN_AREA_FILES)
    // Biggest area first — it is the one worth lifting out — with the area name
    // as the tie-break, for the same determinism reason as the group sort.
    .sort(([an, a], [bn, b]) => b.lines - a.lines || an.localeCompare(bn))
    .slice(0, SPLIT_MAX_PROPOSALS)
    .map(([name, entry]) => ({ name, files: [...entry.files].sort((a, b) => a.localeCompare(b)) }));

  const tooBig = totalLines >= SPLIT_MIN_TOTAL_LINES && candidates.length >= SPLIT_MIN_PROPOSALS;

  return {
    too_big: tooBig,
    total_lines: totalLines,
    // Proposals only exist as the banner's content; sending them while the banner
    // is hidden would invite a second surface to render advice we decided not to
    // give.
    proposed_splits: tooBig ? candidates : [],
  };
}

// ---- Findings --------------------------------------------------------------

/**
 * Finding start lines per path: unique, ascending.
 *
 * Two findings on the same line are one badge and one jump target — the count on
 * the badge is a count of LINES to look at, not of findings, which is why the
 * duplicate is dropped here rather than in the client.
 */
export function groupFindingLines(
  rows: readonly { file: string; startLine: number }[],
): FindingLinesByPath {
  const byPath = new Map<string, Set<number>>();
  for (const row of rows) {
    const set = byPath.get(row.file) ?? new Set<number>();
    set.add(row.startLine);
    byPath.set(row.file, set);
  }
  return Object.fromEntries(
    [...byPath.entries()].map(([path, lines]) => [path, [...lines].sort((a, b) => a - b)]),
  );
}
