import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  BlastRadiusResponse,
  PrBriefDelta,
  PrBriefRecord,
  PrBriefTimelineEntry,
  ReviewFocusItem,
  Risk,
  RiskKind,
  RiskSeverity,
} from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import {
  BRIEF_INPUT_TOKEN_BUDGET,
  BRIEF_SYSTEM_PROMPT,
  BRIEF_TRIM_MAX_FILES,
} from './constants.js';

/**
 * Everything the PR brief DECIDES, with no clock, no database and no network.
 *
 * The split this file draws is the same one the commit boundary draws: what is
 * here can be proved by a unit test with a fixture, and what is in `service.ts`
 * needs a container. Nothing here reads `container`, and nothing here imports a
 * sibling module — the blast map and the derived intent arrive as plain data
 * that `service.ts` gathered through `container`.
 *
 * The one invariant worth stating out loud: `briefStateOf` owns
 * *assemble → trim → hash* as ONE function, and it is the only way to obtain a
 * `state_key`. `read` and `generate` must produce byte-identical strings or every
 * trimmed brief is stale forever; two call sites that happen to agree today are
 * a weaker guarantee than one function they both call.
 */

// ---- What the assembler is given -------------------------------------------

/** One changed file, as the prompt sees it: a path and two counts. Never a hunk. */
export interface BriefChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

/** The derived intent, reduced to the prose the brief actually renders. */
export interface BriefIntentFacts {
  kind: string;
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
  confidence_tier: string;
}

/** One enabled Project Context document, with its body. */
export interface BriefContextDoc {
  title: string;
  path_label: string;
  body: string;
}

/**
 * How much of the input survives the budget.
 *
 * Set ONLY by `trimToBudget`; a caller assembling an untrimmed input passes
 * `BRIEF_LIMITS_NONE`. Every field is a cap rather than a copy of the data, so
 * the assembled string stays a pure function of (facts, limits) and the ladder
 * can re-render at any rung without mutating what it was given.
 */
export interface BriefLimits {
  /** How many Project Context documents survive, from the HEAD of the user's order. `null` = all. */
  contextDocs: number | null;
  /** `false` → the linked issue keeps its number and title, and loses its body. */
  issueBody: boolean;
  /**
   * How many blast-map rows survive, from the head of the map's order — applied
   * to `changed_symbols` and `downstream` alike. `null` = all, `0` = the block
   * disappears.
   */
  blastRows: number | null;
  /** `false` → the map's caller lists go, and their symbols stay. */
  blastCallers: boolean;
  /** How many changed files are listed by name. The tail becomes a counted line. `null` = all. */
  files: number | null;
  /** `true` → the title, the branch and the file list, and nothing else. */
  minimal: boolean;
}

/** No budget pressure: everything the gatherer found is rendered. */
export const BRIEF_LIMITS_NONE: BriefLimits = {
  contextDocs: null,
  issueBody: true,
  blastRows: null,
  blastCallers: true,
  files: null,
  minimal: false,
};

/**
 * Everything one brief is assembled from.
 *
 * There is no hunk-body field and there never will be: the whole point of this
 * feature is that it answers "what and why" from facts ABOUT the change rather
 * than from the change itself, and a hunk body in here would quietly turn an
 * 8 000-token budget into a diff summariser. The grep that proves it — AC-09's
 * — greps this whole directory for the column's name, so the name does not
 * appear here either, not even to say it is absent.
 */
export interface BriefInputParts {
  title: string;
  branch: string;
  body: string | null;
  intent: BriefIntentFacts | null;
  blast: BlastRadiusResponse | null;
  files: BriefChangedFile[];
  issue: { number: number; title: string; body: string | null } | null;
  contextDocs: BriefContextDoc[];
  /** OURS, not the author's — so never wrapped, and the model is told to act on it. */
  missingInputs: string[];
  limits: BriefLimits;
}

// ---- The assembler ----------------------------------------------------------

