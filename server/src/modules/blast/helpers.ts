import type {
  BlastCaller,
  BlastReason,
  BlastStatus,
  ChangedSymbol,
  DownstreamImpact,
} from '@devdigest/shared';
import { TEST_PATH_PATTERNS } from './constants.js';

/**
 * The pure half of the Blast Radius: which files a fact may be read from, how a
 * symbol's downstream is assembled, and which of the six honest answers a map is.
 *
 * Nothing here reads a database, a request or a clock. Every DTO below is
 * declared LOCALLY rather than imported from `modules/repo-intel`: the container
 * types the facade, so the shapes arrive by inference at the call site, and this
 * module stays free of the cross-module import that `pnpm arch:check` reports as
 * a warning it cannot fail on.
 */

// ---- The shapes this module reads off the facade ---------------------------

/** How complete `repo_index_state` says the index is. */
export type BlastIndexStatus = 'full' | 'partial' | 'degraded' | 'failed';

/** One resolved caller of one changed symbol, as the index recorded it. */
export interface BlastCallerInput {
  file: string;
  /** The enclosing symbol at that line, or the file's basename when unknown. */
  symbol: string;
  /** Which changed symbol this caller reaches. */
  viaSymbol: string;
  line: number;
}

/** Precomputed per-file facts, keyed by repo-relative path. */
export interface BlastFacts {
  endpoints: string[];
  crons: string[];
}

/** One file downstream of a seed, with its own facts. */
export interface BlastDependentInput extends BlastFacts {
  file: string;
  depth: number;
}

// ---- Which files a fact may be read from -----------------------------------

/**
 * Whether a path is a test, and therefore not a source of endpoints or crons.
 *
 * The single filter this module's one path constant feeds. See
 * `TEST_PATH_PATTERNS` for why a test's routes must not enter the map, and why
 * a test's CALLS still do.
 */
export function isTestPath(path: string): boolean {
  const probe = `/${path.toLowerCase()}`;
  return TEST_PATH_PATTERNS.some((pattern) => probe.includes(pattern));
}

// ---- Assembling the map ----------------------------------------------------

/** Callers grouped by the changed symbol they reach, order preserved. */
export function groupCallersBySymbol(
  callers: readonly BlastCallerInput[],
): Map<string, BlastCallerInput[]> {
  const bySymbol = new Map<string, BlastCallerInput[]>();
  for (const caller of callers) {
    const bucket = bySymbol.get(caller.viaSymbol);
    if (bucket) bucket.push(caller);
    else bySymbol.set(caller.viaSymbol, [caller]);
  }
  return bySymbol;
}

/**
 * The changed symbols in a stable order: file, then name.
 *
 * `getSymbolRows` has no ORDER BY — it does not need one for its other readers —
 * so without this the same pull request can answer with its symbols in two
 * different orders on two identical requests.
 */
export function orderSymbols(symbols: readonly ChangedSymbol[]): ChangedSymbol[] {
  return [...symbols].sort(
    (a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name),
  );
}

/**
 * What each changed symbol reaches: its callers, and the endpoints and crons of
 * everything downstream of those callers.
 *
 * ONE ENTRY PER CHANGED SYMBOL, including symbols that reach nothing. A symbol
 * silently absent from `downstream` is indistinguishable from a symbol the
 * traversal never got to, and the whole feature is about not making that kind of
 * claim; an entry with three empty arrays says "checked, nothing" out loud.
 *
 * Facts arrive from two levels and are unioned, never distinguished: level 1 is
 * `factsByFile`, keyed by the symbol's own caller files, and level 2 is
 * `dependentsBySymbol`, one reverse hop further out. What a reviewer needs is
 * "this endpoint is downstream of your change", not how many imports away.
 */
export function buildDownstream(input: {
  symbols: readonly ChangedSymbol[];
  callersBySymbol: ReadonlyMap<string, BlastCallerInput[]>;
  factsByFile: Readonly<Record<string, BlastFacts>>;
  dependentsBySymbol: ReadonlyMap<string, readonly BlastDependentInput[]>;
}): DownstreamImpact[] {
  const { symbols, callersBySymbol, factsByFile, dependentsBySymbol } = input;

  return symbols.map((symbol) => {
    const callers = callersBySymbol.get(symbol.name) ?? [];
    const endpoints = new Set<string>();
    const crons = new Set<string>();

    // Level 1 — the caller files themselves.
    for (const file of new Set(callers.map((c) => c.file))) {
      collectFacts(file, factsByFile[file], endpoints, crons);
    }
    // Level 2 — one reverse hop beyond them.
    for (const dependent of dependentsBySymbol.get(symbol.name) ?? []) {
      collectFacts(dependent.file, dependent, endpoints, crons);
    }

    const rows: BlastCaller[] = callers.map((c) => ({
      name: c.symbol,
      file: c.file,
      line: c.line,
    }));

    return {
      symbol: symbol.name,
      // Left in the order the index ranked them: most important caller first.
      callers: rows,
      endpoints_affected: [...endpoints].sort((a, b) => a.localeCompare(b)),
      crons_affected: [...crons].sort((a, b) => a.localeCompare(b)),
    };
  });
}

