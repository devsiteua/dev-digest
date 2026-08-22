/**
 * Pure helpers for the intent layer (side-effect free; operate purely on their
 * arguments — no DB, no network, no `this`).
 *
 * Everything that decides WHAT the model is shown, and everything that decides
 * how much its answer is worth, lives here. The service does I/O and calls these;
 * that split is what lets the interesting cases — a traversal attempt in a PR
 * body, a model trying to talk its confidence up — be tested without a database.
 */
import { z } from 'zod';
import type {
  IntentConfidenceTier,
  IntentEvidence,
  IntentKind,
  IntentSource,
  PrIntentRecord,
  UnifiedDiff,
} from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { PrIntentRow } from '../../db/rows.js';
import {
  ALLOWED_DOC_EXTENSIONS,
  BOILERPLATE_DOC_NAMES,
  DOC_PATH_RE,
  GITHUB_BLOB_URL_RE,
  ISSUE_URL_RE,
  LINKED_ISSUE_RE,
  MAX_CHANGED_PATHS,
  MAX_COMMIT_MESSAGES,
  MAX_EVIDENCE_CHARS,
  MAX_EVIDENCE_ITEMS,
  MAX_HUNK_HEADERS_PER_FILE,
  MAX_PLAN_FILES,
  MIN_SUBSTANTIVE_BODY_CHARS,
  TICKET_REF_RE,
  TIER_ORDER,
  TIER_SCORE,
} from './constants.js';

/**
 * A private copy of a module-level regex.
 *
 * `LINKED_ISSUE_RE` and `DOC_PATH_RE` are global, and a global regex carries
 * `lastIndex` between uses. Sharing one across calls makes the SECOND call on the
 * same body start mid-string and find nothing — a bug that only appears once the
 * function is called twice, which a single-case test never reaches.
 */
const fresh = (re: RegExp): RegExp => new RegExp(re.source, re.flags);

/** Everything that looks like an absolute URL, removed before path scanning. */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

// ---- Source resolution ------------------------------------------------------

/**
 * Is this a path we are willing to hand to `git.readFile`?
 *
 * `SimpleGitClient.readFile` does `join(clonePath, path)` with no validation of
 * its own, so a body containing `../../../.ssh/id_rsa.md` would read outside the
 * clone. This function is the only thing standing between an author-controlled
 * string and the filesystem, which is why it rejects by rule rather than trying
 * to sanitise: there is no repair for a path that wanted to escape.
 */
