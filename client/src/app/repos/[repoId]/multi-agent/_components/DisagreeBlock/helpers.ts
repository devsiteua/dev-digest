import type { Conflict, FindingGroup } from "@devdigest/shared";

/**
 * The place a group and a conflict both name.
 *
 * A conflict is built FROM a group on the server — `file` and `line` are copied
 * from the group's `file` and `start_line` — so the two match exactly and this
 * key needs no line window of its own.
 */
export const placeKey = (file: string, line: number) => `${file}:${line}`;

/** Every place at least two agents disagreed about. */
export function conflictedPlaces(conflicts: readonly Conflict[]): Set<string> {
  return new Set(conflicts.map((c) => placeKey(c.file, c.line)));
}

/**
 * The groups the `Show only conflicts` switch hides: places where the agents
 * that flagged them agreed, and no `done` agent stayed silent.
 */
export function agreedGroups(
  groups: readonly FindingGroup[],
  conflicts: readonly Conflict[],
): FindingGroup[] {
  const contended = conflictedPlaces(conflicts);
  return groups.filter((g) => !contended.has(placeKey(g.file, g.start_line)));
}
