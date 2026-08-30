/* EvalsTab — an agent's frozen case set, and the runs over it.

   DESIGN PROVENANCE. The `agent-evals` artboard is a bare case list: a status
   icon, a mono name, a result line, an expectation badge and three icon buttons
   (Run · Edit · Delete). Two of those three are `Out of scope` for this spec —
   there is no per-case run and no manual case editor — so only Delete is built,
   and the run-history section below the list is DERIVED, borrowing the
   `skill-evals` artboard's metric vocabulary where an analogue exists.

   A case is created from a decided finding on a pull request, never here, which
   is why there is no "New eval case" control despite the artboard drawing one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge, Button, EmptyState, Icon, IconBtn } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useDeleteEvalCase,
  useEvalCases,
  useEvalRuns,
  useStartEvalRun,
} from "@/lib/hooks/evals";
import { MetricRow } from "./_components/MetricRow";
import { expectationOf, isIncomplete, previousBatch, sourceLabel } from "./helpers";
import { s } from "./styles";

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const cases = useEvalCases(agent.id);
  const runs = useEvalRuns(agent.id);
  const startRun = useStartEvalRun(agent.id);
  const removeCase = useDeleteEvalCase(agent.id);

  const list = cases.data ?? [];
  const batches = runs.data ?? [];
  const inFlight = batches.some((b) => b.status === "running");

  /**
   * AC-12 — "Run all" is disabled on an empty set, WITH the reason.
   *
   * Derived here from the two facts that decide it, so the reason and the
   * disabled state cannot disagree: a run over no cases would open a batch whose
   * every denominator is 0 and whose every metric is therefore the vacuous 1.
   */
  const runDisabledReason =
    list.length === 0
      ? t("evalsTab.runAllEmpty")
      : inFlight
        ? t("evalsTab.runAllInFlight")
        : undefined;

  return (
    <div style={s.wrap}>
      <div style={s.headRow}>
        <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
        <Badge color="var(--text-muted)">
          {t("evalsTab.casesCount", { count: list.length })}
        </Badge>
        <div style={s.headActions}>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            disabled={!!runDisabledReason || startRun.isPending}
            title={runDisabledReason}
            onClick={() => startRun.mutate()}
          >
            {startRun.isPending ? t("evalsTab.starting") : t("evalsTab.runAll")}
          </Button>
        </div>
      </div>

      {cases.isLoading ? (
        <div style={s.muted}>{t("evalsTab.loadingCases")}</div>
      ) : list.length === 0 ? (
        <EmptyState icon="FlaskConical" title={t("evalsTab.casesHeading")} body={t("evalsTab.emptyCases")} />
      ) : (
        list.map((c) => {
          const expectation = expectationOf(c);
          return (
            <div key={c.id} style={s.caseRow} data-case-id={c.id}>
              <Icon.FlaskConical size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <div style={s.caseMain}>
                <div style={s.caseName}>{c.name}</div>
                {expectation && <div style={s.caseSource}>{sourceLabel(expectation)}</div>}
              </div>
              {expectation && (
                <Badge
                  color={expectation.kind === "must_find" ? "var(--ok)" : "var(--text-muted)"}
                >
                  {expectation.kind === "must_find"
                    ? t("evalsTab.expectationMustFind")
                    : t("evalsTab.expectationMustNotFlag")}
                </Badge>
              )}
              <IconBtn
                icon="Trash"
                label={`${t("evalsTab.delete")} ${c.name}`}
                size={26}
                danger
                onClick={() => removeCase.mutate(c.id)}
              />
            </div>
          );
        })
      )}

      <div style={s.section}>
        <div style={s.headRow}>
          <h2 style={s.h2}>{t("evalsTab.historyHeading")}</h2>
        </div>
        {batches.length === 0 ? (
          <div style={s.muted}>{t("evalsTab.emptyHistory")}</div>
        ) : (
          batches.map((b, i) => {
            const previous = previousBatch(batches, i);
            return (
              <div key={b.id} style={s.runRow} data-batch-id={b.id}>
                <div style={s.runHead}>
                  <span>{new Date(b.started_at).toLocaleString()}</span>
                  <Badge color="var(--text-muted)">v{b.agent_version}</Badge>
                  <Badge color="var(--text-muted)">{t(`evalsTab.status.${b.status}`)}</Badge>
                  {isIncomplete(b) && (
                    <span style={s.incomplete}>
                      {t("evalsTab.incomplete", { ran: b.cases_ran, total: b.cases_total })}
                    </span>
                  )}
                </div>
                <div style={s.runMetrics}>
                  <MetricRow
                    label={t("metric.recall")}
                    value={b.recall}
                    denominator={b.recall_denominator}
                    color="var(--accent)"
                  />
                  <MetricRow
                    label={t("metric.precision")}
                    value={b.precision}
                    denominator={b.precision_denominator}
                    color="var(--ok)"
                  />
                  <MetricRow
                    label={t("metric.citationAccuracy")}
                    value={b.citation_accuracy}
                    denominator={b.citation_denominator}
                    color="var(--warn)"
                  />
                </div>
                {/* Absent rather than disabled on the oldest run: there is
                    nothing to compare it against, and a control that can never
                    work is worse than no control. */}
                {previous && (
                  <div style={s.compareRow}>
                    <Link href={`/eval/compare?a=${previous.id}&b=${b.id}`} style={s.compareLink}>
                      <Icon.GitMerge size={13} />
                      {t("evalsTab.compare")}
                    </Link>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
