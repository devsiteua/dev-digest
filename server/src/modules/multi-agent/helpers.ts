import type {
  AgentColumn,
  Conflict,
  ConflictTake,
  FindingGroup,
  FindingGroupMember,
  RunEstimate,
  Severity,
} from '@devdigest/shared';
import {
  ESTIMATE_MAX_SAMPLES,
  GROUP_LINE_WINDOW,
  GROUP_TITLE_SIMILARITY,
  TITLE_STOPWORDS,
} from './constants.js';

/**
 * Every decision the multi-agent feature makes WITHOUT a database, a clock, a
 * network or a model. Grouping, conflict detection and the run estimate are all
 * pure functions of their arguments, which is what makes the unit lane the right
 * gate for them and what keeps the read path free of model calls.
 *
 * Nothing here imports an ORM, an HTTP framework or the DI root — the grep that
 * says so is one of this step's gates. If a rule in this file ever needs a row it
 * was not handed, the row belongs in the argument list.
 */

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** One persisted finding, with the attribution `reviews` already carries. */
export interface GroupableFinding {
  finding_id: string;
  agent_id: string;
  agent_name: string;
  run_id: string;
  file: string;
  start_line: number;
  end_line: number;
  title: string;
  rationale: string;
  suggestion: string | null;
  severity: Severity;
  confidence: number;
}

/**
 * Title → sorted, unique, lowercase tokens with the stopwords removed.
 *
 * Deterministic and text-only: no model, no embedding, no dictionary lookup. The
 * output is sorted so two calls on the same input are `toEqual`-identical and so
 * a set comparison never depends on the order the words were written in.
 */
export function normaliseTitle(title: string): string[] {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((tok) => tok.length > 0 && !TITLE_STOPWORDS.has(tok));
  return [...new Set(tokens)].sort();
}

/**
 * Jaccard similarity of two token sets: shared words over all words used.
 *
 * Two titles that normalise to nothing (every word a stopword) count as
 * identical rather than as unrelated — they carry no evidence of difference, and
 * the line window is what is deciding the group at that point.
 */
function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const tok of a) if (setB.has(tok)) shared += 1;
  return shared / (a.length + b.length - shared);
}

/** True when two line ranges overlap or sit within `GROUP_LINE_WINDOW` of each other. */
function nearby(a: GroupableFinding, b: GroupableFinding): boolean {
  const aLo = Math.min(a.start_line, a.end_line);
  const aHi = Math.max(a.start_line, a.end_line);
  const bLo = Math.min(b.start_line, b.end_line);
  const bHi = Math.max(b.start_line, b.end_line);
  return Math.max(aLo, bLo) - Math.min(aHi, bHi) <= GROUP_LINE_WINDOW;
}

/**
 * Group findings that describe the same place: same file, line ranges that
 * overlap or sit within `GROUP_LINE_WINDOW`, and normalised titles whose Jaccard
 * similarity is at least `GROUP_TITLE_SIMILARITY`.
 *
 * Grouping is the TRANSITIVE CLOSURE of that relation (union-find), which is what
 * makes "every finding belongs to exactly one group" a property rather than a
 * hope: the union of the groups is the input set and their pairwise intersections
 * are empty, by construction. A single finding is a valid group of one.
 *
 * The function SORTS ITS OWN INPUTS by `(file, start_line, finding_id)` first. A
 * repository read in this codebase is not ordered unless it says so, and a pure
 * function whose determinism is load-bearing may not inherit ordering from a
 * query it does not own.
 *
 * Nothing is rewritten: every member carries its original title, rationale,
 * suggestion, severity and confidence verbatim. The group's own `title`,
 * `severity` and line are its FIRST member — a representative, never a synthesis.
 */
