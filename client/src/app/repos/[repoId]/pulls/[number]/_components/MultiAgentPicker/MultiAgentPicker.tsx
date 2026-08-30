/* MultiAgentPicker — "Configure run": pick the agents, see what the selection is
   likely to cost, start them all in one action.

   This screen has NO artboard. The design manifest lists three for
   `multi-agent-review` (`ma-cols`, `ma-tabs`, `e-ma`) and none of them is a
   picker, so every decision here is derived from the spec rather than copied:
   one component with TWO mount points (inline on the PR's Overview tab with that
   PR already fixed, and as the landing state of the Multi-Agent Review route with
   a PR control handed in), because a second picker would be the same checkboxes,
   the same estimate and the same button written twice. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { usePulls } from "@/lib/hooks/core";
import { useRunEstimate, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { formatCost } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { AGENTS_HREF, resultsHref } from "./constants";
import { formatDurationMs, summariseEstimate } from "./helpers";
import { s } from "./styles";

export interface MultiAgentPickerProps {
  /** The pull request to run on, or `null` while none is chosen yet. */
  prId: string | null;
  /**
   * The control that chooses the pull request, rendered by the parent.
   *
   * A slot rather than a prop pair, because the two mount points differ ONLY
   * here: the PR page has its PR from the URL and passes nothing, the
   * Multi-Agent Review route passes a select over its repo's pulls.
   */
  prControl?: React.ReactNode;
}

export function MultiAgentPicker({ prId, prControl }: MultiAgentPickerProps) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { repoId } = useParams<{ repoId: string }>();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  // The route is keyed by PR number, every PR API by the row's uuid — and this
  // component is mounted on a route that has only one of the two. Resolving
  // through the (already cached) pulls list is what lets both mounts pass `prId`
  // alone, which is the whole point of one component with two mount points.
  const { data: pulls } = usePulls(repoId);
  const { data: estimates, isLoading: estimatesLoading } = useRunEstimate(prId);
  const start = useStartMultiAgentRun();

  /**
   * Nothing is ticked to begin with.
   *
   * A run costs money, so the reader says which agents rather than un-saying
   * which ones they did not mean. It also makes the "zero selected" state — a
   * disabled button that sends no request — the state the screen opens in.
   */
  const [selected, setSelected] = React.useState<string[]>([]);
  const toggle = (agentId: string) =>
    setSelected((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );

  const all = agents ?? [];
  const hasEnabled = all.some((a) => a.enabled);
  const prNumber = pulls?.find((p) => p.id === prId)?.number ?? null;
  const estimate = summariseEstimate(estimates, selected);
  const canRun = selected.length > 0 && prId != null && !start.isPending;

  const startRun = async () => {
    // The guard is not the `disabled` attribute repeated: `fireEvent` will click
    // a disabled button, and so will a keyboard in some browsers. "Sends no
    // request with nothing selected" is a rule about this function.
    if (!canRun || prId == null) return;
    const res = await start.mutateAsync({ prId, agentIds: selected });
    if (prNumber != null && res.runs.length > 0) router.push(resultsHref(repoId, prNumber));
  };

  if (agentsLoading) {
    return (
      <div style={s.card}>
        <div style={s.body}>
          <Skeleton height={18} width={200} />
          <Skeleton height={90} />
        </div>
      </div>
    );
  }

  // No enabled agent means nothing can be run at all — the empty state with a way
  // out, never a grid of empty columns.
  if (!hasEnabled) {
    return (
      <div style={s.card}>
        <EmptyState
          icon="Cpu"
          title={t("empty.noAgents.title")}
          body={t("empty.noAgents.body")}
          cta={t("empty.noAgents.cta")}
          onCta={() => router.push(AGENTS_HREF)}
        />
      </div>
    );
  }

  const totalLine = (() => {
    if (selected.length === 0 || estimate.durationMs == null) return t("estimate.totalNoData");
    const duration = formatDurationMs(estimate.durationMs) ?? "";
    if (estimate.costUsd == null) return t("estimate.totalNoCost", { duration });
    return t("estimate.total", { duration, cost: formatCost(estimate.costUsd) });
  })();

  return (
    <div style={s.card}>
      <div style={s.head}>
        <Icon.Cpu size={15} style={{ color: "var(--accent)" }} />
        <span style={s.headTitle}>{t("configure.title")}</span>
      </div>

      <div style={s.body}>
        {prControl && (
          <div style={s.prRow}>
            <span style={s.label}>{t("configure.prLabel")}</span>
            {prControl}
          </div>
        )}

        <div>
          <SectionLabel icon="Cpu">{t("configure.agents")}</SectionLabel>
          <div style={s.agentList}>
            {all.map((agent) => {
              const est = estimates?.find((e) => e.agent_id === agent.id);
              return (
                <div key={agent.id} style={s.agentRow}>
                  <div style={s.agentMain}>
                    <Checkbox
                      checked={selected.includes(agent.id)}
                      onChange={() => toggle(agent.id)}
                      label={
                        <span style={{ color: "var(--text-primary)", fontSize: 13 }}>
                          {agent.name}
                        </span>
                      }
                    />
                    <span className="mono" style={s.agentMeta}>
                      {agent.model}
                      {agent.enabled ? "" : ` · ${t("configure.disabled")}`}
                    </span>
                  </div>
                  <span style={s.estimate}>
                    {prId == null
                      ? null
                      : estimatesLoading
                        ? t("estimate.loading")
                        : est && est.runs_sampled > 0
                          ? est.avg_cost_usd == null
                            ? t("estimate.agentNoCost", {
                                duration: formatDurationMs(est.avg_duration_ms) ?? "",
                              })
                            : t("estimate.agent", {
                                duration: formatDurationMs(est.avg_duration_ms) ?? "",
                                cost: formatCost(est.avg_cost_usd),
                              })
                          : // Never a zero and never a dash: "no completed run to
                            // average" is a different fact from "it costs nothing".
                            t("estimate.noData")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {start.isError && (
        <div style={s.error}>
          {t("configure.failed", {
            message:
              start.error instanceof ApiError ? start.error.message : String(start.error),
          })}
        </div>
      )}

      <div style={s.footer}>
        <span style={s.total}>{totalLine}</span>
        <Button
          kind="primary"
          icon="Sparkles"
          disabled={!canRun}
          loading={start.isPending}
          onClick={() => void startRun()}
        >
          {start.isPending
            ? t("configure.starting")
            : t("configure.run", { count: selected.length })}
        </Button>
      </div>
    </div>
  );
}
