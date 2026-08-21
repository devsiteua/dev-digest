/* hooks/skills.ts — React Query hooks for the L02 Skills page, the skill editor,
   the import drawer, and the Skills tab of the agent editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentSkillLink,
  Skill,
  SkillDraft,
  SkillStats,
  SkillType,
  SkillVersion,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

/** Body snapshots, newest first. One per save that changed the text. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** Usage numbers for the Stats tab. See `SkillStats` on how to read them. */
export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type?: SkillType;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      // A changed body appends a snapshot server-side, so the Versions tab is
      // stale the moment a save lands — whether or not it is the visible tab.
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export interface RestoreSkillVersionInput {
  id: string;
  version: number;
}

/**
 * Make a past snapshot the current body. The server moves the skill FORWARD (a
 * restore of v2 lands as v6 with v2's text), so both the skill and its version
 * list change and neither can be patched into the cache from the response alone.
 */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: RestoreSkillVersionInput) =>
      api.post<Skill>(`/skills/${id}/restore`, { version }),
    onSuccess: (data) => {
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
      // `agent_skills.skill_id` is ON DELETE CASCADE, so every agent's link list
      // just changed on the server. Without this, an open Skills tab keeps a
      // dangling id in its draft and POSTs it back on the next save.
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
      // The same cascade changed `skill_count` on every agent card that carried
      // this skill.
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/** An upload already read by the browser: markdown as text, archives as base64. */
export type ImportPayload =
  | { kind: "markdown"; filename: string; content: string }
  | { kind: "zip"; filename: string; content_base64: string };

/**
 * Parse an upload into an editable draft. This endpoint writes nothing — the
 * skill is only created when the user confirms, via `useImportSkill`.
 */
export function useImportPreview() {
  return useMutation({
    mutationFn: (payload: ImportPayload) =>
      api.post<SkillDraft>("/skills/import/preview", payload),
  });
}

/**
 * Persist a reviewed draft. `source` and `enabled` are NOT sent: the server
 * stamps them (`imported_file`, disabled) so an import cannot present itself as
 * hand-written and skip the untrusted wrapping at prompt-assembly time.
 */
export function useImportSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateSkillInput, "enabled">) =>
      api.post<Skill>("/skills/import", input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

// ---- agent ⇄ skill links ---------------------------------------------------

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/**
 * Replace the agent's whole ordered set of links. Attach, detach and reorder are
 * all this one call — the array's order IS the order the blocks appear in the
 * assembled prompt.
 */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (data) => {
      qc.setQueryData(["agent-skills", agentId], data);
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      // Attaching or detaching moved this agent's `skill_count`, which the agent
      // cards render — and no `agents` query refetches on its own. The detail
      // page renders the same card from `["agent", id]`, so both keys go.
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
    },
  });
}
