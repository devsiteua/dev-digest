/* TabsDetailView — the `ma-tabs` artboard: one tab per agent, and that agent's
   findings as full detail cards.

   The SAME data the columns render, from the same fetched object — switching
   modes is a re-render, never a second request. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, MonoLink, Tabs, type TabDef } from "@devdigest/ui";
import type { AgentColumn, FindingGroup } from "@devdigest/shared";
import { formatCost, formatDurationMs, NO_VALUE } from "@/lib/format";
import { FindingDetailCard } from "./_components/FindingDetailCard";
import { sharedGroupFor } from "./helpers";
import { s } from "./styles";

export interface TabsDetailViewProps {
  columns: AgentColumn[];
  groups: FindingGroup[];
  prId: string | null;
  onOpenTrace: (runId: string) => void;
}

export function TabsDetailView({ columns, groups, prId, onOpenTrace }: TabsDetailViewProps) {
  const t = useTranslations("multiAgent");
  const tRuns = useTranslations("runs");
  const [active, setActive] = React.useState<string | null>(null);

  // The selected tab follows the data when it has to: an id that is no longer in
  // the list (a refetch that dropped a column) falls back to the first one
  // rather than rendering nothing.
  const current = columns.find((c) => c.run_id === active) ?? columns[0];
  if (!current) return null;

  const tabs: TabDef[] = columns.map((c) => ({
    key: c.run_id,
    label: c.agent_name || t("column.noAgentName"),
    count: c.findings.length,
  }));

  return (
    <div style={s.wrap}>
      <Tabs tabs={tabs} value={current.run_id} onChange={setActive} pad="0" />

      <div style={s.panel}>
        <div style={s.summary}>
          {current.score != null && <CircularScore score={current.score} size={44} />}
          <div style={s.summaryMain}>
            <div style={s.agentName}>{current.agent_name || t("column.noAgentName")}</div>
            <p style={s.summaryText}>{current.summary ?? tRuns("tabs.noSummary")}</p>
          </div>
          <div style={s.summaryRight}>
            <MonoLink onClick={() => onOpenTrace(current.run_id)}>{tRuns("viewTrace")}</MonoLink>
            <span className="mono tnum" style={s.meta}>
              {formatDurationMs(current.duration_ms) ?? NO_VALUE} · {formatCost(current.cost_usd)}
            </span>
          </div>
        </div>

        {current.status === "failed" && current.error && (
          <div style={s.error}>{current.error}</div>
        )}

        {current.findings.length === 0 ? (
          <div style={s.empty}>{t("finding.noFindings")}</div>
        ) : (
          <div style={s.list}>
            {current.findings.map((f, i) => (
              <FindingDetailCard
                key={f.id}
                finding={f}
                group={sharedGroupFor(groups, f.id)}
                prId={prId}
                defaultExpanded={i === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
