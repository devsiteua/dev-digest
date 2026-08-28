/* hooks/blast.ts — React Query hook for the L04 Blast Radius:
     GET /pulls/:id/blast → what the diff reaches: symbols, callers, endpoints, crons.
   Derived on the server from the repo-intel index; costs no model call, so it is
   safe to refetch whenever the index could have moved. */
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { BlastExplainResponse, BlastRadiusResponse } from "@devdigest/shared";

/** The one place this query's key is spelled — a resync invalidates through it. */
export const blastKey = (prId: string | null | undefined) => ["blast", prId];

/**
 * The blast map for a PR, or `null` when there is no such PR.
 *
 * A 404 resolves to `null` the way `useSmartDiff` and `usePrIntent` do: "this PR
 * is not there" is a state the tab renders, not a failure worth a toast. Every
 * other status still rejects. Note what is NOT a 404 here — an unindexed
 * repository answers 200 with `status: "degraded"`, because "we could not
 * compute it" is an answer and the tab has to be able to say which one.
 *
 * `enabled` is a caller's gate, not a convenience, and it carries two jobs.
 * `GET /pulls/:id` rewrites `pr_files` inside a transaction on every detail
 * load, so a blast request racing that write would map a file list the diff
 * beside it does not have; the tab therefore asks only once the detail has
 * resolved. And it is additionally gated on the tab being open, so opening a
 * pull request does not fetch a map nobody asked to see.
 */
export function useBlast(prId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: blastKey(prId),
    queryFn: async () => {
      try {
        return await api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!prId && enabled,
  });
}

/**
 * POST /pulls/:id/blast/explain → the map already on screen, in one paragraph.
 *
 * The one model call this feature makes, which is why it is a mutation behind a
 * button rather than a query that fires on render. Nothing is persisted, so
 * there is no cache to invalidate: the paragraph lives in the component that
 * asked for it, and asking again pays again — deliberately visible.
 *
 * A 409 is the ordinary answer for a map with nothing in it, not a bug: the
 * server refuses to spend a call dressing up "we could not look" as a finding.
 */
export function useExplainBlast(prId: string | null | undefined) {
  return useMutation({
    mutationFn: () => api.post<BlastExplainResponse>(`/pulls/${prId}/blast/explain`),
  });
}
