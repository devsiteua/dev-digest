import type { PrIntentRecord, RepoRef, UnifiedDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { PullRow } from '../../db/rows.js';
import { IntentRepository } from './repository.js';
import {
  DEFAULT_INTENT_MODEL,
  INTENT_ISSUE_TIMEOUT_MS,
  INTENT_SYSTEM_PROMPT,
  INTENT_TIMEOUT_MS,
  MAX_COMMIT_MESSAGES,
  MAX_PLAN_FILE_CHARS,
} from './constants.js';
import {
  IntentReplySchema,
  buildIntentPrompt,
  changedFilesFromDiff,
  extractLinkedIssue,
  extractForeignRefs,
  extractPlanPaths,
  hunkHeadersFromPatch,
  isSubstantiveBody,
  normalizeEvidence,
  normalizeKind,
  renderIntentForPrompt,
  scoreForTier,
  settleTier,
  tierFromSources,
  toIntentDto,
} from './helpers.js';
import type { IntentChangedFile, IntentPromptInput } from './helpers.js';

/**
 * The intent layer — what a pull request is TRYING to do, derived before it is
 * reviewed.
 *
 * One pass is: gather (ports), rate the evidence (code), ask a cheap model ONCE,
 * clamp what it said (code), persist. The model contributes wording; it never
 * decides how much its own wording is worth — `settleTier` only ever lowers.
 *
 * No SQL, no Fastify, no `src/adapters/**`: documents arrive through
 * `container.git`, the linked issue through `container.github()`, the model
 * through `container.llm`, and the PR itself through `container.reviewRepo`.
 * That is what lets the whole flow run against `MockLLMProvider` + `MockGitClient`.
 */
export type IntentApi = Pick<IntentService, 'derive' | 'get' | 'forReview'>;

/** What the review path needs: the record plus the two prompt strings. */
export interface IntentForReview {
  record: PrIntentRecord;
  /** Untrusted distillation for the prompt's intent slot. */
  intent: string;
  /** Trusted one-line confidence note, rendered above the wrap. */
  note: string;
  /** True when the persisted row was reused and no model was called. */
  cached: boolean;
  /** One line for the Live Log — always says how this intent came to exist. */
  logLine: string;
}

/**
 * Stop waiting after `ms`, whatever the caller is doing.
 *
 * The losing promise is not cancelled — an in-flight HTTP request has no abort
 * handle here — so this bounds how long we WAIT, not how long the work runs. That
 * is the property review pre-work actually needs: the batch must start on time,
 * and an enrichment nobody is waiting for any more costs nothing.
 */
async function withDeadline<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class IntentService {
  private repo: IntentRepository;

  constructor(private container: Container) {
    this.repo = new IntentRepository(container.db);
  }

  /** The persisted intent for a PR, or undefined when it was never derived. */
  async get(workspaceId: string, prId: string): Promise<PrIntentRecord | undefined> {
    await this.requirePull(workspaceId, prId);
    const row = await this.repo.get(prId);
    return row ? toIntentDto(row) : undefined;
  }

  /**
   * The cache-aware entry point for a review run.
   *
   * Reuses the persisted row while it still matches the PR's head; a moved head
   * means the claim was made about different code. The diff's files come from the
   * caller because the review path already holds the loaded diff — `pr_files` can
   * be empty for a PR whose diff loaded perfectly, since `loadDiff` prefers a real
   * `git diff` and only falls back to that table.
   *
   * The caller hands over `UnifiedDiff['files']` rather than the mapped shape so
   * that the two ways a hunk header can come to exist — synthesised from a parsed
   * diff, quoted from a stored patch — both live in this module's helpers and are
   * covered by one unit suite. `run-executor.ts` therefore passes `diff.files`
   * unchanged and never learns what a header looks like.
   */
  async forReview(
    workspaceId: string,
    pull: PullRow,
    diffFiles: UnifiedDiff['files'],
  ): Promise<IntentForReview> {
    const existing = await this.repo.get(pull.id);
    if (existing && existing.headSha === pull.headSha) {
      const record = toIntentDto(existing);
      return {
        ...this.render(record),
        record,
        cached: true,
        logLine: `intent: cache hit — head unchanged (${record.confidence_tier} confidence, ${record.sources.join(', ') || 'no sources'})`,
      };
    }
    const { record, logLine } = await this.deriveFor(
      workspaceId,
      pull,
      changedFilesFromDiff(diffFiles),
    );
    return { ...this.render(record), record, cached: false, logLine };
  }

  /**
   * Derive (or re-derive) and persist. The `POST` path, where no diff is in hand,
   * so the changed files — and their hunk headers — come from `pr_files`.
   */
  async derive(workspaceId: string, prId: string): Promise<PrIntentRecord> {
    const pull = await this.requirePull(workspaceId, prId);
    const files = await this.container.reviewRepo.getPrFiles(prId);
    const { record } = await this.deriveFor(
      workspaceId,
      pull,
      files.map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        hunkHeaders: hunkHeadersFromPatch(f.patch),
      })),
    );
    return record;
  }

  // ===========================================================================

  private render(record: PrIntentRecord): { intent: string; note: string } {
    return renderIntentForPrompt({
      intent: record.intent,
      in_scope: record.in_scope,
      out_of_scope: record.out_of_scope,
      kind: record.kind,
      confidence_tier: record.confidence_tier,
      sources: record.sources,
      missing_context: record.missing_context,
    });
  }

  private async requirePull(workspaceId: string, prId: string): Promise<PullRow> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  private async deriveFor(
    workspaceId: string,
    pull: PullRow,
    changedFiles: IntentChangedFile[],
  ): Promise<{ record: PrIntentRecord; logLine: string }> {
    const started = Date.now();
    const repo = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    const { input, sources, missingContext } = await this.gather(
      pull,
      repo.fullName,
      ref,
      changedFiles,
    );

    // The tier the EVIDENCE supports, decided before the model is asked anything.
    const evidenceTier = tierFromSources(sources);

    const choice =
      (await this.container.featureModelOverride(workspaceId, 'review_intent')) ??
      DEFAULT_INTENT_MODEL;
    const llm = await this.container.llm(choice.provider);
    const reply = await llm.completeStructured({
      model: choice.model,
      schema: IntentReplySchema,
      schemaName: 'PrIntent',
      messages: [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        { role: 'user', content: buildIntentPrompt(input) },
      ],
      temperature: 0,
      timeoutMs: INTENT_TIMEOUT_MS,
    });

    const tier = settleTier(evidenceTier, reply.data.suggested_confidence);
    const row = await this.repo.upsert({
      prId: pull.id,
      intent: reply.data.intent,
      inScope: reply.data.in_scope,
      outOfScope: reply.data.out_of_scope,
      kind: normalizeKind(reply.data.kind),
      confidence: scoreForTier(tier),
      confidenceTier: tier,
      sources,
      evidence: normalizeEvidence(reply.data.evidence),
      missingContext,
      provider: choice.provider,
      model: choice.model,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      costUsd: reply.costUsd,
      durationMs: Date.now() - started,
      headSha: pull.headSha,
    });

    const lowered = tier !== evidenceTier ? `, lowered from ${evidenceTier} by the model` : '';
    const cost = row.costUsd == null ? 'unpriced' : `$${row.costUsd.toFixed(4)}`;
    return {
      record: toIntentDto(row),
      logLine:
        `intent: derived from ${sources.join(', ')} — ${tier} confidence${lowered}; ` +
        `${choice.provider}/${choice.model}, ${cost}` +
        `${missingContext.length ? `; missing context — ${missingContext.join('; ')}` : ''}`,
    };
  }

  /**
   * Collect what the model is allowed to see, strongest evidence first.
   *
   * Every source is best-effort: one that cannot be read is skipped, never fatal.
   * A missing GitHub token drops the linked issue and nothing else, and a PR with
   * no documentation at all still derives — from its title, commits, branch and
   * changed paths — and simply earns a lower tier.
   *
   * What could NOT be read is collected rather than discarded. Round 1 computed
   * these sentences and dropped them on the `POST` path, which left no reader of
   * a row able to tell "the author explained nothing" from "the author explained
   * it in a file we could not open". They are persisted, shown to the classifier
   * as a do-not-reconstruct block, rendered into the reviewer's intent slot and
   * put on the card — the brief's "an unreachable link must not be silently
   * replaced with invention".
   */
  private async gather(
    pull: PullRow,
    repoFullName: string,
    ref: RepoRef,
    changedFiles: IntentChangedFile[],
  ): Promise<{
    input: IntentPromptInput;
    sources: PrIntentRecord['sources'];
    missingContext: string[];
  }> {
    const sources: PrIntentRecord['sources'] = [];
    const missingContext: string[] = [];

    // Named, deliberate and out of reach — someone else's issue, someone else's
    // file. Collected first so the card lists them in the order the body did.
    missingContext.push(...extractForeignRefs(pull.body, repoFullName));

    const planFiles: { path: string; text: string }[] = [];
    for (const path of extractPlanPaths(pull.body, repoFullName)) {
      const text = await this.readOrSkip(ref, path);
      if (text) planFiles.push({ path, text: text.slice(0, MAX_PLAN_FILE_CHARS) });
      else {
        missingContext.push(`plan file ${path} named in the body but not readable from the clone`);
      }
    }
    if (planFiles.length > 0) sources.push('plan_file');

    let issue: IntentPromptInput['issue'];
    const issueNumber = extractLinkedIssue(pull.body, repoFullName);
    if (issueNumber !== undefined) {
      try {
        const gh = await this.container.github();
        const meta = await withDeadline(INTENT_ISSUE_TIMEOUT_MS, () => gh.getIssue(ref, issueNumber));
        issue = { number: meta.number, title: meta.title, body: meta.body };
        sources.push('linked_issue');
      } catch (err) {
        missingContext.push(
          `issue #${issueNumber} is linked but could not be read (${(err as Error).message})`,
        );
      }
    }

    if (!pull.body) {
      // pull_requests.body is written only by GET /pulls/:id, so a PR nobody has
      // opened legitimately has none. Say so — an unexplained low tier reads as a
      // broken feature.
      missingContext.push('the PR has no stored description (open the PR detail once to sync it)');
    } else if (isSubstantiveBody(pull.body)) {
      sources.push('pr_body');
    } else {
      // Covers both shapes this can take — an untouched template, and a
      // genuinely one-line description — because the seed's demo PR is the
      // second, and a note calling it a template would be a sentence the code
      // cannot honestly reproduce.
      //
      // Deliberately quotes no number. `MIN_SUBSTANTIVE_BODY_CHARS` is a value
      // this repository expects to revise once real derivations settle it, and a
      // threshold spelled into a persisted sentence would be a second copy of it
      // — one that `seed.ts` also holds and nothing keeps in step.
      missingContext.push(
        'the description is too short to state an intent (a template’s boilerplate does not count)',
      );
    }

    sources.push('pr_title');
    const commitMessages = await this.repo.commitMessages(pull.id, MAX_COMMIT_MESSAGES);
    if (commitMessages.length > 0) sources.push('commits');
    if (pull.branch) sources.push('branch');
    if (changedFiles.length > 0) sources.push('file_paths');

    return {
      input: {
        title: pull.title,
        branch: pull.branch,
        body: pull.body,
        planFiles,
        ...(issue ? { issue } : {}),
        commitMessages,
        // Capped by `renderChangedFiles`, so the diff path and the `pr_files`
        // path cannot disagree about how much one derivation may cost.
        changedFiles,
        missingContext,
      },
      sources,
      missingContext,
    };
  }

  private async readOrSkip(ref: RepoRef, path: string): Promise<string | undefined> {
    try {
      const text = await this.container.git.readFile(ref, path);
      return text.trim().length > 0 ? text : undefined;
    } catch {
      return undefined;
    }
  }
}
