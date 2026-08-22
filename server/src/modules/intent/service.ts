import type { PrIntentRecord, RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { PullRow } from '../../db/rows.js';
import { IntentRepository } from './repository.js';
import {
  DEFAULT_INTENT_MODEL,
  INTENT_ISSUE_TIMEOUT_MS,
  INTENT_SYSTEM_PROMPT,
  INTENT_TIMEOUT_MS,
  MAX_CHANGED_PATHS,
  MAX_COMMIT_MESSAGES,
  MAX_PLAN_FILE_CHARS,
} from './constants.js';
import {
  IntentReplySchema,
  buildIntentPrompt,
  extractLinkedIssue,
  extractPlanPaths,
  isSubstantiveBody,
  normalizeEvidence,
  normalizeKind,
  renderIntentForPrompt,
  scoreForTier,
  settleTier,
  tierFromSources,
  toIntentDto,
} from './helpers.js';
import type { IntentPromptInput } from './helpers.js';

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
   * means the claim was made about different code. `changedPaths` comes from the
   * caller because the review path already holds the loaded diff — `pr_files` can
   * be empty for a PR whose diff loaded perfectly, since `loadDiff` prefers a real
   * `git diff` and only falls back to that table.
   */
  async forReview(
    workspaceId: string,
    pull: PullRow,
    changedPaths: string[],
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
    const { record, logLine } = await this.deriveFor(workspaceId, pull, changedPaths);
    return { ...this.render(record), record, cached: false, logLine };
  }

  /**
   * Derive (or re-derive) and persist. The `POST` path, where no diff is in hand,
   * so changed paths come from `pr_files`.
   */
  async derive(workspaceId: string, prId: string): Promise<PrIntentRecord> {
    const pull = await this.requirePull(workspaceId, prId);
    const files = await this.container.reviewRepo.getPrFiles(prId);
    const { record } = await this.deriveFor(
      workspaceId,
      pull,
      files.map((f) => f.path),
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
    changedPaths: string[],
  ): Promise<{ record: PrIntentRecord; logLine: string }> {
    const started = Date.now();
    const repo = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    const { input, sources, notes } = await this.gather(pull, repo.fullName, ref, changedPaths);

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
        `${choice.provider}/${choice.model}, ${cost}${notes.length ? `; ${notes.join('; ')}` : ''}`,
    };
  }

  /**
   * Collect what the model is allowed to see, strongest evidence first.
   *
   * Every source is best-effort: one that cannot be read is skipped, never fatal.
   * A missing GitHub token drops the linked issue and nothing else, and a PR with
   * no documentation at all still derives — from its title, commits, branch and
   * changed paths — and simply earns a lower tier. `notes` carries the things a
   * reader would otherwise have to guess at, so an unexplained `low` never
   * reaches the UI.
   */
  private async gather(
    pull: PullRow,
    repoFullName: string,
    ref: RepoRef,
    changedPaths: string[],
  ): Promise<{ input: IntentPromptInput; sources: PrIntentRecord['sources']; notes: string[] }> {
    const sources: PrIntentRecord['sources'] = [];
    const notes: string[] = [];

    const planFiles: { path: string; text: string }[] = [];
    for (const path of extractPlanPaths(pull.body)) {
      const text = await this.readOrSkip(ref, path);
      if (text) planFiles.push({ path, text: text.slice(0, MAX_PLAN_FILE_CHARS) });
      else notes.push(`plan file ${path} named in the body but not readable from the clone`);
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
        notes.push(`issue #${issueNumber} is linked but could not be read (${(err as Error).message})`);
      }
    }

    if (!pull.body) {
      // pull_requests.body is written only by GET /pulls/:id, so a PR nobody has
      // opened legitimately has none. Say so — an unexplained low tier reads as a
      // broken feature.
      notes.push('the PR has no stored description (open the PR detail once to sync it)');
    } else if (isSubstantiveBody(pull.body)) {
      sources.push('pr_body');
    } else {
      notes.push('the description is a template with nothing filled in');
    }

    sources.push('pr_title');
    const commitMessages = await this.repo.commitMessages(pull.id, MAX_COMMIT_MESSAGES);
    if (commitMessages.length > 0) sources.push('commits');
    if (pull.branch) sources.push('branch');
    if (changedPaths.length > 0) sources.push('file_paths');

    return {
      input: {
        title: pull.title,
        branch: pull.branch,
        body: pull.body,
        planFiles,
        ...(issue ? { issue } : {}),
        commitMessages,
        changedPaths: changedPaths.slice(0, MAX_CHANGED_PATHS),
      },
      sources,
      notes,
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
