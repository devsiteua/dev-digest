/* EvalDashboardView — the workspace's three metrics and the runs behind them.

   DESIGN PROVENANCE: DERIVED. The `skill-evals` artboard supplies the layout —
   three metric cards over a recent-runs table — but it is scoped to a single
   SKILL and a single agent's gold set, while this page is the whole workspace.
   Read it as borrowed vocabulary, not as a drawn screen.

   Two things the artboard carries that are NOT built, both `Out of scope`:
   the metric-trend line chart and the regression alert banner. `EvalDashboard`
   still ships `trend: []` and `alert: null`, so adding them later is a rendering
   change and not a contract change.

   One deliberate divergence from the artboard: its cards render
   `Math.round(value * 100)` with no branch for an empty denominator, which on a
   workspace where nothing has run yet prints a confident 100%. `MetricRow`
   renders `—` instead (AC-21). The empty state — no run has ever happened — is
   derived too, and it is exactly what a freshly seeded stack shows. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useEvalDashboard } from "../../../../lib/hooks/evals";
import { MetricRow } from "@/components/metric-row";
import { cellPercent } from "./helpers";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalDashboard();

  return (
    <AppShell
      crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}
    >
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>{t("dashboard.title")}</h1>
            <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
          </div>
          {data && (
            <div style={s.casesTotal}>
              {t("dashboard.casesTotal", { count: data.cases_total })}
            </div>
          )}
        </div>

        {isError ? (
          <ErrorState title={t("dashboard.title")} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <Skeleton height={120} />
        ) : (
          <>
            {/*
              Each card is handed its OWN denominator, never `traces_total`.
              They are different quantities: a set built only from dismissed
              findings asserts no `must_find` expectation, so recall's
              denominator is 0 while `traces_total` is the full size of the set.
              Guarding on the latter renders the vacuous 1 as a confident 100%,
              which is the one number this whole screen exists not to print.
            */}
            <div style={s.metrics}>
              <MetricRow
                label={t("metric.recall")}
                value={data.current.recall}
                denominator={data.current.recall_denominator}
                delta={data.delta.recall}
                color="var(--accent)"
              />
              <MetricRow
                label={t("metric.precision")}
                value={data.current.precision}
                denominator={data.current.precision_denominator}
                delta={data.delta.precision}
                color="var(--ok)"
              />
              <MetricRow
                label={t("metric.citationAccuracy")}
                value={data.current.citation_accuracy}
                denominator={data.current.citation_denominator}
                delta={data.delta.citation_accuracy}
                color="var(--warn)"
              />
            </div>

            <div style={s.sectionLabel}>{t("dashboard.recentRuns")}</div>
            {data.recent_runs.length === 0 ? (
              <div style={s.empty}>{t("dashboard.noRuns")}</div>
            ) : (
              <div style={s.table}>
                <div style={{ ...s.grid, ...s.head }}>
                  <div>{t("dashboard.table.ranAt")}</div>
                  <div>{t("dashboard.table.caseName")}</div>
                  <div>{t("dashboard.table.recall")}</div>
                  <div>{t("dashboard.table.precision")}</div>
                  <div>{t("dashboard.table.citation")}</div>
                  <div>{t("dashboard.table.result")}</div>
                  <div>{t("dashboard.table.cost")}</div>
                </div>
                {data.recent_runs.map((r) => (
                  <div key={r.id} style={s.grid} data-run-id={r.id}>
                    <span style={s.mono}>{new Date(r.ran_at).toLocaleString()}</span>
                    <span>{r.case_name}</span>
                    {/* Each cell gets the denominator that ratio was computed
                        over — recall's is the expectations it asserted, and a
                        must_not_flag case asserts none. */}
                    <span style={s.cell}>{cellPercent(r.recall, r.expected_count, r.status)}</span>
                    <span style={s.cell}>
                      {cellPercent(r.precision, r.reported_count, r.status)}
                    </span>
                    <span style={s.cell}>
                      {cellPercent(r.citation_accuracy, r.reported_count, r.status)}
                    </span>
                    <span>{t(`dashboard.${r.status === "passed" ? "pass" : r.status === "errored" ? "errored" : "fail"}`)}</span>
                    <span style={s.mono}>
                      {r.cost_usd == null ? "—" : `$${r.cost_usd.toFixed(4)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
