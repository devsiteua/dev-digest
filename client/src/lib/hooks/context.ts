/* hooks/context.ts — React Query hooks for the L05 Project Context folder
   (/repos/:repoId/context):
     GET    /repos/:id/context        → the repo's documents, in order, no bodies
     GET    /context/:id              → one document, with its body
     POST   /repos/:id/context        → upload one .md/.txt document
     PATCH  /context/:id              → enable / disable / retitle
     DELETE /context/:id              → remove one document
     PUT    /repos/:id/context/order  → the full id list, in the new order

   Everything is keyed under ["context", repoId] — including the single-document
   read — so ONE invalidation after each mutation refreshes the list and any open
   preview together. A document keyed outside that prefix would survive a delete
   and the drawer would go on showing a row that no longer exists. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ProjectContextDoc,
  ProjectContextPatch,
  ProjectContextUpload,
} from "@devdigest/shared";

/** The one cache key this screen owns. */
const contextKey = (repoId: string | null | undefined) => ["context", repoId] as const;

/** GET /repos/:id/context → every document of the repo, in `order`, no bodies. */
export function useProjectContext(repoId: string | null | undefined) {
  return useQuery({
    queryKey: contextKey(repoId),
    queryFn: () => api.get<ProjectContextDoc[]>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/**
 * GET /context/:id → one document with its body, for the read-only preview.
 *
 * `repoId` is not in the URL and is required anyway: it is what places this
 * query under the screen's key, so the preview is invalidated by the same call
 * that invalidates the list.
 */
export function useProjectContextDoc(
  repoId: string | null | undefined,
  docId: string | null | undefined,
) {
  return useQuery({
    queryKey: [...contextKey(repoId), "doc", docId],
    queryFn: () => api.get<ProjectContextDoc>(`/context/${docId}`),
    enabled: !!repoId && !!docId,
  });
}

/**
 * POST /repos/:id/context → store one document.
 *
 * The browser reads the file with `FileReader` and posts JSON; there is no
 * multipart endpoint. The server rejects a wrong extension (400), an oversize
 * body (413), a full repository (409) and a blank body (400) — each arrives as
 * an `ApiError` carrying the server's own message, which is what the screen
 * renders rather than a sentence of its own.
 */
export function useUploadProjectContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProjectContextUpload) =>
      api.post<ProjectContextDoc>(`/repos/${repoId}/context`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contextKey(repoId) });
    },
  });
}

export interface UpdateProjectContextDocInput {
  id: string;
  patch: ProjectContextPatch;
}

/** PATCH /context/:id → enable, disable, or retitle. The body is never edited. */
export function useUpdateProjectContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateProjectContextDocInput) =>
      api.patch<ProjectContextDoc>(`/context/${id}`, patch),
    // The response is the updated document, so write it into the list before
    // the refetch lands: without this an enable/disable toggle snaps back to its
    // old position for a round-trip, which reads as a failed save.
    onSuccess: (updated) => {
      qc.setQueryData<ProjectContextDoc[]>(contextKey(repoId), (list) =>
        list?.map((d) => (d.id === updated.id ? { ...updated, body: d.body } : d)),
      );
      qc.invalidateQueries({ queryKey: contextKey(repoId) });
    },
  });
}

/** DELETE /context/:id → 204. The document leaves the next prompt with it. */
export function useDeleteProjectContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/context/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contextKey(repoId) });
    },
  });
}

/**
 * PUT /repos/:id/context/order → the full id list, in the order the user set.
 *
 * Order is the user's statement of priority and the only thing that decides
 * which documents survive the prompt budget, so the response is the re-read
 * list rather than an optimistic reshuffle.
 */
export function useReorderProjectContext(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      api.put<ProjectContextDoc[]>(`/repos/${repoId}/context/order`, { ids }),
    onSuccess: (list) => {
      qc.setQueryData<ProjectContextDoc[]>(contextKey(repoId), list);
      qc.invalidateQueries({ queryKey: contextKey(repoId) });
    },
  });
}
