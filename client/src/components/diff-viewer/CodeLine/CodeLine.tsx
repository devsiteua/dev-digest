/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SeverityKey } from "@/lib/severity";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor, severityBarFor, severityWordFor, focusRowFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  severity,
  focused,
  findingId,
  onOpenFinding,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /**
   * The severity of a finding anchored to this line, when one is. Optional, so
   * every existing caller renders exactly as before.
   */
  severity?: SeverityKey;
  /** True while this line is the target of a just-clicked findings badge. */
  focused?: boolean;
  /**
   * WHICH finding this line carries, when the caller knows.
   *
   * It is what turns the severity word into a way into that finding. Absent —
   * on a PR whose reviews have not loaded, where the server tells us the line is
   * flagged but not by what — the word renders exactly as it did before.
   */
  findingId?: string;
  /** Asks the page to open a finding. The router stays out of this component. */
  onOpenFinding?: (findingId: string) => void;
}) {
  const t = useTranslations("shell");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  return (
    <div
      // The scroll target of a findings badge. `newNo` is the number a finding's
      // `start_line` is expressed in, so only new-side lines are addressable —
      // a finding on a deleted line has nothing to scroll to, by definition.
      data-line={ln.newNo ?? undefined}
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ ...lineRowFor(ln.kind), ...focusRowFor(focused), position: "relative" }}>
        {severity && <span style={severityBarFor(severity)} aria-hidden />}
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {severity &&
          // The design writes CRITICAL as "blocker" beside a line of code, and
          // the other two as their own name — so the word is copy, not a derived
          // string, and it lives in the message catalogue like the rest of it.
          //
          // With a finding id it is also the way INTO that finding: the reader
          // clicks the word on the line and lands on its card in the Findings
          // tab. Without one it stays the plain word it has always been, rather
          // than a control that would have to do nothing.
          (findingId && onOpenFinding ? (
            <button
              type="button"
              title={t("diffViewer.openFinding")}
              aria-label={t("diffViewer.openFinding")}
              style={severityWordFor(severity, true)}
              onClick={() => onOpenFinding(findingId)}
            >
              {t(`diffViewer.severityWord.${severity}`)}
            </button>
          ) : (
            <span style={severityWordFor(severity)}>
              {t(`diffViewer.severityWord.${severity}`)}
            </span>
          ))}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
