import type { FindingGroup } from "@devdigest/shared";

/**
 * The group a finding belongs to, but only when it has company.
 *
 * Every finding belongs to exactly one group and a group of one is a valid
 * group — so "has a group" is not news. What the card badges is a group with
 * MORE THAN ONE member: several agents naming the same place.
 */
export function sharedGroupFor(
  groups: readonly FindingGroup[],
  findingId: string,
): FindingGroup | undefined {
  return groups.find(
    (g) => g.members.length > 1 && g.members.some((m) => m.finding_id === findingId),
  );
}
