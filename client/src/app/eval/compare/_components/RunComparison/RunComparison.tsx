/* RunComparison — two eval runs side by side, and the cases that changed state.

   DESIGN PROVENANCE: FULLY DERIVED. No artboard anywhere in the design reference
   draws a side-by-side comparison of two runs — the only "Compare" in the whole
   prototype is a `localeCompare` in the diff viewer. This screen borrows the
   `skill-evals` artboard's metric-card and table vocabulary and invents the rest,
   so a later reader can tell it from a drawn screen.

   Two decisions the absence of an artboard forced, both of them about honesty
   rather than layout:

   1. **Every metric shows its own denominator on both sides.** Two runs over
      different set sizes reduced to one percentage difference is the exact
      failure this feature exists to remove one level up, and it is reachable the
      moment somebody adds a case between two runs.
   2. **The delta is `—`, not a number, when either side's denominator is 0.**
      The stored metric is a vacuous `1` there, and subtracting it would print a
      confident regression that never happened. */
"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Skeleton } from "@devdigest/ui";
import type { EvalRunBatch } from "@devdigest/shared";
import { AppShell } from "../../../../../components/app-shell";
import { useEvalComparison } from "../../../../../lib/hooks/evals";
import { MetricRow } from "@/components/metric-row";
import { changed, deltaOf, isIncomplete, type MetricPair } from "./helpers";
import { s } from "./styles";

export function RunComparison() {
  const t = useTranslations("eval");
  const search = useSearchParams();
  const a = search.get("a");
  const b = search.get("b");
  const { data, isLoading, isError, refetch } = useEvalComparison(a, b);

  const column = (batch: EvalRunBatch, title: string) => (
    <div style={s.column} data-batch={batch.id}>
      <div style={s.columnHead}>
        <span style={s.columnTitle}>{title}</span>
        <Badge color="var(--text-muted)">{t("compare.version", { version: batch.agent_version })}</Badge>
        {isIncomplete(batch) && (
          <span style={s.incomplete}>
            {t("compare.incomplete", { ran: batch.cases_ran, total: batch.cases_total })}
          </span>
        )}
      </div>
      <div style={s.metrics}>
        <MetricRow
          label={t("metric.recall")}
          value={batch.recall}
          denominator={batch.recall_denominator}
          numerator={Math.round((batch.recall ?? 0) * batch.recall_denominator)}
          color="var(--accent)"
        />
        <MetricRow
          label={t("metric.precision")}
          value={batch.precision}
          denominator={batch.precision_denominator}
          numerator={Math.round((batch.precision ?? 0) * batch.precision_denominator)}
          color="var(--ok)"
        />
        <MetricRow
          label={t("metric.citationAccuracy")}
          value={batch.citation_accuracy}
          denominator={batch.citation_denominator}
          numerator={Math.round((batch.citation_accuracy ?? 0) * batch.citation_denominator)}
          color="var(--warn)"
        />
      </div>
    </div>
  );

  const pairs = (): MetricPair[] =>
    !data
      ? []
      : [
          {
            label: t("metric.recall"),
            before: data.a.recall,
            beforeDenominator: data.a.recall_denominator,
            after: data.b.recall,
            afterDenominator: data.b.recall_denominator,
          },
          {
            label: t("metric.precision"),
            before: data.a.precision,
            beforeDenominator: data.a.precision_denominator,
            after: data.b.precision,
            afterDenominator: data.b.precision_denominator,
          },
          {
            label: t("metric.citationAccuracy"),
            before: data.a.citation_accuracy,
            beforeDenominator: data.a.citation_denominator,
            after: data.b.citation_accuracy,
            afterDenominator: data.b.citation_denominator,
          },
        ];

  return (
    <AppShell
      crumb={[{ label: t("page.crumbEvalDashboard") }, { label: t("page.crumbCompare") }]}
    >
      <div style={s.page}>
        <h1 style={s.h1}>{t("compare.title")}</h1>
        <p style={s.subtitle}>{t("compare.subtitle")}</p>

        {!a || !b ? (
          <div style={s.muted}>{t("compare.missing")}</div>
        ) : isError ? (
          <ErrorState title={t("compare.title")} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <Skeleton height={160} />
        ) : (
          <>
            <div style={s.columns}>
              {column(data.a, t("compare.before"))}
              {column(data.b, t("compare.after"))}
            </div>

            <div style={s.sectionLabel}>{t("compare.delta")}</div>
            <div>
              {pairs().map((p) => {
                const d = deltaOf(p);
                return (
                  <div key={p.label} style={s.deltaRow} data-delta={p.label}>
                    <span>{p.label}</span>
                    <span style={s.delta(d)}>
                      {d === null
                        ? t("metric.empty")
                        : `${d > 0 ? "+" : ""}${Math.round(d * 100)}`}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={s.sectionLabel}>{t("compare.casesHeading")}</div>
            {data.cases.map((c) => (
              <div key={c.case_id} style={s.caseRow(changed(c))} data-case-id={c.case_id}>
                <span>{c.name}</span>
                <span style={s.outcome(c.before)}>{t(`compare.outcome.${c.before}`)}</span>
                <span style={s.arrow}>→</span>
                <span style={s.outcome(c.after)}>{t(`compare.outcome.${c.after}`)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </AppShell>
  );
}
