/* hooks/multi-agent.ts — React Query hooks for L07 Multi-Agent Review:
     GET  /pulls/:id/multi-agent          → the LATEST multi-agent run of this PR,
                                            as columns, finding groups and conflicts.
     GET  /pulls/:id/multi-agent/estimate → what each agent's next run is likely to
                                            cost, averaged from `agent_runs` alone.
     POST /pulls/:id/review  { agentIds } → start one, with a named set of agents.

   NOTHING here polls, and the grep that proves it is part of this feature's gates.
   `usePrRuns` and `usePrActiveRuns` poll because they are the PR page's own status
   source; a multi-agent column takes its live status from `useRunEvents(runIds)`
   (SSE, one EventSource per run), and this query is refetched ONCE, when those
   streams end. A poll beside a live stream is the thing the criterion for live
   columns forbids. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { MultiAgentRun, ReviewRunResponse, RunEstimate } from "@devdigest/shared";

/** The one place this query's key is spelled — read by the query and by whoever invalidates it. */
export const multiAgentKey = (prId: string | null | undefined) => ["multi-agent", prId];

/** Key of the per-agent estimate. Separate from the run: it survives a run being started. */
export const estimateKey = (prId: string | null | undefined) => ["multi-agent-estimate", prId];

/**
 * "This pull request has never been run through a set of agents" is the API's
 * 404 with the code `no_multi_agent_run`, and it is a SCREEN STATE, not an
 * outage: the results route answers it with the picker, not with an error.
 *
 * Exported so a component can tell the two 404s apart without importing
 * `ApiError` and re-deriving the endpoint's contract. A pull request that does
 * not exist answers 404 too, with its own code, and that one IS an error.
 */
export function isNoMultiAgentRun(error: unknown): boolean {
  // The CODE, not the status: the route distinguishes its two 404s that way on
  // purpose (`modules/multi-agent/routes.ts`), and a deleted pull request must
  // reach the error state rather than render an inviting empty picker.
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    error.code === "no_multi_agent_run"
  );
}

/**
 * The latest multi-agent run of a PR.
 *
 * `retry: false`, because the 404 above is an answer and retrying it three times
 * only delays the empty state. The error is NOT swallowed into `null` (the shape
 * `usePrBrief` uses): the results route has to distinguish "no run yet" from "the
 * engine is unreachable", and `isError` + `isNoMultiAgentRun(error)` says both.
 */
export function useMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: multiAgentKey(prId),
    queryFn: () => api.get<MultiAgentRun>(`/pulls/${prId}/multi-agent`),
    enabled: !!prId,
    retry: false,
  });
}

/**
 * One entry per agent in the workspace — the picker sums the ticked ones itself.
 *
 * `runs_sampled === 0` (and the two `null` averages that come with it) means "no
 * completed run to average", which the picker must SAY rather than render as a
 * zero or a dash.
 */
export function useRunEstimate(prId: string | null | undefined) {
  return useQuery({
    queryKey: estimateKey(prId),
    queryFn: () => api.get<RunEstimate[]>(`/pulls/${prId}/multi-agent/estimate`),
    enabled: !!prId,
  });
}

export interface StartMultiAgentRunInput {
  prId: string;
  agentIds: string[];
}

/**
 * Start a multi-agent run: one POST, one `multi_agent_runs` row, one `agent_runs`
 * row per named agent — all created before the response returns, which is why the
 * caller can subscribe to `res.runs` immediately.
 *
 * This is the `agentIds` form of the SAME endpoint `useRunReview` posts to. It is
 * a separate hook rather than a third field on that one because the two answer
 * different questions and invalidate different things — this one owns the
 * multi-agent read.
 */
export function useStartMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: StartMultiAgentRunInput) =>
      api.post<ReviewRunResponse>(`/pulls/${prId}/review`, { agentIds }),
    onSuccess: (_data, { prId }) => {
      // The run these three keys describe has just changed: a new parent row
      // (multi-agent), N new `agent_runs` rows (pr-runs / pr-active-runs) and the
      // reviews they will write.
      qc.invalidateQueries({ queryKey: multiAgentKey(prId) });
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
    },
  });
}
