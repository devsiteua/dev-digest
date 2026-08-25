/* hooks/intent.ts — React Query hooks for the L03 intent layer:
     GET  /pulls/:id/intent → the derived intent; 404 means "never derived",
                              which is a state the card renders, not an error
     POST /pulls/:id/intent → derive or re-derive; SYNCHRONOUS, so this mutation
                              is in flight for as long as the model call takes */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { PrIntentRecord } from "@devdigest/shared";

const key = (prId: string | null | undefined) => ["intent", prId];

/**
 * The stored intent, or `null` when none has been derived.
 *
 * A 404 is resolved to `null` rather than thrown: "this PR has no intent yet" is
 * the empty state of a card, not a failure anyone should see a toast about. Every
 * other status still rejects, so a real outage stays visible.
 */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: key(prId),
    queryFn: async () => {
      try {
        return await api.get<PrIntentRecord>(`/pulls/${prId}/intent`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!prId,
  });
}

/**
 * Derive or re-derive now.
 *
 * The response is written into the cache BEFORE invalidating: it is the only copy
 * of the fresh row, and a bare invalidate would blank the card until the refetch
 * lands — on a request that just cost a model call.
 */
export function useDeriveIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent`),
    onSuccess: (record) => {
      qc.setQueryData(key(prId), record);
      qc.invalidateQueries({ queryKey: key(prId) });
    },
  });
}
