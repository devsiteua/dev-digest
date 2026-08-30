/* hooks/evals.ts — React Query hooks for the L06 eval pipeline:
     POST   /eval-cases              → freeze one decided finding into a case
     GET    /agents/:id/eval-cases   → that agent's case set
     DELETE /eval-cases/:id          → remove a case (its runs cascade)
     POST   /agents/:id/eval-runs    → start a batch; 202, NOT the results
     GET    /agents/:id/eval-runs    → that agent's run history, newest first
     GET    /eval-runs/:id           → one batch with its per-case rows
     GET    /eval-runs/compare       → two batches side by side
     GET    /evals/dashboard         → the workspace aggregate */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalDashboard,
  EvalRunBatch,
  EvalRunBatchDetail,
  EvalRunComparison,
} from "@devdigest/shared";

/** The one place each of these keys is spelled — read by the queries AND the mutations. */
export const evalCasesKey = (agentId: string | null | undefined) => ["eval-cases", agentId];
export const evalRunsKey = (agentId: string | null | undefined) => ["eval-runs", agentId];
export const evalRunKey = (batchId: string | null | undefined) => ["eval-run", batchId];
export const evalDashboardKey = () => ["eval-dashboard"];
export const evalCompareKey = (a: string | null | undefined, b: string | null | undefined) => [
  "eval-compare",
  a,
  b,
];

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalCasesKey(agentId),
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/**
 * Turn a decided finding into an eval case.
 *
 * `agentId` is only ever used to invalidate the right set — the server derives
 * the owner from the finding's review, and a mismatch here can put a case in the
 * list but not refresh it, never in the wrong list.
 *
 * The server answers the EXISTING case rather than an error when one was already
 * created from this finding, so a second click is idempotent rather than a
 * failure the user has to interpret.
 */
export function useCreateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalCase>("/eval-cases", { finding_id: findingId }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: evalCasesKey(agentId ?? created.owner_id) });
      // The dashboard's `cases_total` counts this row too.
      qc.invalidateQueries({ queryKey: evalDashboardKey() });
    },
  });
}

export function useDeleteEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<void>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evalCasesKey(agentId) });
      // Deleting a case cascades its `eval_runs` rows, so every metric that
      // counted them is now wrong until it is refetched.
      qc.invalidateQueries({ queryKey: evalRunsKey(agentId) });
      qc.invalidateQueries({ queryKey: evalDashboardKey() });
    },
  });
}

export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalRunsKey(agentId),
    queryFn: () => api.get<EvalRunBatch[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

/**
 * One batch and its per-case rows.
 *
 * Polls while the batch is still `running`. The run is fire-and-forget on the
 * server — a real eight-case batch takes minutes — so the progress a user sees
 * comes from re-reading server state, never from local state that a page reload
 * would lose.
 */
export function useEvalRun(batchId: string | null | undefined) {
  return useQuery({
    queryKey: evalRunKey(batchId),
    queryFn: () => api.get<EvalRunBatchDetail>(`/eval-runs/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (query) =>
      query.state.data?.batch.status === "running" ? 2000 : false,
  });
}

export function useStartEvalRun(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunBatch>(`/agents/${agentId}/eval-runs`),
    onSuccess: (batch) => {
      qc.invalidateQueries({ queryKey: evalRunsKey(agentId) });
      qc.invalidateQueries({ queryKey: evalRunKey(batch.id) });
      qc.invalidateQueries({ queryKey: evalDashboardKey() });
    },
  });
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: evalDashboardKey(),
    queryFn: () => api.get<EvalDashboard>("/evals/dashboard"),
  });
}

export function useEvalComparison(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalCompareKey(a, b),
    queryFn: () => api.get<EvalRunComparison>(`/eval-runs/compare?a=${a}&b=${b}`),
    enabled: !!a && !!b,
  });
}