/**
 * The order the file list is rendered in, and it is OURS rather than the
 * repository's.
 *
 * `ReviewRepository.getPrFiles` is `select … where pr_id = …` with no `order by`,
 * so it returns planner order — which is stable in practice and guaranteed by
 * nothing. AC-06 (byte-identical assembly) and AC-08 (the upsert on an unchanged
 * `state_key`) both die on planner order, so the sort happens here, inside the
 * pure function whose purity is the criterion, rather than in a repository this
 * module does not own.
 *
 * Largest change first, because rung 4 keeps the head of this list and "the
 * twelve biggest files" is a better prompt than "the twelve the planner
 * happened to hand us". `path` breaks the tie, so two files of equal size never
 * swap between two runs.
 */
export function sortBriefFiles(files: readonly BriefChangedFile[]): BriefChangedFile[] {
  return [...files].sort((a, b) => {
    const bySize = b.additions + b.deletions - (a.additions + a.deletions);
    return bySize !== 0 ? bySize : a.path.localeCompare(b.path);
  });
}

function renderBlast(blast: BlastRadiusResponse, limits: BriefLimits): string {
  const lines: string[] = [blast.summary];

  const symbols = limits.blastRows === null
    ? blast.changed_symbols
    : blast.changed_symbols.slice(0, limits.blastRows);
  if (symbols.length > 0) {
    lines.push('Changed symbols:');
    for (const s of symbols) lines.push(`- ${s.name} (${s.kind}) in ${s.file}`);
  }

  const downstream = limits.blastRows === null
    ? blast.downstream
    : blast.downstream.slice(0, limits.blastRows);
  for (const d of downstream) {
    lines.push(`Downstream of ${d.symbol}:`);
    if (limits.blastCallers) {
      for (const c of d.callers) lines.push(`- called by ${c.name} at ${c.file}:${String(c.line)}`);
    }
    for (const e of d.endpoints_affected) lines.push(`- endpoint ${e}`);
    for (const c of d.crons_affected) lines.push(`- scheduled job ${c}`);
  }
  return lines.join('\n');
}

/**
 * The user message, and what the current `limits` elided from it.
 *
 * Pure: no clock, no randomness, and no iteration over a map built from an
 * unordered read. The file list is sorted here (see `sortBriefFiles`), every
 * other list is rendered in the order it arrived, and the only branch is on the
 * data being absent. Two calls on identical fixtures produce byte-identical
 * strings — which is AC-06, and which is also the thing that makes `state_key`
 * a cache key rather than a random number.
 *
 * Every author- or model-controlled block is wrapped EXACTLY ONCE with
 * `wrapUntrusted`. Once, because `wrapUntrusted` escapes a nested
 * `</untrusted>`, so a second wrap does not double-delimit — it corrupts what
 * the first one produced (root `INSIGHTS.md`, 2026-08-29). This module has no
 * `assemblePrompt` between it and the provider, so wrapping here is required
 * rather than duplicative: nothing downstream will do it for us.
 *
 * `trimmed` describes what THIS rendering left out, so it is a property of the
 * returned string rather than a log of the ladder's intentions.
 */
