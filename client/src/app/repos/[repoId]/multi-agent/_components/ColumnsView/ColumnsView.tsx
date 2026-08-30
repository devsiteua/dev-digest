/* ColumnsView — the `ma-cols` artboard: one column per agent, side by side.

   Two things the artboard does not have, both decided in the spec's § Design
   analysis rather than invented here:
     - a RUNNING column shows the elapsed time and its status chip only. Score,
       duration and cost are null by construction while a run is in flight, and
       the detail a spinner would stand in for is one click away in `View trace`.
     - a FAILED column carries the reason from `agent_runs.error`, and its
       neighbours still render their findings — isolating one agent's failure is
       the headline requirement of this screen.

   Cost is formatted by the product's null-vs-zero rule (`lib/format`), never as
   `$0.00`: the mock has no unpriced model and the product does. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, CircularScore, Icon, MonoLink, SEV, type Severity } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { formatCost, NO_VALUE } from "@/lib/format";
import { elapsedSeconds, formatDurationMs } from "../../helpers";
import { STATUS_TONE } from "./constants";
import { s } from "./styles";

export interface ColumnsViewProps {
  columns: AgentColumn[];
  /** When the parent run started — the only true number a running column has. */
  ranAt: string;
  onOpenTrace: (runId: string) => void;
}

export function ColumnsView({ columns, ranAt, onOpenTrace }: ColumnsViewProps) {
  const t = useTranslations("multiAgent");
  const tRuns = useTranslations("runs");

  return (
    <div style={s.grid(columns.length)}>
      {columns.map((col) => {
        const tone = STATUS_TONE[col.status];
        const running = col.status === "running";
        return (
          <div key={col.run_id} style={s.column}>
            <div style={s.head}>
              <div style={s.headTop}>
                <div style={s.headText}>
                  <div style={s.agentName}>
                    {col.agent_name || t("column.noAgentName")}
                  </div>
                  <div className="mono tnum" style={s.agentMeta}>
                    {[col.provider, col.model].filter(Boolean).join(" · ") || NO_VALUE}
                  </div>
                </div>
                {/* Score, duration and cost only once the run is terminal. */}
                {!running && col.score != null && <CircularScore score={col.score} size={32} stroke={3.5} />}
              </div>
              <div style={s.headBottom}>
                <Badge color={tone.color} bg={tone.bg}>
                  {t(`column.status.${col.status}`)}
                </Badge>
                <span className="mono tnum" style={s.agentMeta}>
                  {running
                    ? t("column.elapsed", { seconds: elapsedSeconds(ranAt) })
                    : `${formatDurationMs(col.duration_ms) ?? NO_VALUE} · ${formatCost(col.cost_usd)}`}
                </span>
              </div>
            </div>

            <div style={s.body}>
              {col.status === "failed" && col.error && <div style={s.error}>{col.error}</div>}
              {col.findings.map((f) => {
                const sev = SEV[f.severity as Severity] ?? SEV.INFO;
                const SevIcon = Icon[sev.icon];
                return (
                  <div key={f.id} style={s.finding(sev.c)}>
                    <div style={s.findingTitle}>
                      <SevIcon size={12} style={{ color: sev.c, flexShrink: 0 }} />
                      <span>{f.title}</span>
                    </div>
                    <div className="mono" style={s.findingWhere}>
                      {f.file}:{f.start_line}
                    </div>
                  </div>
                );
              })}
              {!running && col.findings.length === 0 && col.status !== "failed" && (
                <span style={s.muted}>{tRuns("column.noFindings")}</span>
              )}
            </div>

            <div style={s.footer}>
              <MonoLink onClick={() => onOpenTrace(col.run_id)}>{tRuns("viewTrace")}</MonoLink>
              <span style={s.muted}>
                {tRuns("column.findingsCount", { count: col.findings.length })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
