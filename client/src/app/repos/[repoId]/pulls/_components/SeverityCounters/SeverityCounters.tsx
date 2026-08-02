/* SeverityCounters — a read-only findings tally, in the two places the design
   shows one: the PR list's FINDINGS column and the Agent-runs timeline row.

   Zero severities are hidden here, unlike the panel's filter chips. Nothing is
   clickable, so nothing reflows when a count changes, and "⛔2 ⚠1" reads faster
   than "⛔2 ⚠1 💡0". The full tally is still in the tooltip.

   Font-agnostic on purpose, like the sibling RunCostBadge: it inherits size and
   colour from its container so the same component fits a table cell and an 11px
   muted timeline column. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge } from "@devdigest/ui";
import type { SeverityCounts } from "@devdigest/shared";
import { SEVERITY_KEYS, countFor, totalCount } from "@/lib/severity";
import { s } from "./styles";

export function SeverityCounters({
  counts,
}: {
  /** Null/undefined = never reviewed, which is not the same as reviewed-and-clean. */
  counts: SeverityCounts | null | undefined;
}) {
  const t = useTranslations("prReview");

  if (counts == null) {
    return (
      <span style={s.muted} title={t("severity.unreviewed")}>
        —
      </span>
    );
  }

  const total = totalCount(counts);
  if (total === 0) {
    return (
      <span className="tnum" style={s.muted} title={t("severity.none")}>
        0
      </span>
    );
  }

  return (
    <span
      style={s.row}
      title={t("severity.summary", {
        critical: counts.critical,
        warning: counts.warning,
        suggestion: counts.suggestion,
      })}
    >
      {SEVERITY_KEYS.filter((key) => countFor(counts, key) > 0).map((key) => (
        <SeverityBadge key={key} severity={key} count={countFor(counts, key)} compact />
      ))}
    </span>
  );
}

export default SeverityCounters;