export function assembleBriefInput(parts: BriefInputParts): { user: string; trimmed: string[] } {
  const limits = parts.limits;
  const trimmed: string[] = [];
  const sections: string[] = [`Pull request: "${parts.title}" on branch \`${parts.branch}\`.`];

  if (limits.minimal) {
    trimmed.push(
      'minimal-input: dropped the description, the derived intent, the linked issue, the ' +
        'Project Context documents and the blast map',
    );
  }

  if (!limits.minimal && parts.body) {
    sections.push(`## Pull request description\n${wrapUntrusted('pr-body', parts.body)}`);
  }

  if (!limits.minimal && parts.intent) {
    const i = parts.intent;
    sections.push(
      `## Derived intent (kind: ${i.kind}, confidence: ${i.confidence_tier})\n` +
        wrapUntrusted(
          'intent',
          [
            i.intent,
            `In scope: ${i.in_scope.join('; ')}`,
            `Out of scope: ${i.out_of_scope.join('; ')}`,
          ].join('\n'),
        ),
    );
  }

  if (!limits.minimal && parts.issue) {
    const issue = parts.issue;
    const withBody = limits.issueBody && issue.body;
    if (!withBody && issue.body) {
      trimmed.push(`linked-issue: dropped the body of #${String(issue.number)}`);
    }
    sections.push(
      `## Linked issue #${String(issue.number)}\n` +
        wrapUntrusted(
          `issue:${String(issue.number)}`,
          withBody ? `${issue.title}\n\n${issue.body ?? ''}` : issue.title,
        ),
    );
  }

  const docs = limits.minimal
    ? []
    : limits.contextDocs === null
      ? parts.contextDocs
      : parts.contextDocs.slice(0, limits.contextDocs);
  if (docs.length < parts.contextDocs.length) {
    trimmed.push(
      `project-context: dropped ${String(parts.contextDocs.length - docs.length)} of ` +
        `${String(parts.contextDocs.length)} documents, from the end of the reader's order`,
    );
  }
  for (const doc of docs) {
    sections.push(
      `## Project Context: ${doc.title} (${doc.path_label})\n` +
        wrapUntrusted(`context:${doc.path_label}`, doc.body),
    );
  }

  if (!limits.minimal && parts.blast) {
    const totalRows = parts.blast.changed_symbols.length + parts.blast.downstream.length;
    const keptRows =
      limits.blastRows === null
        ? totalRows
        : Math.min(parts.blast.changed_symbols.length, limits.blastRows) +
          Math.min(parts.blast.downstream.length, limits.blastRows);
    if (!limits.blastCallers) trimmed.push('blast-map: dropped every caller list');
    if (keptRows < totalRows) {
      trimmed.push(
        `blast-map: dropped ${String(totalRows - keptRows)} of ${String(totalRows)} rows, ` +
          'from the end of the map',
      );
    }
    sections.push(
      `## Blast map (status: ${parts.blast.status}${parts.blast.reason ? `, ${parts.blast.reason}` : ''})\n` +
        wrapUntrusted('blast-map', renderBlast(parts.blast, limits)),
    );
  }

  const sorted = sortBriefFiles(parts.files);
  if (sorted.length > 0) {
    const kept = limits.files === null ? sorted : sorted.slice(0, limits.files);
    const dropped = sorted.length - kept.length;
    const rows = kept.map(
      (f) => `- ${f.path} (+${String(f.additions)}/-${String(f.deletions)})`,
    );
    if (dropped > 0) {
      // The count is STATED rather than the tail silently vanishing — the
      // `EXPLAIN_MAX_*` rule: the model is never left to imply it saw everything.
      rows.push(`- … ${String(dropped)} more files, smaller than these`);
      trimmed.push(
        `changed-files: listed the largest ${String(kept.length)} of ${String(sorted.length)}`,
      );
    }
    sections.push(
      `## Changed files — path (+added/-deleted), largest first\n` +
        wrapUntrusted('paths', rows.join('\n')),
    );
  }

  if (parts.missingInputs.length > 0) {
    // NOT wrapped, for the reason `buildIntentPrompt` gives about its own
    // `missingContext` block: these sentences are ours, not the author's, and the
    // model is meant to ACT on them. A wrapped block is one the system message
    // has just finished calling inert data.
    sections.push(
      '## Input that is missing\n' +
        'Each line below was expected by this brief and could not be read. Do not reconstruct ' +
        'what it might have said, and do not infer anything from its name.\n' +
        parts.missingInputs.map((note) => `- ${note}`).join('\n'),
    );
  }

  sections.push(
    'State what this change does, why it exists, the risk areas it opens, and the files or ' +
      'endpoints a reviewer should read first.',
  );

  return { user: sections.join('\n\n'), trimmed };
}

// ---- The budget ladder ------------------------------------------------------

/**
 * The rungs, in the fixed order AC-11 names, expressed as successive `limits`
 * states over one input.
 *
 * Read top to bottom, this is the priority order inverted: whatever is cheapest
 * to lose goes first. Project Context documents lead because they are the
 * repository's standing prose rather than anything about THIS pull request
 * (AC-38), and they leave one whole document at a time from the tail of the
 * reader's own order — a half-document is worse than no document.
 *
 * The caller lists go before the symbols they hang off, because a symbol name is
 * the row and its callers are the bulk. They go all at once rather than one at a
 * time: a map with three of nine callers per symbol misstates the shape of the
 * blast radius, while a map with none of them still says truthfully which
 * symbols moved.
 *
 * The minimal rung is last and is a floor, not a rung that always fits: an input
 * still over budget there is a 422 rather than a shorter prompt.
 */
