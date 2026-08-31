/* hooks/ci.ts — Export to CI, the agent's CI tab and the CI Runs page.
   Four hooks over the CI routes the engine serves:
     GET  /ci/runs                       → the CI Runs page
     GET  /agents/:id/ci                 → the agent's CI tab
     GET  /agents/:id/export-ci/preview  → the wizard's Preview step (read-only)
     POST /agents/:id/export-ci          → the wizard's Install step */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentCiView,
  CiExport,
  CiExportInputBody,
  CiFile,
  CiRun,
} from "@devdigest/shared";

/** Every CI run in this workspace, newest first (the engine caps the list). */
export function useCiRuns() {
  return useQuery({
    queryKey: ["ci-runs"],
    queryFn: () => api.get<CiRun[]>("/ci/runs"),
  });
}

/** One agent's installations, its recent CI runs and the runner version. */
export function useAgentCi(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-ci", agentId],
    queryFn: () => api.get<AgentCiView>(`/agents/${agentId}/ci`),
    enabled: !!agentId,
  });
}

/**
 * The file list the Preview step renders. Writes nothing and calls no GitHub.
 *
 * Keyed by agent and repository and by nothing else, so the wizard's Preview
 * shows the generator's default trigger set — Preview runs before Configure,
 * and the engine applies the same defaults when a query carries none.
 *
 * `retry: false`: the failure worth showing here is "the runner bundle is
 * missing on this machine", which is a fact about the disk and does not become
 * true on a second attempt. Surfacing it at Preview is the point of the route.
 */
export function useCiPreview(agentId: string | null | undefined, repo: string) {
  return useQuery({
    queryKey: ["ci-preview", agentId, repo],
    queryFn: () =>
      api.get<CiFile[]>(
        `/agents/${agentId}/export-ci/preview?repo=${encodeURIComponent(repo)}`,
      ),
    enabled: !!agentId && repo.length > 0,
    retry: false,
  });
}

export interface ExportToCiInput {
  agentId: string;
  body: CiExportInputBody;
}

/**
 * Install: commit the bundle into the target repository and open a pull request.
 *
 * Invalidates both reads the call can change — the agent's CI tab gains an
 * installation, and CI Runs gains a repository whose runs may now arrive.
 */
export function useExportToCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, body }: ExportToCiInput) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
      qc.invalidateQueries({ queryKey: ["agent-ci", vars.agentId] });
    },
  });
}
