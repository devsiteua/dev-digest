/* hooks/brief.ts — React Query hooks for the L05 PR Brief:
     GET  /pulls/:id/brief → the stored brief, whether it still describes the PR
                             (`stale`), and the Why Timeline. 404 means "never
                             generated", which is a card's empty state, not an error.
     POST /pulls/:id/brief → generate one. SYNCHRONOUS and the ONLY model call
                             this feature makes, so the mutation is in flight for
                             as long as the model takes. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { PrBriefRecord, PrBriefResponse } from "@devdigest/shared";

/** The one place this query's key is spelled — read by the query and by the mutation. */
export const briefKey = (prId: string | null | undefined) => ["brief", prId];

/**
 * The newest brief for a PR, or `null` when none has ever been generated.
 *
 * A 404 is resolved to `null` rather than thrown, the way `usePrIntent` and
 * `useBlast` do: "no brief yet" is the empty state of a card, not a failure
 * anyone should see a toast about. Every other status still rejects, so a real
 * outage stays visible.
 *
 * Note what is NOT a 404: a brief that no longer matches the pull request
 * answers 200 with `stale: true`. Staleness is an answer, and the card has to be
 * able to show the old brief while saying so.
 */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: briefKey(prId),
    queryFn: async () => {
      try {
        return await api.get<PrBriefResponse>(`/pulls/${prId}/brief`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!prId,
  });
}

/**
 * Generate a brief now — the button, and the only thing in this feature that
 * spends money.
 *
 * The response is written into the cache BEFORE invalidating, for the reason
 * `useDeriveIntent` gives: it is the only copy of a row that just cost a model
 * call, and a bare invalidate would blank the card until the refetch lands.
 *
 * The POST answers a `PrBriefRecord` — no `stale`, no `history` — while the
 * query holds a `PrBriefResponse`. The freshly generated row is by construction
 * `stale: false` (its `state_key` is the one a read would recompute), so the
 * seed written here says so, and the invalidate that follows replaces it with
 * the server's own answer including the new timeline entry.
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefRecord>(`/pulls/${prId}/brief`),
    onSuccess: (record) => {
      qc.setQueryData(briefKey(prId), (previous: PrBriefResponse | null | undefined) => ({
        ...record,
        stale: false,
        history: previous?.history ?? [],
      }));
      qc.invalidateQueries({ queryKey: briefKey(prId) });
    },
  });
}
