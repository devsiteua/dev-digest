/* FindingsTooltip — the hover popover behind both severity-counter surfaces: the
   PR list's FINDINGS column and the Agent-runs timeline row. Ported from the
   design (`12-prdetail_runs.jsx:38-54`).

   It answers "which findings are those numbers?" without a navigation. Purely
   presentational: whoever renders it has already decided the popover is open and
   supplied the findings — the PR list lazy-loads them on hover, the timeline
   already holds them. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { lineLabel } from "@/lib/findings";
import { stripMd } from "./helpers";
import { s } from "./styles";

export function FindingsTooltip({
  items,
  placement = "down",
  width = 360,
}: {
  items: FindingRecord[];
  /** "up" for rows in the lower half of a list, so the popover stays on screen. */
  placement?: "up" | "down";
  width?: number;
}) {
  const t = useTranslations("prReview");
  if (items.length === 0) return null;

  return (
    <div style={s.wrap(placement, width)} role="tooltip">
      <div style={s.header}>
        <Icon.AlertOctagon size={12} />
        {t("tooltip.title", { count: items.length })}
      </div>
      <div style={s.list}>
        {items.map((f, i) => (
          <div key={f.id} style={s.item(i === items.length - 1)}>
            <div style={s.titleRow}>
              <SeverityBadge severity={f.severity} compact />
              <span style={s.title}>{f.title}</span>
              <CategoryTag category={f.category} />
            </div>
            <div style={s.metaRow}>
              <span className="mono" style={s.anchor}>
                {f.file}:{lineLabel(f)}
              </span>
              <ConfidenceNum value={f.confidence} />
            </div>
            <div style={s.rationale}>{stripMd(f.rationale)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default FindingsTooltip;
