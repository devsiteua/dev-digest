"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, MonoLink } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { RISK_ICON, RISK_SEV } from "../../constants";
import { middleTruncate, splitRef } from "../../helpers";
import { s, pillFor } from "./styles";

interface RiskPillRowProps {
  risks: Risk[];
  /** Opens a referenced file in the Files tab — threaded from the page. */
  onOpenFile: (path: string, line: number | null) => void;
}

/**
 * The risks as a wrapping row of toggle pills, one panel open at a time.
 *
 * This is the design's `RiskPillRow` (screen `pull-request-detail`, artboard
 * `pr-overview`) built here rather than imported: it is a DESIGN component, not
 * a `@devdigest/ui` one, and `vendor/ui/**` is do-not-touch. Adopted as given
 * means the design decides how it looks — the pills, the per-kind icon, the
 * severity border that appears only on the open pill, and the panel carrying the
 * explanation plus the refs.
 *
 * Two things the design's fixture has no concept of, both from the contract:
 * `kind: 'other'` (its map has five kinds; ours has six) and a risk whose
 * `file_refs` are all empty because grounding dropped them. AC-18 fixes what
 * that looks like: the explanation survives, the reference list does not.
 */
export function RiskPillRow({ risks, onOpenFile }: RiskPillRowProps) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState<number | null>(null);
  const opened = open == null ? null : risks[open];

  return (
    <div>
      <div style={s.row}>
        {risks.map((risk, i) => {
          const RiskIcon = Icon[RISK_ICON[risk.kind]];
          const colour = RISK_SEV[risk.severity];
          return (
            <button
              key={`${risk.kind}:${risk.title}`}
              type="button"
              style={pillFor(open === i, colour)}
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
            >
              <RiskIcon size={13} style={{ color: colour }} />
              {risk.title}
              {/* The kind and the severity are colour and glyph in the design,
                  which is nothing at all to a screen reader — so both are said
                  in words that are not shown. */}
              <span style={s.srOnly}>
                {` — ${t(`kind.${risk.kind}`)}, ${t(`severity.${risk.severity}`)}`}
              </span>
            </button>
          );
        })}
      </div>

      {opened && (
        <div style={s.panel}>
          <p style={s.explanation}>{opened.explanation}</p>
          {opened.file_refs.length > 0 ? (
            <div style={s.refs}>
              {opened.file_refs.map((ref) => {
                const { path, line } = splitRef(ref);
                return (
                  // `MonoLink` is a control, so it is given the one destination
                  // that needs no new plumbing: the Files tab, through the same
                  // callback a review-focus row uses. `title` carries the full
                  // reference, because the label may be middle-truncated.
                  <span key={ref} title={ref}>
                    <MonoLink onClick={() => onOpenFile(path, line)}>
                      {middleTruncate(ref)}
                    </MonoLink>
                  </span>
                );
              })}
            </div>
          ) : (
            // AC-18's second half, made visible: a risk keeps its explanation
            // when every reference it named was dropped. Saying so is better
            // than a panel that silently has one fewer row than its neighbour.
            <div style={s.noRefs}>{t("card.droppedRefsOnRisk")}</div>
          )}
        </div>
      )}
    </div>
  );
}