function isSafeDocPath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false;
  if (path.startsWith('/') || path.startsWith('~')) return false;
  if (path.includes('\\') || path.includes('\0')) return false;
  if (path.includes('://')) return false;
  // `..` climbs out; `.` is noise that only ever obscures the segment before it.
  if (path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return false;
  const lower = path.toLowerCase();
  return ALLOWED_DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Is this document a PLAN, or is it the repository's own furniture?
 *
 * A directory segment is the signal: the author navigated somewhere to name the
 * file. At the root, only a name outside the boilerplate set qualifies — a body
 * saying "updated README.md" was buying `high` confidence with no plan in sight,
 * because `DOC_PATH_RE` matches any `.md`. `docs/README.md` still reads.
 */
function isPlanDocPath(path: string): boolean {
  if (path.includes('/')) return true;
  const base = path.slice(0, path.lastIndexOf('.')).toUpperCase();
  return !BOILERPLATE_DOC_NAMES.includes(base);
}

/**
 * Repo-relative document paths a PR body points at, de-duplicated and capped.
 *
 * URLs are stripped BEFORE scanning rather than filtered after: left in,
 * `https://evil.example/plan.md` yields the token `plan.md`, which is a perfectly
 * valid repo-relative path and would be read from the clone. The link would have
 * silently become a local file read of a different file entirely.
 *
 * The ONE exception runs before that strip: a `blob` URL into THIS repository's
 * own tree is translated to the path it names. Nothing is fetched — the path is
 * read from the clone, exactly as a prose path is. The ordering is the delicate
 * part, because it is the only way "a remote URL became a local read" could come
 * back, so the translation is gated on an exact `owner/repo` match and every
 * other URL still meets the strip untouched.
 *
 * `repoFullName` is optional: without it nothing can be established as this
 * repository, so no URL is translated and the function behaves exactly as it did
 * before blob URLs were understood.
 */
export function extractPlanPaths(body?: string | null, repoFullName?: string): string[] {
  if (!body) return [];
  const out: string[] = [];
  const take = (path: string): boolean => {
    if (!isSafeDocPath(path) || !isPlanDocPath(path)) return false;
    if (!out.includes(path)) out.push(path);
    return out.length >= MAX_PLAN_FILES;
  };

  // Deliberate links first, so the cap spends itself on what the author took the
  // trouble to link rather than on the first `.md` token in their prose.
  if (repoFullName) {
    for (const match of body.matchAll(fresh(GITHUB_BLOB_URL_RE))) {
      if (match[1]!.toLowerCase() !== repoFullName.toLowerCase()) continue;
      if (take(match[2]!)) return out;
    }
  }

  const withoutUrls = body.replace(fresh(URL_RE), ' ');
  for (const match of withoutUrls.matchAll(fresh(DOC_PATH_RE))) {
    if (take(match[0])) break;
  }
  return out;
}

/**
 * The number an issue reference in `body` points at, for THIS repository.
 *
 * All three patterns lay their captures out the same way — 1/2 from a URL, 3/4
 * from a shorthand — so one loop reads any of them.
 */
function firstIssueIn(re: RegExp, body: string, repoFullName: string): number | undefined {
  for (const match of body.matchAll(fresh(re))) {
    const repo = match[1] ?? match[3];
    const num = match[2] ?? match[4];
    if (!num) continue;
    if (repo && repo.toLowerCase() !== repoFullName.toLowerCase()) continue;
    const n = Number(num);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * The issue this PR points at, when it points at one DELIBERATELY.
 *
 * Three forms, strongest claim first: a closing keyword, a ticket word, and a
 * full issue URL standing on its own. Round 1 accepted only the first and gave
 * the right reason for it — an unverified claim has no business raising a
 * confidence tier — attached to the wrong rule. What has to be excluded is the
 * passing mention (`see #5`), not the tracker spelling: an author who writes
 * `Ticket: #471` pointed at that issue every bit as deliberately as one who
 * wrote `Closes #471`, and the tier they buy is paid for by the FETCH
 * succeeding, never by the wording.
 *
 * A cross-repo reference is DISCARDED rather than followed: `getIssue(repo, n)`
 * takes this repository's ref, so honouring `other/repo#12` would fetch issue 12
 * of the wrong project under the right number — worse than finding nothing,
 * because it would then buy `high` confidence with someone else's text. What was
 * discarded is reported by `extractForeignRefs` rather than forgotten.
 */
export function extractLinkedIssue(
  body: string | null | undefined,
  repoFullName: string,
): number | undefined {
  if (!body) return undefined;
  for (const re of [LINKED_ISSUE_RE, TICKET_REF_RE, ISSUE_URL_RE]) {
    const found = firstIssueIn(re, body, repoFullName);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * References the body makes to material in ANOTHER repository.
 *
 * Named, deliberate, and unfollowable: this layer fetches nothing over the
 * network and reads only the clone under review, so someone else's issue and
 * someone else's file are both out of reach. Saying so is the point — the
 * alternative is a derivation that quietly ignored the one document the author
 * pointed at, and a `low` tier nobody can explain.
 */
export function extractForeignRefs(
  body: string | null | undefined,
  repoFullName: string,
): string[] {
  if (!body) return [];
  const out: string[] = [];
  const add = (note: string) => {
    if (!out.includes(note)) out.push(note);
  };
  const mine = repoFullName.toLowerCase();

  for (const re of [LINKED_ISSUE_RE, TICKET_REF_RE, ISSUE_URL_RE]) {
    for (const match of body.matchAll(fresh(re))) {
      const repo = match[1] ?? match[3];
      const num = match[2] ?? match[4];
      if (!repo || !num || repo.toLowerCase() === mine) continue;
      add(`issue ${repo}#${num} is referenced but belongs to another repository`);
    }
  }
  for (const match of body.matchAll(fresh(GITHUB_BLOB_URL_RE))) {
    if (match[1]!.toLowerCase() === mine) continue;
    add(`${match[1]}/${match[2]} is linked but belongs to another repository`);
  }
  return out;
}

/**
 * The body with the parts nobody wrote removed — HTML comments (a PR template's
 * instructions to the author) and unticked checklist rows (the boxes they did not
 * fill in). What is left is the author's own prose.
 */
export function substantiveBodyText(body?: string | null): string {
  if (!body) return '';
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*[-*][ \t]*\[[ ]\][ \t].*$/gm, '')
    .trim();
}

/** Is the body evidence, or is it an untouched template? */
export function isSubstantiveBody(body?: string | null): boolean {
  return substantiveBodyText(body).length >= MIN_SUBSTANTIVE_BODY_CHARS;
}

// ---- Changed files ----------------------------------------------------------

/**
 * One changed file as the classifier is shown it: its path, how much of it
 * moved, and where.
 *
 * `hunkHeaders` holds `@@ … @@` lines and NOTHING else. That is the whole point
 * of the shape — the classifier is told the geometry of the change without
 * being told its content, which is what the brief means by "change bodies are
 * not sent" and what keeps a flash-class model the right tool for the job.
 */
export interface IntentChangedFile {
  path: string;
  additions: number;
  deletions: number;
  hunkHeaders: string[];
}

/**
 * The changed files of a loaded diff, with each hunk's header SYNTHESISED.
 *
 * `diff-parser.ts` reads the four numbers out of a header and throws the header
 * text away, so there is nothing to quote — the string is rebuilt here. What is
 * rebuilt is the whole header GitHub renders, minus its optional trailing
 * section heading, which the parser never captured and we therefore never had.
 */
export function changedFilesFromDiff(files: UnifiedDiff['files']): IntentChangedFile[] {
  return files.map((file) => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    hunkHeaders: file.hunks.map(
      (h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    ),
  }));
}

/**
 * The headers of a stored `pr_files.patch`, quoted verbatim.
 *
 * The `POST` path has no loaded diff, so the headers come from the column — by
 * keeping ONLY lines that start `@@ `. An allow-list, not a filter of the lines
 * we do not want: a patch is author-adjacent text, and "everything except `+`
 * and `-`" would still let a context line through, which is a change body by
 * another name.
 *
 * A null patch yields an empty list rather than a skipped file
 * (`db/schema/pulls.ts:44` — the column is nullable, and a row without one
 * still contributes its path and its `+a/-d` counts).
 */
export function hunkHeadersFromPatch(patch?: string | null): string[] {
  if (!patch) return [];
  return patch.split('\n').filter((line) => line.startsWith('@@ '));
}

/**
 * The `## Changed files` block's body: a path with its counts, then its hunk
 * headers, indented under it.
 *
 * Both caps live here rather than at each call site, so the two paths into this
 * block — a loaded diff and a stored patch — cannot disagree about how much a
 * derivation is allowed to cost.
 */
export function renderChangedFiles(files: readonly IntentChangedFile[]): string {
  const lines: string[] = [];
  for (const file of files.slice(0, MAX_CHANGED_PATHS)) {
    lines.push(`${file.path} (+${file.additions}/-${file.deletions})`);
    for (const header of file.hunkHeaders.slice(0, MAX_HUNK_HEADERS_PER_FILE)) {
      lines.push(`  ${header}`);
    }
    const hidden = file.hunkHeaders.length - MAX_HUNK_HEADERS_PER_FILE;
    if (hidden > 0) lines.push(`  … ${hidden} more hunk(s)`);
  }
  return lines.join('\n');
}

// ---- Confidence -------------------------------------------------------------

/**
 * The tier the EVIDENCE supports — computed from which sources were found, never
 * reported by the model.
 *
 * Documentation the author pointed at deliberately (`plan_file`, `linked_issue`)
 * says why the change is being made. Their own prose is a claim about it. Signals
 * derived from the change itself — title, commits, branch, paths — describe what
 * moved, and a description of what moved is not a statement of intent.
 */
export function tierFromSources(sources: readonly IntentSource[]): IntentConfidenceTier {
  if (sources.includes('plan_file') || sources.includes('linked_issue')) return 'high';
  if (sources.includes('pr_body')) return 'medium';
  return 'low';
}

/**
 * The tier that is actually persisted: the LOWER of what the evidence supports
 * and what the model suggested.
 *
 * One-directional on purpose. The model can see something the ladder cannot — a
 * linked issue that turns out to describe a different change, a spec that
 * contradicts the diff — and lower the tier for it. It cannot raise one, because
 * a model arguing for its own confidence is the failure the ladder exists to
 * avoid. An unrecognised suggestion is ignored rather than treated as `low`: a
 * malformed reply should not be able to move the number either way.
 */
export function settleTier(
  fromEvidence: IntentConfidenceTier,
  suggested?: string | null,
): IntentConfidenceTier {
  const suggestedIdx = TIER_ORDER.indexOf(suggested as IntentConfidenceTier);
  if (suggestedIdx < 0) return fromEvidence;
  const evidenceIdx = TIER_ORDER.indexOf(fromEvidence);
  return TIER_ORDER[Math.min(evidenceIdx, suggestedIdx)]!;
}

/** The number that goes next to the tier. Never computed independently of it. */
export function scoreForTier(tier: IntentConfidenceTier): number {
  return TIER_SCORE[tier];
}

/** Trim a model's evidence list to what a card can show and a row should store. */
export function clampEvidence(evidence: IntentEvidence[] | undefined): IntentEvidence[] {
  if (!evidence?.length) return [];
  return evidence.slice(0, MAX_EVIDENCE_ITEMS).map((e) => ({
    source: e.source,
    ref: e.ref.slice(0, MAX_EVIDENCE_CHARS),
    quote: e.quote.slice(0, MAX_EVIDENCE_CHARS),
  }));
}

// ---- The model call ---------------------------------------------------------

/**
 * What one derivation call must return.
 *
 * `kind` and `suggested_confidence` are LOOSE strings rather than the contract
 * enums, deliberately. The default model for this feature runs on OpenRouter,
 * where structured output is a per-endpoint convention rather than an API-level
 * guarantee (see `DEFAULT_INTENT_MODEL`), and a strict enum turns "Feature"
 * instead of "feature" into a failed derivation and a degraded review. They are
 * normalised below, where an unrecognised value has a defined, tested outcome
 * instead of an exception.
 */
export const IntentReplySchema = z.object({
  kind: z.string(),
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  evidence: z.array(z.object({ source: z.string(), ref: z.string(), quote: z.string() })),
  suggested_confidence: z.string(),
});
export type IntentReply = z.infer<typeof IntentReplySchema>;

const KINDS: readonly IntentKind[] = [
  'feature',
  'fix',
  'refactor',
  'perf',
  'docs',
  'test',
  'chore',
  'deps',
  'revert',
  'mixed',
];

const SOURCES: readonly IntentSource[] = [
  'plan_file',
  'linked_issue',
  'pr_body',
  'pr_title',
  'commits',
  'branch',
  'file_paths',
];

/**
 * A model's `kind` mapped onto the taxonomy.
 *
 * Falls back to `mixed` rather than throwing: `mixed` is the honest answer for
 * "this does not fit one label", which is also true of a reply we could not read.
 */
export function normalizeKind(value: string | null | undefined): IntentKind {
  const v = (value ?? '').trim().toLowerCase();
  return (KINDS as readonly string[]).includes(v) ? (v as IntentKind) : 'mixed';
}

/** Drop evidence rows whose `source` is not one of ours before persisting. */
export function normalizeEvidence(rows: IntentReply['evidence']): IntentEvidence[] {
  return clampEvidence(
    rows
      .filter((r) => (SOURCES as readonly string[]).includes(r.source))
      .map((r) => ({ source: r.source as IntentSource, ref: r.ref, quote: r.quote })),
  );
}

export interface IntentPromptInput {
  title: string;
  branch: string;
  body?: string | null;
  planFiles: { path: string; text: string }[];
  issue?: { number: number; title: string; body?: string | null };
  commitMessages: string[];
  changedFiles: IntentChangedFile[];
  /** What was named or expected and could not be read. OURS, so never wrapped. */
  missingContext: string[];
}

/**
 * The user message for the one derivation call.
 *
 * Every block is author-controlled and therefore wrapped. Order is strongest
 * evidence first, so a model reading top-down meets the documents the author
 * pointed at before their own summary of them.
 */
export function buildIntentPrompt(input: IntentPromptInput): string {
  const sections: string[] = [
    `Pull request: "${input.title}" on branch \`${input.branch}\`.`,
  ];

  for (const file of input.planFiles) {
    sections.push(`## Plan or spec the PR points at: ${file.path}\n${wrapUntrusted(`plan:${file.path}`, file.text)}`);
  }
  if (input.issue) {
    sections.push(
      `## Linked issue #${input.issue.number}\n` +
        wrapUntrusted(
          `issue:${input.issue.number}`,
          `${input.issue.title}\n\n${input.issue.body ?? ''}`,
        ),
    );
  }
  if (input.body) {
    sections.push(`## PR description\n${wrapUntrusted('pr-body', input.body)}`);
  }
  if (input.commitMessages.length > 0) {
    sections.push(
      `## Commit subjects\n` +
        wrapUntrusted('commits', input.commitMessages.slice(0, MAX_COMMIT_MESSAGES).join('\n')),
    );
  }
  if (input.changedFiles.length > 0) {
    sections.push(
      `## Changed files — path (+added/-deleted) and its hunk headers\n` +
        wrapUntrusted('paths', renderChangedFiles(input.changedFiles)),
    );
  }

  if (input.missingContext.length > 0) {
    // NOT wrapped: these sentences are ours, not the author's, and the whole
    // point of the block is that the model should ACT on it — a wrapped block is
    // one the system prompt has just told it to treat as inert data.
    sections.push(
      '## Context that is missing\n' +
        'Each line below was named by the pull request, or expected by this derivation, and ' +
        'could not be read. Do not reconstruct what it might have said, do not infer an intent ' +
        'from its filename or its issue number, and lower your suggested confidence for it.\n' +
        input.missingContext.map((note) => `- ${note}`).join('\n'),
    );
  }

  sections.push(
    'State the kind of change, one sentence of intent in the author’s terms, what they claim ' +
      'is in scope, what they claim is out of scope, the evidence you used, and the confidence ' +
      'that evidence deserves.',
  );
  return sections.join('\n\n');
}

// ---- Rendering --------------------------------------------------------------

/**
 * The two strings the review prompt's intent slot takes.
 *
 * `intent` is the DISTILLATION and nothing else: no body, no issue text, no spec
 * file. The reviewing prompt already carries the PR description in its own
 * section, so re-sending the sources here would pay twice for one fact — and the
 * cheap model earns its place precisely by replacing them with three lines.
 *
 * `note` is ours, so it is rendered outside the untrusted block. It says how much
 * the claim is worth and, explicitly, that a claim is all it is.
 */
export function renderIntentForPrompt(record: {
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
  kind: IntentKind;
  confidence_tier: IntentConfidenceTier;
  sources: IntentSource[];
  missing_context: string[];
}): { intent: string; note: string } {
  const lines = [`Kind: ${record.kind}`, `Intent: ${record.intent}`];
  if (record.in_scope.length > 0) {
    lines.push('Claimed in scope:', ...record.in_scope.map((s) => `- ${s}`));
  }
  if (record.out_of_scope.length > 0) {
    lines.push('Claimed out of scope:', ...record.out_of_scope.map((s) => `- ${s}`));
  }
  // Inside the distillation rather than the trusted note, for two reasons. It is
  // part of what the derivation found, so a reviewer reading the wrapped block
  // must see that the claim above was made without something the PR pointed at.
  // And each line QUOTES author-controlled text — a path out of the body, an
  // issue number, an adapter's error string — which is precisely what the
  // trusted region must not carry: `specs/ignore-all-previous-rules.md` is a
  // path this repository's own validator accepts.
  if (record.missing_context.length > 0) {
    lines.push('Missing context:', ...record.missing_context.map((s) => `- ${s}`));
  }
  const note =
    `Derived from ${record.sources.join(', ') || 'no stated documentation'} — ` +
    `confidence ${record.confidence_tier}. This is what the PR claims about itself, ` +
    `not a verified fact, and it never narrows what you review.`;
  return { intent: lines.join('\n'), note };
}

/** Persisted row → the transport shape. */
export function toIntentDto(row: PrIntentRow): PrIntentRecord {
  return {
    pr_id: row.prId,
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    kind: row.kind as IntentKind,
    confidence: row.confidence,
    confidence_tier: row.confidenceTier as IntentConfidenceTier,
    sources: row.sources as IntentSource[],
    evidence: row.evidence as IntentEvidence[],
    missing_context: row.missingContext,
    provider: row.provider as PrIntentRecord['provider'],
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    duration_ms: row.durationMs,
    head_sha: row.headSha,
    generated_at: row.generatedAt.toISOString(),
  };
}