function ladderFor(parts: BriefInputParts): BriefLimits[] {
  const steps: BriefLimits[] = [];
  let cur = parts.limits;
  const push = (next: Partial<BriefLimits>) => {
    cur = { ...cur, ...next };
    steps.push(cur);
  };

  for (let n = parts.contextDocs.length - 1; n >= 0; n--) push({ contextDocs: n });
  if (parts.issue?.body) push({ issueBody: false });
  if (parts.blast) {
    push({ blastCallers: false });
    const rows = Math.max(parts.blast.changed_symbols.length, parts.blast.downstream.length);
    for (let n = rows - 1; n >= 0; n--) push({ blastRows: n });
  }
  if (parts.files.length > BRIEF_TRIM_MAX_FILES) push({ files: BRIEF_TRIM_MAX_FILES });
  push({ minimal: true });

  return steps;
}

export interface BriefBudgetResult {
  user: string;
  trimmed: string[];
  /** `count(system + user)` over the string that would be sent. */
  inputTokens: number;
  /** `true` when even the minimal input does not fit — the caller must not spend. */
  overBudget: boolean;
}

/**
 * Walk the rungs until the input fits, re-counting after every one.
 *
 * **What is counted, because AC-10 is explicit about it and the natural code is
 * wrong.** The budget is spent by the system message and the user message
 * TOGETHER, so the system prompt takes its share first and the ladder trims the
 * user parts down to whatever is left. That is why `system` is a parameter here
 * rather than something the caller adds afterwards: a ladder that cannot see the
 * system prompt cannot enforce the criterion, and every check would agree with
 * it while the real total sat above the budget.
 *
 * And it is ONE `count(system + user)` on the joined string, never
 * `count(system) + count(user)`. BPE merges across the join, so the two numbers
 * differ; summing is the more natural code and it is the wrong number. The join
 * is the same one the `messages` array produces, so what is counted is what is
 * sent.
 *
 * `count` is a parameter rather than `container.tokenizer.count` for the reason
 * every rule in this file is: purity. The service passes the real counter; a
 * test passes a deterministic one and can therefore assert a rung.
 */
export function trimToBudget(
  system: string,
  parts: BriefInputParts,
  count: (text: string) => number,
  budget: number,
): BriefBudgetResult {
  let assembled = assembleBriefInput(parts);
  let inputTokens = count(system + assembled.user);
  if (inputTokens <= budget) return { ...assembled, inputTokens, overBudget: false };

  for (const limits of ladderFor(parts)) {
    assembled = assembleBriefInput({ ...parts, limits });
    inputTokens = count(system + assembled.user);
    if (inputTokens <= budget) return { ...assembled, inputTokens, overBudget: false };
  }

  return { ...assembled, inputTokens, overBudget: true };
}

export interface BriefState extends BriefBudgetResult {
  system: string;
  /** SHA-256 hex of `system + user`, AFTER the ladder and of nothing else. */
  stateKey: string;
}

/**
 * Assemble, trim, hash — one function, and the ONLY way to obtain a `state_key`.
 *
 * It is one function rather than three steps at each call site on purpose.
 * AC-05 fixes `state_key` as the hash of the input *after* trimming, so a `read`
 * that skipped the ladder would hash a longer string than the one `generate`
 * stored, mark every brief that needed trimming as stale forever, and never
 * clear no matter how many times the reader pressed Regenerate. It would be
 * invisible in everything we look at — the demo PR's nine files are under
 * `BRIEF_TRIM_MAX_FILES`, so no rung binds there — and would fail first on a
 * large real pull request, in front of a user. Two call sites that agree today
 * are a coincidence; one function they both call is a guarantee.
 */