/** Add one file's facts, unless the file is a test. */
function collectFacts(
  file: string,
  facts: BlastFacts | undefined,
  endpoints: Set<string>,
  crons: Set<string>,
): void {
  if (!facts || isTestPath(file)) return;
  for (const endpoint of facts.endpoints) endpoints.add(endpoint);
  for (const cron of facts.crons) crons.add(cron);
}

// ---- The four states, and the reason behind each ---------------------------

export interface BlastStateInput {
  /** False when repo-intel is switched off for this installation. */
  repoIntelEnabled: boolean;
  /** What `repo_index_state` says, `degraded` when there is no row at all. */
  indexStatus: BlastIndexStatus;
  /** How many `pr_files` rows the pull request has. */
  changedFileCount: number;
  /** Whether the index-only read returned a map rather than `null`. */
  indexAnswered: boolean;
  symbolCount: number;
  callerCount: number;
}

export interface BlastState {
  status: BlastStatus;
  reason: BlastReason | null;
}

/**
 * Which of the six answers this map is.
 *
 * The order of the checks IS the precedence, and it is the order the spec's
 * table is written in: the health of the index first, because it is the
 * precondition for every other statement the response makes, and only then what
 * the pull request itself turned out to contain. An emptiness is `ok` with a
 * reason — nothing failed, there is simply nothing to draw, and the three ways
 * that happens have three different next steps for the reader.
 */
export function decideBlastState(input: BlastStateInput): BlastState {
  if (!input.repoIntelEnabled) {
    return { status: 'degraded', reason: 'repo_intel_disabled' };
  }
  if (input.indexStatus === 'failed') {
    return { status: 'degraded', reason: 'index_failed' };
  }
  if (input.indexStatus === 'degraded') {
    return { status: 'degraded', reason: 'index_missing' };
  }
  // An index that says `full` or `partial` and still cannot answer means the
  // row and the tables under it disagree — degraded, not an empty map.
  if (input.changedFileCount > 0 && !input.indexAnswered) {
    return { status: 'degraded', reason: 'index_missing' };
  }
  if (input.indexStatus === 'partial') {
    return { status: 'partial', reason: 'index_partial' };
  }
  if (input.changedFileCount === 0) {
    return { status: 'ok', reason: 'no_changed_files' };
  }
  if (input.symbolCount === 0) {
    return { status: 'ok', reason: 'no_indexed_symbols' };
  }
  if (input.callerCount === 0) {
    return { status: 'ok', reason: 'no_callers' };
  }
  return { status: 'ok', reason: null };
}

// ---- The sentence that goes with it ----------------------------------------

/** `1 symbol` / `3 symbols` — the plural is not worth a library. */
function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * The map in one sentence, derived — no model is asked anything on this path.
 *
 * Every branch says what was looked at and at which commit, because the one
 * sentence a reader must never be able to take away from an empty map is "this
 * pull request affects nothing".
 */
export function describeBlast(input: {
  state: BlastState;
  indexedSha: string | null;
  changedFileCount: number;
  symbolCount: number;
  callerCount: number;
  endpointCount: number;
  cronCount: number;
}): string {
  const { state, indexedSha, symbolCount } = input;
  const at = indexedSha ? ` at ${indexedSha.slice(0, 7)}` : '';

  switch (state.reason) {
    case 'repo_intel_disabled':
      return 'Repository intelligence is switched off, so nothing was analysed — this is not a claim that the pull request affects nothing.';
    case 'index_failed':
      return 'The last index of this repository failed, so nothing was analysed — this is not a claim that the pull request affects nothing.';
    case 'index_missing':
      return 'This repository has no usable index, so nothing was analysed — this is not a claim that the pull request affects nothing.';
    case 'no_changed_files':
      return 'No changed files are recorded for this pull request, so there was nothing to trace. Open its Files tab once to import them.';
    case 'no_indexed_symbols':
      return `None of the ${count(input.changedFileCount, 'changed file')} declares a symbol the index knows${at}, so nothing downstream could be traced.`;
    case 'no_callers':
      return `${count(symbolCount, 'changed symbol')}, and nothing in the index${at} calls ${symbolCount === 1 ? 'it' : 'them'}.`;
    default:
      break;
  }

  const reach =
    `${count(symbolCount, 'symbol')} changed → ${count(input.callerCount, 'caller')}, ` +
    `${count(input.endpointCount, 'endpoint')}, ${count(input.cronCount, 'cron/job')}`;
  return state.status === 'partial'
    ? `${reach}. The index${at} is incomplete, so some callers may be missing.`
    : `${reach}, as indexed${at}.`;
}
