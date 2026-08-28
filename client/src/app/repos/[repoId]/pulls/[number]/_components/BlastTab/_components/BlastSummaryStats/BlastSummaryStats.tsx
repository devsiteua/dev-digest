"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@devdigest/ui";
import type { BlastCounts } from "../../helpers";
import { s } from "./styles";

interface BlastSummaryStatsProps {
  counts: BlastCounts;
}

function Stat({ icon, value, label }: { icon: IconName; value: number; label: string }) {
  const I = Icon[icon];
  return (
    <span style={s.stat}>
      <I size={13} style={s.icon} />
      <b className="tnum" style={s.value}>
        {value}
      </b>
      {label}
    </span>
  );
}

/**
 * The four-number row at the top of the card: symbols · callers · endpoints ·
 * cron/jobs — the design's `BlastRadiusSummary` verbatim.
 *
 * It takes counts rather than the map, so the "distinct across the whole map"
 * rule lives in one tested helper instead of being re-derived in the markup.
 */
export function BlastSummaryStats({ counts }: BlastSummaryStatsProps) {
  const t = useTranslations("blast");
  return (
    <div style={s.root}>
      <Stat icon="Code" value={counts.symbols} label={t("stat.symbols")} />
      <Stat icon="CornerDownRight" value={counts.callers} label={t("stat.callers")} />
      <Stat icon="Globe" value={counts.endpoints} label={t("stat.endpoints")} />
      <Stat icon="Clock" value={counts.crons} label={t("stat.crons")} />
    </div>
  );
}
