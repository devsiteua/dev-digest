"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, MonoLink, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useCiRuns } from "../../../../lib/hooks/ci";
import { formatCost, NO_VALUE } from "../../../../lib/format";
import { COLUMN_KEYS, RUN_STATUS } from "./constants";
import { formatDuration, formatTimestamp, runPrUrl } from "./helpers";
import { s } from "./styles";

/**
 * Every review an agent ran inside somebody else's CI, newest first.
 *
 * A capped list and nothing else: the design's filter chips, auto-refresh and
 * "Trace" link are out of scope for this pass — the last one because a CI run
 * has no trace on this machine, and a link that goes nowhere is worse than no
 * link. The repository column is not in the design either and is added
 * deliberately: a list spanning repositories cannot be read without one.
 */
export function CiRunsView() {
  const t = useTranslations("ci");
  const router = useRouter();
  const { data: runs, isLoading, isError, refetch } = useCiRuns();

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
        </div>

        {isLoading && (
          <div style={s.loading}>
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={40} />
          </div>
        )}

        {isError && <ErrorState body={t("runs.loadError")} onRetry={() => void refetch()} />}

        {!isLoading && !isError && (runs ?? []).length === 0 && (
          <EmptyState
            icon="Workflow"
            title={t("runs.emptyTitle")}
            body={t("runs.emptyBody")}
            cta={t("runs.emptyCta")}
            onCta={() => router.push("/agents")}
          />
        )}

        {!isLoading && !isError && (runs ?? []).length > 0 && (
          <div style={s.table}>
            <div style={s.headRow}>
              {COLUMN_KEYS.map((key) => (
                <div key={key}>{t(`runs.table.${key}`)}</div>
              ))}
              <div />
            </div>
            {(runs ?? []).map((run, i) => {
              const status = run.status ? RUN_STATUS[run.status] : undefined;
              const prUrl = runPrUrl(run);
              const duration = formatDuration(run.duration_s);
              return (
                <div key={run.id} style={s.row(i === (runs ?? []).length - 1)}>
                  <span className="mono" style={s.time}>
                    {formatTimestamp(run.ran_at)}
                  </span>
                  <span className="mono" style={s.repo}>
                    {run.repo ?? NO_VALUE}
                  </span>
                  {run.pr_number == null ? (
                    <span style={s.num}>{NO_VALUE}</span>
                  ) : prUrl ? (
                    <MonoLink href={prUrl}>{`#${run.pr_number}`}</MonoLink>
                  ) : (
                    <span className="mono" style={s.pr}>{`#${run.pr_number}`}</span>
                  )}
                  <span style={s.agent}>
                    <Icon.Cpu size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span style={s.agentName}>{run.agent ?? NO_VALUE}</span>
                  </span>
                  <span>
                    {run.source ? (
                      <Badge color="var(--text-secondary)" icon="Workflow">
                        {run.source}
                      </Badge>
                    ) : (
                      <span style={s.num}>{NO_VALUE}</span>
                    )}
                  </span>
                  <span className="tnum" style={s.num}>
                    {duration ?? NO_VALUE}
                  </span>
                  {/* A findings count of 0 and an unknown one both read as a
                      dash here: the row shows the total the runner reported,
                      and "nothing found" is already said by the status. */}
                  <span className="tnum" style={s.num}>
                    {run.findings_count ? run.findings_count : NO_VALUE}
                  </span>
                  {/* `formatCost` keeps null (unpriced) apart from 0 (a free
                      model): the first is a dash, the second is "$0.00". */}
                  <span className="mono tnum" style={s.num}>
                    {formatCost(run.cost_usd)}
                  </span>
                  <span>
                    {status ? (
                      <Badge color={status.color} bg={status.bg} dot>
                        {t(`runs.status.${status.labelKey}`)}
                      </Badge>
                    ) : (
                      <span style={s.num}>{run.status ?? NO_VALUE}</span>
                    )}
                  </span>
                  <span>
                    {run.github_url ? (
                      <MonoLink href={run.github_url}>{t("runs.view")}</MonoLink>
                    ) : (
                      <span style={s.num}>{NO_VALUE}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
