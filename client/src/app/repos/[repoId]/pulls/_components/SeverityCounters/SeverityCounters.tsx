/* SeverityCounters — a read-only findings tally, in the two places the design
   shows one: the PR list's FINDINGS column and the Agent-runs timeline row.

   Zero severities are hidden here, unlike the panel's filter chips. Nothing is
   clickable, so nothing reflows when a count changes, and "⛔2 ⚠1" reads faster
   than "⛔2 ⚠1 💡0". The full tally is still in the `title`.

   On hover it opens `FindingsTooltip`, as both design surfaces do — the numbers
   alone say how bad the PR is, the popover says why. The component never fetches:
   the caller supplies `items` (the timeline already holds them; the PR list
   lazy-loads them) and may use `onHover` to start that load on first entry. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { SeverityCounts, FindingRecord } from "@devdigest/shared";
import { SEVERITY_KEYS, countFor, totalCount } from "@/lib/severity";
import { FindingsTooltip } from "../FindingsTooltip";
import { s } from "./styles";

export function SeverityCounters({
  counts,
  items,
  placement = "down",
  tooltipWidth,
  gap = 8,
  onHover,
}: {
  /** Null/undefined = never reviewed, which is not the same as reviewed-and-clean. */
  counts: SeverityCounts | null | undefined;
  /** Findings behind the numbers. Absent or empty = no popover, just the tally. */
  items?: FindingRecord[];
  placement?: "up" | "down";
  tooltipWidth?: number;
  gap?: number;
  /** Fired on the first pointer entry, so a caller can begin loading `items`. */
  onHover?: () => void;
}) {
  const t = useTranslations("prReview");
  const [hovered, setHovered] = React.useState(false);

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
      style={s.row(gap)}
      title={t("severity.summary", {
        critical: counts.critical,
        warning: counts.warning,
        suggestion: counts.suggestion,
      })}
      onMouseEnter={() => {
        setHovered(true);
        onHover?.();
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {SEVERITY_KEYS.filter((key) => countFor(counts, key) > 0).map((key) => {
        const SevIcon = Icon[SEV[key].icon];
        return (
          <span key={key} style={s.counter(SEV[key].c)}>
            <SevIcon size={12} />
            <span className="tnum">{countFor(counts, key)}</span>
          </span>
        );
      })}
      {hovered && items && items.length > 0 && (
        <FindingsTooltip items={items} placement={placement} width={tooltipWidth} />
      )}
    </span>
  );
}

export default SeverityCounters;
