/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { SEVERITY_KEYS, type SeverityKey } from "@/lib/severity";
import { AUTO_EXPAND_MAX_LINES, FOCUS_HIGHLIGHT_MS } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor, findingBadgeFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export interface FileCardProps {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Lines a review flagged in this file, ascending. Drives the header badge. */
  findingLines?: number[];
  /** Severity per flagged line, when the caller knows it. */
  severityByLine?: Record<number, SeverityKey>;
  /**
   * Seeds the expanded state instead of the 200-line heuristic. Read ONCE, at
   * mount: `open` stays uncontrolled, so every current caller keeps the exact
   * behaviour it has today.
   */
  defaultOpen?: boolean;
  /** The line to scroll to when `focusToken` changes. */
  focusLine?: number | null;
  /**
   * Bumped by the parent to re-trigger a jump to `focusLine`. A counter rather
   * than a boolean because clicking the same badge twice must scroll twice, and
   * a value that does not change would not re-run the effect.
   */
  focusToken?: number;
  /** Asks the parent to focus a line — the parent owns the token. */
  onFocusLine?: (line: number) => void;
}

export function FileCard({
  file,
  commenting,
  findingLines,
  severityByLine,
  defaultOpen,
  focusLine,
  focusToken,
  onFocusLine,
}: FileCardProps) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    defaultOpen ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const [focused, setFocused] = React.useState<number | null>(null);
  const headerRef = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  /**
   * Jump to `focusLine` whenever the parent bumps the token.
   *
   * Opening the card is part of the jump: a badge on a collapsed file has to
   * reveal the line, not just remember that someone asked for it. The scroll
   * runs a frame later because the lines do not exist in the DOM until that
   * `setOpen(true)` has rendered.
   *
   * When no rendered line carries the number — a finding outside every hunk of
   * a truncated patch — the card HEADER is scrolled to instead. That is the
   * degraded path the acceptance criteria name: the reader still lands on the
   * right file rather than on nothing at all.
   */
  React.useEffect(() => {
    if (!focusToken || focusLine == null) return;
    setOpen(true);
    let cleared: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      const target = bodyRef.current?.querySelector<HTMLElement>(`[data-line="${focusLine}"]`);
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        setFocused(focusLine);
        cleared = setTimeout(() => setFocused(null), FOCUS_HIGHLIGHT_MS);
      } else {
        headerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      if (cleared) clearTimeout(cleared);
      // Clear the highlight, not just its timer. The parent holds ONE focus, so
      // jumping into another file re-runs this cleanup with `focusToken`
      // undefined — and without this line the card that was jumped to first
      // keeps its outline for as long as it is mounted, leaving two lines
      // claiming to be the one the reader asked for.
      setFocused(null);
    };
  }, [focusToken, focusLine]);

  const findingCount = findingLines?.length ?? 0;
  // The badge's colour is the WORST severity in the file, because that is the
  // decision it helps a reader make. Unknown severities (no reviews loaded yet)
  // leave it neutral rather than guessing.
  const worstSeverity = React.useMemo<SeverityKey | undefined>(() => {
    if (!findingLines || !severityByLine) return undefined;
    // `SEVERITY_KEYS` is the canonical order (`@/lib/severity`), and it is also
    // what the overlay ranks with — a local copy here would let the badge's
    // colour and the line's stripe disagree after one of them is edited.
    return SEVERITY_KEYS.find((sev) => findingLines.some((line) => severityByLine[line] === sev));
  }, [findingLines, severityByLine]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div ref={headerRef} onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        {findingCount > 0 && (
          <button
            type="button"
            title={t("diffViewer.findingBadgeTitle", { count: findingCount })}
            aria-label={t("diffViewer.findingBadgeTitle", { count: findingCount })}
            style={findingBadgeFor(worstSeverity)}
            onClick={(e) => {
              // The header toggles the card; the badge must not also collapse it
              // on its way to opening it.
              e.stopPropagation();
              const line = findingLines![0]!;
              if (onFocusLine) onFocusLine(line);
              else setOpen(true);
            }}
          >
            <Icon.AlertTriangle size={11} />
            {findingCount}
          </button>
        )}
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div ref={bodyRef} style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                severity={ln.newNo != null ? severityByLine?.[ln.newNo] : undefined}
                focused={ln.newNo != null && focused === ln.newNo}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