export function briefStateOf(
  parts: BriefInputParts,
  count: (text: string) => number,
): BriefState {
  const system = BRIEF_SYSTEM_PROMPT;
  const budgeted = trimToBudget(system, parts, count, BRIEF_INPUT_TOKEN_BUDGET);
  return {
    ...budgeted,
    system,
    stateKey: createHash('sha256').update(system + budgeted.user).digest('hex'),
  };
}

// ---- The model's reply, and what is done to it ------------------------------

/**
 * What one generation call must return.
 *
 * `kind`, `severity` and `risk_level` are LOOSE strings rather than the contract
 * enums, for the reason `IntentReplySchema` gives: the default model for this
 * feature runs on OpenRouter, where structured output is a per-endpoint
 * convention rather than an API-level guarantee, and a strict enum turns
 * "Security" into a failed brief and a wasted call. Every one of them is
 * normalised below, where an unrecognised value has a defined and tested
 * outcome instead of an exception.
 */
export const BriefReplySchema = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: z.string(),
  risks: z.array(
    z.object({
      kind: z.string(),
      title: z.string(),
      explanation: z.string(),
      severity: z.string(),
      file_refs: z.array(z.string()),
    }),
  ),
  review_focus: z.array(
    z.object({
      kind: z.string(),
      ref: z.string(),
      line: z.number().nullish(),
      why: z.string(),
    }),
  ),
});
export type BriefReply = z.infer<typeof BriefReplySchema>;

const RISK_KINDS: readonly RiskKind[] = [
  'security',
  'db_migration',
  'breaking_api',
  'perf',
  'deps',
  'other',
];

/** Highest first — the index IS the severity order, so `Math.max` lowers a level. */
const SEVERITY_ORDER: readonly RiskSeverity[] = ['high', 'medium', 'low'];

/**
 * A reply's `kind` as one of the six, or `other`.
 *
 * `other` rather than a rejection because one bad enum value should not throw
 * away a paid call, and `other` rather than the closest-looking neighbour
 * because a mislabelled risk is worse than an unlabelled one: the card's icon
 * would then assert something the model never said.
 */
export function normaliseKind(value: string): RiskKind {
  const lowered = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return RISK_KINDS.includes(lowered as RiskKind) ? (lowered as RiskKind) : 'other';
}

/**
 * A reply's `severity` as one of the three, or `low`.
 *
 * `low` on an unreadable value, deliberately, and it is the same one-directional
 * discipline `settleTier` applies to a confidence tier: a malformed reply must
 * not be able to RAISE an alarm. The risk still ships with its title and its
 * explanation — nothing is thrown away — it simply cannot escalate the brief by
 * being unreadable.
 */
export function normaliseSeverity(value: string): RiskSeverity {
  const lowered = value.trim().toLowerCase();
  return SEVERITY_ORDER.includes(lowered as RiskSeverity) ? (lowered as RiskSeverity) : 'low';
}

/**
 * The reply, in the contract's own types — before grounding, and with nothing
 * dropped yet.
 */
export function normaliseReply(reply: BriefReply): {
  what: string;
  why: string;
  risks: Risk[];
  review_focus: ReviewFocusItem[];
} {
  return {
    what: reply.what,
    why: reply.why,
    risks: reply.risks.map((r) => ({
      kind: normaliseKind(r.kind),
      title: r.title,
      explanation: r.explanation,
      severity: normaliseSeverity(r.severity),
      file_refs: r.file_refs,
    })),
    review_focus: reply.review_focus.map((f) => ({
      kind: f.kind.trim().toLowerCase() === 'endpoint' ? ('endpoint' as const) : ('file' as const),
      ref: f.ref,
      line: typeof f.line === 'number' && f.line > 0 ? Math.trunc(f.line) : null,
      why: f.why,
    })),
  };
}

/**
 * What the model is allowed to name.
 *
 * Two halves, because the two kinds of reference come from two different places
 * and confusing them is how an endpoint gets validated against a file list. The
 * FILE half is the pull request's own files plus every file the blast map named;
 * the ENDPOINT half is what the map says is downstream.
 *
 * A degraded map contributes nothing, which is the whole of AC-23: the allow-list
 * narrows to the changed files and the reason goes to `missing_inputs`.
 */
