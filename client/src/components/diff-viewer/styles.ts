import type { CSSProperties } from "react";
import { SEV } from "@devdigest/ui";
import type { SeverityKey } from "@/lib/severity";
import type { Line } from "./helpers";

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** Row background per line kind (add/del tinted, others transparent). */
export function lineRowFor(kind: Line["kind"]): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return { display: "flex", alignItems: "stretch", fontSize: 13, lineHeight: "20px", background };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}

/**
 * The 3 px severity stripe down the left edge of a flagged line.
 *
 * Absolutely positioned so it cannot shift the gutter by a pixel: a diff whose
 * line numbers move when a review lands would read as a different diff.
 */
export function severityBarFor(severity: SeverityKey): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    background: SEV[severity].c,
  };
}

/** The right-hand severity word on a flagged line ("blocker" for CRITICAL). */
export function severityWordFor(severity: SeverityKey, clickable = false): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    paddingRight: 12,
    fontSize: 11,
    fontWeight: 600,
    color: SEV[severity].c,
    flexShrink: 0,
    // Rendered as a <button> when the client knows WHICH finding the line
    // carries, so the element has to be un-styled back to the word the design
    // draws. The underline and the pointer are the whole affordance — a boxed
    // control beside a line of code would read as part of the diff.
    // No shorthand here overlaps a longhand the base object sets — KEEP IT THAT
    // WAY when adding a state-dependent value. `font: "inherit"` used to sit
    // beside the `fontSize`/`fontWeight` above, and `padding: 0` beside its
    // `paddingRight`, which is the hazard `client/INSIGHTS.md` records for
    // `borderColor` vs `borderLeftColor`: silent while every value is constant,
    // and a React warning plus a wrong cascade the moment one depends on state.
    // `background` and `border` below are still shorthands and are safe only
    // because nothing sets a `background-*` or `border-*` longhand; a hover
    // border colour added here would have to spell out all four sides.
    ...(clickable
      ? {
          background: "none",
          border: "none",
          // Per-side, and only the three the base object does not set: `padding`
          // is a shorthand too, and `paddingRight: 12` above is the value this
          // branch wants to keep.
          paddingTop: 0,
          paddingBottom: 0,
          paddingLeft: 0,
          fontFamily: "inherit",
          lineHeight: "inherit",
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 2,
          textDecorationStyle: "dotted" as const,
        }
      : {}),
  };
}

/**
 * The momentary highlight on the line a findings badge just jumped to.
 *
 * Returns an empty object rather than `undefined` so the caller can spread it
 * unconditionally — the row's own background stays whatever the line kind says.
 */
export function focusRowFor(focused: boolean | undefined): CSSProperties {
  return focused ? { outline: "2px solid var(--accent)", outlineOffset: -2 } : {};
}

/** The findings badge in a file-card header, coloured by its worst severity. */
export function findingBadgeFor(severity: SeverityKey | undefined): CSSProperties {
  const colour = severity ? SEV[severity].c : "var(--text-muted)";
  const background = severity ? SEV[severity].bg : "var(--bg-surface)";
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "1px 7px",
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    color: colour,
    background,
  };
}
