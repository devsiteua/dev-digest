/* Multi-Agent Review — /repos/:repoId/multi-agent?pr=<number>.

   The container: it resolves the PR, fetches the latest multi-agent run ONCE and
   hands the same object to whichever of the two views is selected. Switching
   modes re-renders two presentational children over one state and issues no
   second request.

   Why the route lives here and not under the pull request: `activeKeyFor` already
   maps any path containing `/multi-agent` to the nav key `multi-agent`, `nav.ts`
   can only template `:repoId`, and a repo-scoped route gives the landing state a
   repo whose pulls it can list. The cost is one cross-route import —
   `RunTraceDrawer` — which is reused rather than promoted: moving a shipped
   six-component drawer that the PR page depends on is a bigger change than the
   feature that wants it.

   `LiveLogStream` comes back through that same drawer, on its Live log tab.
   There is deliberately no second log panel on this page: a panel beside a
   `View trace` that opens the same stream would render it twice. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Chip, EmptyState, ErrorState, SelectInput, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { usePulls } from "@/lib/hooks/core";
import { usePrReviews, useRunEvents } from "@/lib/hooks/reviews";
import { isNoMultiAgentRun, useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { formatCost } from "@/lib/format";
import { MultiAgentPicker } from "../pulls/[number]/_components/MultiAgentPicker";
import RunTraceDrawer from "../pulls/[number]/_components/RunTraceDrawer";
import { ColumnsView } from "./_components/ColumnsView";
import { DisagreeBlock } from "./_components/DisagreeBlock";
import { TabsDetailView } from "./_components/TabsDetailView";
import { formatDurationMs, liveStatusByRun, runningRunIds, withLiveStatus } from "./helpers";

type Mode = "columns" | "tabs";

export default function MultiAgentReviewPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const t = useTranslations("multiAgent");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const prParam = search.get("pr");
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(prParam))?.id ?? null;

  const run = useMultiAgentRun(prId);
  const { data: reviews } = usePrReviews(prId);

  /**
   * The mode, and the run whose trace is open — both page state.
   *
   * The trace lives in React state rather than in the URL because it is the one
   * thing on this page a reload does not need to restore: `?pr` already names
   * everything the screen shows, and keeping the drawer local is what makes
   * "the second column's View trace hands the drawer the second run's id"
   * observable from the page rather than from a mocked router.
   */
  const [mode, setMode] = React.useState<Mode>("columns");
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);
  /** Set by `Start New Review`: show the picker again over a PR that has a run. */
  const [configuring, setConfiguring] = React.useState(false);

  const serverColumns = run.data?.columns ?? [];
  const liveIds = runningRunIds(serverColumns);
  const { events, running: streaming } = useRunEvents(liveIds);
  const columns = withLiveStatus(serverColumns, liveStatusByRun(events));

  // ONE refetch, when the streams end — never a poll. `run.refetch` is stable
  // across renders, so this fires on the transition and not on every event.
  const wasStreaming = React.useRef(false);
  const refetch = run.refetch;
  React.useEffect(() => {
    if (streaming) wasStreaming.current = true;
    if (!streaming && wasStreaming.current) {
      wasStreaming.current = false;
      void refetch();
    }
  }, [streaming, refetch]);

  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("crumb") },
    ...(prParam ? [{ label: `#${prParam}`, mono: true }] : []),
  ];

  const setPr = (number: string) => {
    setConfiguring(false);
    router.replace(number ? `/repos/${repoId}/multi-agent?pr=${number}` : `/repos/${repoId}/multi-agent`);
  };

  const prControl = (
    <SelectInput
      value={prParam ?? ""}
      onChange={setPr}
      options={[
        { value: "", label: t("configure.prNone") },
        ...(pulls ?? []).map((p) => ({
          value: String(p.number),
          label: t("configure.prOption", { number: p.number, title: p.title }),
        })),
      ]}
    />
  );

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const header = (
    <div style={{ padding: "18px 28px 4px", display: "flex", alignItems: "center", gap: 12 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("title")}</h1>
      <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("subtitle")}</span>
    </div>
  );

  if (pullsLoading || (prId != null && run.isLoading)) {
    return (
      <AppShell crumb={crumb}>
        {header}
        <div style={{ padding: "20px 28px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height={18} width={320} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  // A pull request that has never been run through a set answers 404 with its own
  // code, and that is a screen state: the picker, over that PR. Anything else is
  // a real failure and says so.
  if (run.isError && !isNoMultiAgentRun(run.error)) {
    return (
      <AppShell crumb={crumb}>
        {header}
        <div style={{ padding: "20px 28px 40px" }}>
          <ErrorState
            fullScreen
            title={t("error.title")}
            body={run.error instanceof Error ? run.error.message : undefined}
            onRetry={() => void run.refetch()}
          />
        </div>
      </AppShell>
    );
  }

  const hasRun = run.data != null;
  const showPicker = !hasRun || configuring;

  if (showPicker) {
    const noPulls = (pulls ?? []).length === 0;
    return (
      <AppShell crumb={crumb}>
        {header}
        <div
          style={{
            padding: "20px 28px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            maxWidth: 760,
          }}
        >
          {noPulls ? (
            <EmptyState icon="GitPullRequest" title={t("empty.noPulls.title")} body={t("empty.noPulls.body")} />
          ) : (
            <>
              {prId == null ? (
                <EmptyState icon="GitPullRequest" title={t("empty.noPr.title")} body={t("empty.noPr.body")} />
              ) : (
                !configuring && (
                  <EmptyState icon="Cpu" title={t("empty.noRun.title")} body={t("empty.noRun.body")} />
                )
              )}
              <MultiAgentPicker
                prId={prId}
                prControl={prControl}
                onStarted={() => setConfiguring(false)}
              />
            </>
          )}
        </div>
      </AppShell>
    );
  }

  const data = run.data;
  if (!data) return null;
  const traceColumn = columns.find((c) => c.run_id === traceRunId);

  return (
    <AppShell crumb={crumb}>
      {header}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 28px",
          borderBottom: "1px solid var(--border)",
          fontSize: 12.5,
          color: "var(--text-secondary)",
        }}
      >
        <span>
          {t("meta", {
            count: data.agent_count,
            duration: formatDurationMs(data.total_duration_ms) ?? "",
            cost: formatCost(data.total_cost_usd),
          })}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
          <Chip active={mode === "columns"} onClick={() => setMode("columns")}>
            {t("mode.columns")}
          </Chip>
          <Chip active={mode === "tabs"} onClick={() => setMode("tabs")}>
            {t("mode.tabs")}
          </Chip>
          {/* Re-opens the picker. Never an auto-start: coming back to this page
              shows the LAST run, and starting another is a decision. */}
          <Chip icon="Sparkles" onClick={() => setConfiguring(true)}>
            {t("startNew")}
          </Chip>
        </span>
      </div>

      <div style={{ padding: "20px 28px 40px" }}>
        {mode === "columns" ? (
          <ColumnsView columns={columns} ranAt={data.ran_at} onOpenTrace={setTraceRunId} />
        ) : (
          <TabsDetailView
            columns={columns}
            groups={data.groups}
            prId={prId}
            onOpenTrace={setTraceRunId}
          />
        )}

        <DisagreeBlock
          groups={data.groups}
          conflicts={data.conflicts}
          agentsConsidered={data.agents_considered}
          agentCount={data.agent_count}
        />
      </div>

      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          agentName={traceColumn?.agent_name ?? null}
          prNumber={data.pr_number ?? null}
          findings={reviews?.find((r) => r.run_id === traceRunId)?.findings ?? []}
          running={traceColumn?.status === "running"}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </AppShell>
  );
}