export interface BriefAllowList {
  files: Set<string>;
  endpoints: Set<string>;
}

export function buildAllowList(
  files: readonly BriefChangedFile[],
  blast: BlastRadiusResponse | null,
): BriefAllowList {
  const allow: BriefAllowList = { files: new Set(), endpoints: new Set() };
  for (const f of files) allow.files.add(f.path);
  if (blast) {
    for (const s of blast.changed_symbols) allow.files.add(s.file);
    for (const d of blast.downstream) {
      for (const c of d.callers) allow.files.add(c.file);
      for (const e of d.endpoints_affected) allow.endpoints.add(e);
      for (const c of d.crons_affected) allow.endpoints.add(c);
    }
  }
  return allow;
}

/**
 * The path half of a file reference.
 *
 * `src/app.ts:42` and `src/app.ts:42-60` both resolve to `src/app.ts`, so a
 * model that helpfully pinned a line does not lose its reference for it.
 *
 * Applied to the FILE half only. An endpoint is matched whole, because a route
 * may legitimately contain a colon (`GET /orders/:id`) and splitting on it would
 * turn every parameterised route into an unmatchable prefix.
 */
function refPath(ref: string): string {
  const colon = ref.indexOf(':');
  return colon < 0 ? ref : ref.slice(0, colon);
}

/**
 * Drop every reference the model invented, and nothing else.
 *
 * The three rules, each of which is a criterion:
 *   - a `file_refs` entry outside the file half is dropped and recorded, and the
 *     risk KEEPS its title and explanation with a shorter list — a real risk
 *     explained without a citation is still worth reading (AC-17, AC-18);
 *   - a `review_focus` item whose `ref` is refused disappears ENTIRELY, because
 *     the whole content of that item is "go and look here" (AC-18);
 *   - nothing is ever re-prompted. A dropped reference costs one line in
 *     `dropped_refs`, never a second paid call (AC-17).
 */
export function groundRefs(
  reply: { risks: Risk[]; review_focus: ReviewFocusItem[] },
  allow: BriefAllowList,
): { risks: Risk[]; review_focus: ReviewFocusItem[]; dropped_refs: string[] } {
  const dropped: string[] = [];
  const drop = (ref: string) => {
    if (!dropped.includes(ref)) dropped.push(ref);
  };

  const risks = reply.risks.map((risk) => ({
    ...risk,
    file_refs: risk.file_refs.filter((ref) => {
      if (allow.files.has(refPath(ref))) return true;
      drop(ref);
      return false;
    }),
  }));

  const review_focus = reply.review_focus.filter((item) => {
    const ok =
      item.kind === 'endpoint'
        ? allow.endpoints.has(item.ref)
        : allow.files.has(refPath(item.ref));
    if (!ok) drop(item.ref);
    return ok;
  });

  return { risks, review_focus, dropped_refs: dropped };
}

/**
 * The level that is actually persisted: the LOWER of what the surviving risks
 * support and what the model suggested.
 *
 * One-directional, and it is `settleTier`'s shape for `settleTier`'s reason. The
 * model may see something the arithmetic cannot — three `medium` risks that
 * compound — and it can lower the level for it; it may never raise one, because
 * a model arguing for its own alarm is exactly the failure a computed level
 * exists to prevent. An unrecognised suggestion is ignored rather than read as
 * `low`: a malformed reply should not move the number in either direction.
 *
 * No surviving risks is `low`, not "unknown". The brief is still worth reading —
 * "nothing here looks risky" is an answer.
 */
export function settleRiskLevel(
  risks: readonly { severity: RiskSeverity }[],
  suggested?: string | null,
): RiskSeverity {
  const computedIdx = risks.reduce(
    (best, r) => Math.min(best, SEVERITY_ORDER.indexOf(r.severity)),
    SEVERITY_ORDER.length - 1,
  );
  const suggestedIdx = SEVERITY_ORDER.indexOf((suggested ?? '').trim().toLowerCase() as RiskSeverity);
  if (suggestedIdx < 0) return SEVERITY_ORDER[computedIdx]!;
  return SEVERITY_ORDER[Math.max(computedIdx, suggestedIdx)]!;
}

