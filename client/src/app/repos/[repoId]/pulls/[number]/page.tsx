/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import { BlastTab } from "./_components/BlastTab";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { usePullDetail, usePulls } from "../../../../../lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { usePrReviews, useCancelRun, usePrActiveRuns, usePrRuns, useDeleteRun } from "../../../../../lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "../../../../../lib/repo-context";
import { ApiError } from "../../../../../lib/api";
import { githubPrUrl } from "../../../../../lib/github-urls";
import { severityCounts } from "@/lib/severity";
import { latestReviewFindings } from "@/lib/findings";
import { smartDiffKey } from "@/lib/hooks/smart-diff";
import type { FindingRecord } from "@devdigest/shared";

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  // Set by a severity badge in the Smart Diff; read by the Findings tab, which
  // opens the run holding that finding and expands its card. Surviving in the
  // URL is the point — a reload lands on the same finding.
  const focusFindingId = search.get("findingId");
  // Set by a review-focus row in the PR brief; read by the Files tab, which
  // expands that file and jumps to the line. In the URL for the same reason
  // `findingId` is: a reload has to land on the same place, and the Files tab is
  // unmounted while another tab is active, so nothing below can hold it.
  const focusFile = search.get("file");
  // `line` is 1-based, so a non-numeric or zero value is not a line — it is
  // someone editing the URL. Parsed here rather than in the tab, because the
  // page is what owns the URL and the tab should receive a number or nothing.
  const lineParam = search.get("line");
  const focusLine = lineParam != null && /^[1-9]\d*$/.test(lineParam) ? Number(lineParam) : null;
  /**
   * Write several query params in ONE navigation.
   *
   * Two `setParam` calls in the same tick both read the same `search`, so the
   * second overwrites the first's URL and its param is lost. Opening a finding
   * moves `tab` and `findingId` together, so it has to be one call.
   */
  const setParams = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(patch)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setParam = (key: string, val: string | null) => setParams({ [key]: val });
  // Changing tab by hand drops the finding: it describes a card the reader has
  // just navigated away from, and leaving it would re-open that card the next
  // time they come back to Findings for an unrelated reason.
  //
  // `file` and `line` go with it, for exactly that reason: they describe a place
  // in the Files tab the reader has just left, and a stale pair would re-focus
  // it the next time they open Files for something else.
  const setTab = (t: string) => setParams({ tab: t, findingId: null, file: null, line: null });
  const openFinding = (findingId: string) => setParams({ tab: "findings", findingId });
  /**
   * Open a file in the Files tab, from a review-focus row in the PR brief.
   *
   * ONE `setParams` call, never two: two calls in the same tick both read the
   * same `search`, and the second overwrites the first — the same reason
   * `openFinding` above moves `tab` and `findingId` together.
   *
   * `line` is dropped rather than written as "null" when there is none, so the
   * URL never carries a line that does not exist.
   */
  const openFile = (path: string, line: number | null) =>
    setParams({ tab: "diff", file: path, line: line == null ? null : String(line) });

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  const allFindings: FindingRecord[] = React.useMemo(
    () => runs.flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;
  // Header scoreboard. Tallied over the same set as `findingsCount`, so the two
  // never disagree; the PR *list* counts the latest review only, on purpose.
  const severity = React.useMemo(() => severityCounts(allFindings), [allFindings]);
  // The Files tab badges the LATEST review only — the same set the PR list
  // counts — while the header above counts every finding on the PR. Two rules,
  // both deliberate (root `INSIGHTS.md`, 2026-08-02); this is the list's one.
  const latestFindings = React.useMemo(
    () => (reviews ? latestReviewFindings(reviews) : null),
    [reviews],
  );

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        severity={severity}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && (
          <OverviewTab prId={prId} prBody={pr.body} onOpenFile={openFile} />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            focusFindingId={focusFindingId}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              refetchReviews();
              // The smart diff orders files by how many findings they carry, so
              // a finished run changes the ORDER as well as the badges. The
              // badges themselves come from the reviews refetched above.
              if (prId) qc.invalidateQueries({ queryKey: smartDiffKey(prId) });
            }}
          />
        )}

        {tab === "blast" && (
          <BlastTab
            prId={prId}
            repoId={repoId}
            repoFullName={repoFullName}
            // The map is only asked for once the detail it describes has
            // resolved: `GET /pulls/:id` rewrites `pr_files` in a transaction.
            ready={!!pr}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            findings={latestFindings}
            onOpenFinding={openFinding}
            focusFile={focusFile}
            focusLine={focusLine}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
