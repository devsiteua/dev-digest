/* SmartDiffViewer — the reviewer-ordered diff (L03): group headers by role,
   findings badges that jump to the offending line, and the split nudge. Renders
   the same `FileCard` the flat viewer does, so a diff line looks like a diff
   line wherever it is read. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingRecord, PrFile, SmartDiff, SmartDiffRole } from "@devdigest/shared";
import { FileCard, type DiffCommentApi } from "@/components/diff-viewer";
import { ROLE_COLOUR } from "./constants";
import {
  buildFindingOverlay,
  buildGroupRows,
  findingLinesFor,
  flattenRows,
  totalStat,
  type SmartDiffRow,
} from "./helpers";
import { s, roleDotFor, toggleButtonFor } from "./styles";

interface SmartDiffViewerProps {
  groups: SmartDiff["groups"];
  splitSuggestion: SmartDiff["split_suggestion"];
  /** The detail's files — the source of every patch, and of the original order. */
  files: PrFile[];
  /**
   * The latest review's findings, or `null` while they are still loading.
   *
   * `null` and `[]` mean different things: the first says "ask the server's
   * `finding_lines`", the second says "there are none, and that is current".
   */
  findings?: FindingRecord[] | null;
  commenting?: DiffCommentApi;
  /**
   * Opens a finding in the Findings tab. Supplied by the page, which owns the
   * URL; nothing below this component knows there is a router.
   */
  onOpenFinding?: (findingId: string) => void;
  /**
   * A file the URL asks this viewer to focus, already checked against the diff
   * by `DiffTab` — so anything arriving here is a path this PR really changes.
   *
   * It arrives as a PROP rather than living here because this component is
   * unmounted whenever another tab is active: local state could not survive the
   * round trip, and the reload AC-34 asks about would land on nothing.
   */
  focusFile?: string | null;
  /** The line inside `focusFile`, or `null` — then the file opens and nothing jumps. */
  focusLine?: number | null;
}

/**
 * Which line a click on a file's badge jumps to, and a counter to re-fire it.
 *
 * `line` is nullable because a focus can also arrive from the URL, where the
 * line is optional: `FileCard`'s effect returns early on a null line, so such a
 * focus opens the file (through `defaultOpen`) and highlights nothing.
 */
interface Focus {
  path: string;
  line: number | null;
  token: number;
}

