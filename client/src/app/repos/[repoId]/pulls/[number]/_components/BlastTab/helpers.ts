import type { BlastRadiusResponse, DownstreamImpact } from "@devdigest/shared";

/** Pure reads over a blast map — the part worth unit-testing on its own. */

export interface BlastCounts {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/**
 * The four numbers the stat row shows.
 *
 * Endpoints and crons are counted DISTINCT across the whole map, not summed per
 * symbol: two symbols that both reach `GET /orders` put one route at risk, and a
 * row reading "8 endpoints" over four real ones would overstate the blast every
 * time a change touches a file twice.
 */
export function countBlast(map: BlastRadiusResponse): BlastCounts {
  return {
    symbols: map.changed_symbols.length,
    callers: map.downstream.reduce((n, d) => n + d.callers.length, 0),
    endpoints: new Set(map.downstream.flatMap((d) => d.endpoints_affected)).size,
    crons: new Set(map.downstream.flatMap((d) => d.crons_affected)).size,
  };
}

/** Whether there is any node below the changed symbols worth drawing. */
export function hasDownstream(map: BlastRadiusResponse): boolean {
  return map.downstream.some(
    (d) => d.callers.length > 0 || d.endpoints_affected.length > 0 || d.crons_affected.length > 0,
  );
}

/**
 * The symbol the graph opens on: the one that reaches the most.
 *
 * The design's graph artboard draws `downstream[0]` because its fixture happens
 * to put the interesting symbol first. A real map is ordered by file and name,
 * so picking the first would routinely open the graph on a symbol nothing calls.
 */
export function graphSubject(map: BlastRadiusResponse): DownstreamImpact | null {
  let best: DownstreamImpact | null = null;
  for (const d of map.downstream) {
    if (d.callers.length === 0) continue;
    if (!best || d.callers.length > best.callers.length) best = d;
  }
  return best;
}
