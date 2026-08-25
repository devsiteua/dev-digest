/* hooks/smart-diff.ts — React Query hook for the L03 Smart Diff:
     GET /pulls/:id/smart-diff → the PR's files grouped by role, in review order.
   Derived on the server from `pr_files` + the latest review; costs no model call,
   so it is safe to refetch whenever the ordering could have changed. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { SmartDiffResponse } from "@devdigest/shared";

/** The one place this query's key is spelled — mutations invalidate through it. */
export const smartDiffKey = (prId: string | null | undefined) => ["smart-diff", prId];

/**
 * The reviewer-ordered diff for a PR, or `null` when there is no such PR.
 *
 * A 404 resolves to `null` the way `usePrIntent` does: "this PR is not there"
 * is a state the Files tab renders (it falls back to the flat viewer), not a
 * failure worth a toast. Every other status still rejects.
 *
 * `enabled` is a caller's gate, not a convenience. `GET /pulls/:id` rewrites
 * `pr_files` inside a transaction on every detail load, so a smart-diff request
 * racing that write would read the pre-refresh snapshot and answer with a file
 * list the diff beside it does not have. The Files tab therefore asks only once
 * the detail it renders from has resolved.
 */
export function useSmartDiff(prId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: smartDiffKey(prId),
    queryFn: async () => {
      try {
        return await api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!prId && enabled,
  });
}