export function groupFindings(findings: readonly GroupableFinding[]): FindingGroup[] {
  const sorted = [...findings].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.start_line - b.start_line ||
      a.finding_id.localeCompare(b.finding_id),
  );
  const tokens = sorted.map((f) => normaliseTitle(f.title));

  // Union-find over the "same place" relation.
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    let walk = i;
    while (parent[walk] !== root) {
      const next = parent[walk]!;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const union = (i: number, j: number): void => {
    const [ri, rj] = [find(i), find(j)];
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
  };

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (a.file !== b.file) continue;
      if (!nearby(a, b)) continue;
      if (jaccard(tokens[i]!, tokens[j]!) < GROUP_TITLE_SIMILARITY) continue;
      union(i, j);
    }
  }

  // Groups come out in the order their first member appears in the sorted input.
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < sorted.length; i += 1) {
    const root = find(i);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(i);
    else byRoot.set(root, [i]);
  }

  return [...byRoot.values()].map((indexes) => {
    const members: FindingGroupMember[] = indexes.map((i) => {
      const f = sorted[i]!;
      return {
        finding_id: f.finding_id,
        agent_id: f.agent_id,
        agent_name: f.agent_name,
        run_id: f.run_id,
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion,
        severity: f.severity,
        confidence: f.confidence,
      };
    });
    const head = sorted[indexes[0]!]!;
    return {
      key: `${head.file}:${head.start_line}:${head.finding_id}`,
      file: head.file,
      start_line: head.start_line,
      title: head.title,
      severity: head.severity,
      members,
    };
  });
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/**
 * Where the agents disagree, and how many of them were in a position to.
 *
 * A place is a group. It is a conflict when at least one agent flagged it and
 * either another agent that FINISHED stayed silent, or the flaggers assigned two
 * or more distinct severities.
 *
 * Only a column whose status is exactly `done` produces a take, in either list.
 * A `failed`, `cancelled` or `running` agent did not decline to flag the place —
 * it never got to look — and an `ignored` take for it would read as a judgement
 * it never made. That is also why `agents_considered` is reported: the block can
 * say it speaks for 2 of 3 agents instead of quietly speaking for all three.
 */
export function detectConflicts(
  groups: readonly FindingGroup[],
  columns: readonly AgentColumn[],
): { conflicts: Conflict[]; agents_considered: number } {
  const done = columns.filter((c) => c.status === 'done');
  const doneById = new Map(done.map((c) => [c.agent_id, c]));

  const conflicts: Conflict[] = [];
  for (const group of groups) {
    // One take per flagging agent: its first member in the group's own order.
    const flaggers = new Map<string, FindingGroupMember>();
    for (const member of group.members) {
      if (!doneById.has(member.agent_id)) continue;
      if (!flaggers.has(member.agent_id)) flaggers.set(member.agent_id, member);
    }
    if (flaggers.size === 0) continue;

    const silent = done.filter((c) => !flaggers.has(c.agent_id));
    const severities = new Set([...flaggers.values()].map((m) => m.severity));
    if (silent.length === 0 && severities.size < 2) continue;

    const takes: ConflictTake[] = [
      ...[...flaggers.values()].map((m) => ({
        agent_id: m.agent_id,
        persona: m.agent_name,
        verdict: m.severity,
        note: m.title,
      })),
      // The label for a silent agent is the client's copy, not the server's: an
      // empty note is the absence of a stance, and inventing English here would
      // put user-facing text outside `client/messages/`.
      ...silent.map((c) => ({
        agent_id: c.agent_id,
        persona: c.agent_name,
        verdict: 'ignored' as const,
        note: '',
      })),
    ];

    conflicts.push({
      file: group.file,
      line: group.start_line,
      title: group.title,
      takes,
    });
  }

  return { conflicts, agents_considered: done.length };
}

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

/** The columns of a past run an estimate is allowed to read. */
export interface EstimatableRun {
  status: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
}

/**
 * What one agent's next run is likely to cost, from runs that already happened.
 *
 * Only COMPLETED runs are averaged — a failed run's duration is the time it took
 * to break — and at most `ESTIMATE_MAX_SAMPLES` of them, most recent first, in
 * the order the caller hands them over.
 *
 * `null` is returned for a mean there is no sample for, and never `0`: a run that
 * cost nothing and an unpriced model are different facts, which is the rule
 * `agent_runs.cost_usd` already states. A cost average can be null while a
 * duration average is not, because unpriced models still take time.
 */
export function estimateFor(
  runs: readonly EstimatableRun[],
): Pick<RunEstimate, 'runs_sampled' | 'avg_duration_ms' | 'avg_cost_usd'> {
  const sampled = runs.filter((r) => r.status === 'done').slice(0, ESTIMATE_MAX_SAMPLES);

  const durations = sampled
    .map((r) => r.duration_ms)
    .filter((d): d is number => d !== null && Number.isFinite(d));
  const costs = sampled
    .map((r) => r.cost_usd)
    .filter((c): c is number => c !== null && Number.isFinite(c));

  const mean = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length;

  return {
    runs_sampled: sampled.length,
    avg_duration_ms: durations.length > 0 ? Math.round(mean(durations)) : null,
    avg_cost_usd: costs.length > 0 ? mean(costs) : null,
  };
}