export function SmartDiffViewer({
  groups,
  splitSuggestion,
  files,
  findings,
  commenting,
  onOpenFinding,
  focusFile,
  focusLine,
}: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  // Uncontrolled on purpose. The Files tab is unmounted while another tab is
  // active (`{tab === "diff" && …}`), so nothing here survives a tab switch —
  // which is why the toggle is the only local state, and why it may not hold
  // anything a reader would be annoyed to lose.
  const [smart, setSmart] = React.useState(true);
  const [focus, setFocus] = React.useState<Focus | null>(null);

  /**
   * Turn an incoming `?file`/`?line` into the SAME focus a badge click produces.
   *
   * This is the one legitimate `useEffect` here: the URL is an external system,
   * and the focus it asks for has to become the token `FileCard`'s existing
   * jump-and-highlight already listens to. Keyed on the pair, so navigating from
   * one review-focus row to another re-fires — and asking twice for the same
   * line does not, which is correct: nothing moved.
   */
  React.useEffect(() => {
    if (!focusFile) return;
    setFocus((prev) => ({
      path: focusFile,
      line: focusLine ?? null,
      token: (prev?.token ?? 0) + 1,
    }));
  }, [focusFile, focusLine]);

  const overlay = React.useMemo(
    () => (findings ? buildFindingOverlay(findings) : null),
    [findings],
  );
  const groupRows = React.useMemo(() => buildGroupRows(groups, files), [groups, files]);
  const flatRows = React.useMemo(() => flattenRows(groupRows, files), [groupRows, files]);
  const stat = React.useMemo(() => totalStat(flatRows), [flatRows]);

  const label: Record<SmartDiffRole, string> = {
    core: t("smartDiff.coreLabel"),
    wiring: t("smartDiff.wiringLabel"),
    boilerplate: t("smartDiff.boilerplateLabel"),
  };
  const description: Record<SmartDiffRole, string> = {
    core: t("smartDiff.coreDesc"),
    wiring: t("smartDiff.wiringDesc"),
    boilerplate: t("smartDiff.boilerplateDesc"),
  };

  // Named for what it returns — a handler for ONE file's card. `focusLine` is
  // the incoming URL line, and the two must not share a name.
  const focusLineFor = (path: string) => (line: number) =>
    setFocus((prev) => ({ path, line, token: (prev?.token ?? 0) + 1 }));

  const card = (row: SmartDiffRow, role: SmartDiffRole | null) => {
    const lines = findingLinesFor(row.meta, overlay);
    return (
      <FileCard
        key={row.file.path}
        file={row.file}
        commenting={commenting}
        findingLines={lines}
        severityByLine={overlay?.severity[row.file.path]}
        // Both come from the overlay, so both are absent together: before the
        // reviews load the badges still render from the server's
        // `finding_lines`, and the severity words stay plain text.
        findingIdByLine={overlay?.findingId[row.file.path]}
        onOpenFinding={onOpenFinding}
        // A file the URL points at wins over every rule below it: the reader
        // asked for this one by name, including when it is a lock file. It is
        // also what covers the `line`-less case — `FileCard`'s jump effect
        // returns early without a line, so nothing else would reveal the card.
        //
        // Otherwise: boilerplate is collapsed unconditionally — that is what
        // "the lock file starts collapsed" means, and leaving it to the 200-line
        // heuristic would open a 3-line generated file while hiding a 300-line
        // one. Elsewhere a flagged file opens; an unflagged one keeps the card's
        // own rule, so a PR with no review still reads the way it does today.
        defaultOpen={
          row.file.path === focusFile
            ? true
            : role === "boilerplate"
              ? false
              : lines.length > 0
                ? true
                : undefined
        }
        focusLine={focus?.path === row.file.path ? focus.line : null}
        focusToken={focus?.path === row.file.path ? focus.token : undefined}
        onFocusLine={focusLineFor(row.file.path)}
      />
    );
  };

  return (
    <div>
      <div style={s.header}>
        <div style={s.headerStat}>
          {t("smartDiff.filesCount", { count: stat.files })}{" "}
          <span className="mono" style={s.addText}>
            +{stat.additions}
          </span>{" "}
          <span className="mono" style={s.delText}>
            −{stat.deletions}
          </span>
        </div>
        <div style={s.toggleGroup} role="group" aria-label={t("smartDiff.orderLabel")}>
          <button type="button" style={toggleButtonFor(smart)} onClick={() => setSmart(true)}>
            {t("smartDiff.smartOrder")}
          </button>
          <button type="button" style={toggleButtonFor(!smart)} onClick={() => setSmart(false)}>
            {t("smartDiff.originalOrder")}
          </button>
        </div>
      </div>

      {splitSuggestion.too_big && (
        <div style={s.banner}>
          <Icon.AlertTriangle size={18} style={s.bannerIcon} />
          <div style={{ flex: 1 }}>
            <div style={s.bannerTitle}>
              {t("smartDiff.largeTitle", { lines: splitSuggestion.total_lines })}
            </div>
            <div style={s.bannerBody}>{t("smartDiff.largeBody")}</div>
            <div style={s.splitList}>
              {splitSuggestion.proposed_splits.map((split) => (
                <div key={split.name} style={s.splitRow}>
                  <span className="mono" style={s.splitName}>
                    {split.name}
                  </span>
                  <span className="mono" style={s.splitFiles}>
                    {split.files.join(", ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {smart ? (
        groupRows.map((group) => (
          <div key={group.role} style={s.group}>
            <div style={s.groupHeader}>
              <span style={roleDotFor(ROLE_COLOUR[group.role])} aria-hidden />
              <span style={s.groupLabel}>{label[group.role]}</span>
              <span style={s.groupDesc}>{description[group.role]}</span>
              <span className="tnum" style={s.groupCount}>
                {t("smartDiff.filesCount", { count: group.rows.length })}
              </span>
            </div>
            <div style={s.cards}>{group.rows.map((row) => card(row, group.role))}</div>
          </div>
        ))
      ) : (
        // "Original order" is the order GitHub returned the files in, not an
        // alphabetical sort: that order is information, `localeCompare` is not.
        // The rows are the JOINED ones, so switching views can never drop a
        // file the grouped view was showing.
        <div style={s.cards}>{flatRows.map((row) => card(row, null))}</div>
      )}
    </div>
  );
}
