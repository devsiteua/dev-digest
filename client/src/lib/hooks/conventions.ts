/* hooks/conventions.ts — React Query hooks for the L02 conventions extractor
   screen (/repos/:repoId/conventions):
     GET   /repos/:id/conventions         → the stored candidates
     POST  /repos/:id/conventions/extract → one pass; SYNCHRONOUS, so this
                                            mutation is in flight for as long as
                                            the model call takes ("Scanning…")
     PATCH /conventions/:id               → reword, re-file, accept/reject
     POST  /repos/:id/conventions/skill   → merge the accepted ones into one
                                            skill; the modal composes the body */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillRequest,
  ConventionUpdate,
  Skill,
} from "@devdigest/shared";

/** GET /repos/:id/conventions → every stored candidate, whatever its status. */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/**
 * POST /repos/:id/conventions/extract → sample, ask the model once, verify,
 * persist. A re-scan replaces the `pending` rows and leaves accepted/rejected
 * ones alone, so the stored list is refetched rather than replaced from the
 * response (which also carries `sampled_files` and `discarded`).
 */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ConventionExtractResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: ConventionUpdate;
}

/**
 * PATCH /conventions/:id. The id is repo-independent, but `repoId` is still
 * required — it is what the list query is keyed on, and the accept/reject the
 * user just made has to be readable after a reload.
 */
export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

/**
 * POST /repos/:id/conventions/skill → one merged skill from the accepted
 * candidates.
 *
 * The request carries no `source`: the server stamps `'extracted'` itself, and
 * a body a model wrote must not be able to call itself `'manual'` and skip the
 * untrusted wrapping (`ConventionSkillRequest` in `@devdigest/shared`).
 *
 * Two caches move on success — `skills`, which gains a row, and `conventions`,
 * because every merged candidate comes back carrying the new `skill_id`.
 */
export function useCreateSkillFromConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConventionSkillRequest) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