/**
 * What changed between two consecutive briefs — computed, never asked for.
 *
 * A model call to say "the risk level went medium → high" would be paying to be
 * told what two rows already say. Risks are compared by title and focus items by
 * `ref`, which are the identities a reader recognises them by on the card.
 *
 * `risk_level_from` / `_to` are both `null` when the level did not move, so the
 * card can render a transition without having to compare them itself.
 */
export function briefDelta(
  newer: Pick<PrBriefRecord, 'risk_level' | 'risks' | 'review_focus'>,
  older: Pick<PrBriefRecord, 'risk_level' | 'risks' | 'review_focus'>,
): PrBriefDelta {
  const moved = newer.risk_level !== older.risk_level;
  const newTitles = newer.risks.map((r) => r.title);
  const oldTitles = older.risks.map((r) => r.title);
  const newRefs = newer.review_focus.map((f) => f.ref);
  const oldRefs = older.review_focus.map((f) => f.ref);

  return {
    risk_level_from: moved ? older.risk_level : null,
    risk_level_to: moved ? newer.risk_level : null,
    risks_added: newTitles.filter((t) => !oldTitles.includes(t)),
    risks_removed: oldTitles.filter((t) => !newTitles.includes(t)),
    focus_added: newRefs.filter((r) => !oldRefs.includes(r)),
    focus_removed: oldRefs.filter((r) => !newRefs.includes(r)),
  };
}

/**
 * The issue this pull request points at, when it points at one DELIBERATELY.
 *
 * A module-local re-implementation of `modules/intent/helpers.ts`'s
 * `extractLinkedIssue`, and for the same reason `withDeadline` below is a local
 * twin: importing it would be the cross-module import the onion guard only
 * WARNS about. Narrower than the original on purpose — the intent layer also
 * understands full issue URLs and ticket words, and it uses what it finds to buy
 * a confidence tier. Here the issue is one more block of context, so the two
 * unambiguous forms are enough and a wider net would only widen the blast radius
 * of a wrong guess.
 *
 * A cross-repository reference is DISCARDED rather than followed: `getIssue`
 * takes this repository's ref, so honouring `other/repo#12` would fetch issue 12
 * of the wrong project — worse than finding nothing.
 */
const LINKED_ISSUE_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi;

export function extractLinkedIssue(
  body: string | null | undefined,
  repoFullName: string,
): number | undefined {
  if (!body) return undefined;
  for (const match of body.matchAll(new RegExp(LINKED_ISSUE_RE.source, 'gi'))) {
    const repo = match[1];
    if (repo && repo.toLowerCase() !== repoFullName.toLowerCase()) continue;
    const n = Number(match[2]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * The Why Timeline, newest first, with each entry's delta against the one below
 * it.
 *
 * `rows` arrives newest first — the order `BriefRepository.timeline` returns —
 * and the OLDEST entry's `delta` is `null` because it has nothing behind it to
 * differ from. Every delta is computed here, from two records; none of it is
 * ever asked of a model.
 */
export function toBriefTimeline(
  rows: readonly { seq: number; record: PrBriefRecord }[],
): PrBriefTimelineEntry[] {
  return rows.map((row, i) => {
    const older = rows[i + 1];
    return {
      seq: row.seq,
      state_key: row.record.state_key,
      head_sha: row.record.head_sha,
      risk_level: row.record.risk_level,
      what: row.record.what,
      generated_at: row.record.generated_at,
      delta: older ? briefDelta(row.record, older.record) : null,
    };
  });
}

/**
 * Stop waiting after `ms`, whatever the caller is doing.
 *
 * A module-local twin of `modules/intent/service.ts`'s `withDeadline`, which is
 * private there. Copied rather than imported, because importing it would be the
 * cross-module import the onion guard only WARNS about, and lifting it into
 * `platform/` would drag `modules/intent` into this change for six lines. The
 * moment a third caller appears, that trade flips.
 *
 * The losing promise is not cancelled — an in-flight HTTP request has no abort
 * handle here — so this bounds how long we WAIT, not how long the work runs.
 */
export async function withDeadline<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${String(ms)}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
