import type { Agent, ProjectContextDoc } from "@devdigest/shared";
import { BYTES_PER_KB } from "./constants";

/** Total stored size of a document set, in bytes. */
export function totalBytes(docs: ProjectContextDoc[]): number {
  return docs.reduce((sum, d) => sum + d.size_bytes, 0);
}

/** Bytes as whole kilobytes, floor 1 so a short document is not "0kb". */
export function toKb(bytes: number): number {
  return bytes === 0 ? 0 : Math.max(1, Math.round(bytes / BYTES_PER_KB));
}

/**
 * How many of the workspace's enabled agents read project context.
 *
 * A property of the AGENTS, not of a document: `agents` is keyed on
 * `workspace_id` alone, so there is no per-repo or per-document number to give,
 * and a counter that implied one would be the same trap as the mockup's
 * "Used by 3 agents". `project_context !== false` because an agent row from
 * before the column existed means "on".
 */
export function agentReaderCounts(agents: Agent[] | undefined): {
  readers: number;
  total: number;
} {
  const enabled = (agents ?? []).filter((a) => a.enabled);
  return {
    readers: enabled.filter((a) => a.project_context !== false).length,
    total: enabled.length,
  };
}

/**
 * The id list with one document moved by `delta`, or `undefined` when the move
 * would fall off either end — which is what disables the arrow rather than
 * silently doing nothing.
 */
export function reorderedIds(
  docs: ProjectContextDoc[],
  id: string,
  delta: 1 | -1,
): string[] | undefined {
  const from = docs.findIndex((d) => d.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= docs.length) return undefined;
  const ids = docs.map((d) => d.id);
  const [moved] = ids.splice(from, 1);
  if (moved === undefined) return undefined;
  ids.splice(to, 0, moved);
  return ids;
}
