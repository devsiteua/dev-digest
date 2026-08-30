import {
  PrBriefRecord,
  type BlastRadiusResponse,
  type PrBriefResponse,
} from '@devdigest/shared';
import type { PullRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { BriefRepository } from './repository.js';
import {
  BRIEF_ISSUE_TIMEOUT_MS,
  BRIEF_MAX_FOCUS,
  BRIEF_MAX_HISTORY,
  BRIEF_MAX_RISKS,
  BRIEF_MODEL,
  BRIEF_TIMEOUT_MS,
} from './constants.js';
import {
  BRIEF_LIMITS_NONE,
  BriefReplySchema,
  briefStateOf,
  buildAllowList,
  extractLinkedIssue,
  groundRefs,
  normaliseReply,
  settleRiskLevel,
  toBriefTimeline,
  withDeadline,
  type BriefInputParts,
} from './helpers.js';

/**
 * The PR Brief — what a change does, why it exists, what it risks, and where to
 * start reading.
 *
 * Two paths and exactly one of them spends money. `read` gathers, assembles,
 * trims and hashes; `generate` does the same and then makes ONE structured call.
 * They share `gather` and, more importantly, they share the ONE function that
 * owns *assemble → trim → hash*. If they ever stopped hashing the same string,
 * every brief that needed trimming would read stale forever and no amount of
 * pressing Regenerate would clear it. There are exactly two call sites of that
 * function in this file, one per path, and a third would mean somebody has
 * started hashing something else.
 *
 * No SQL and no Fastify below the first line. `pr_brief` is reached through
 * `BriefRepository`, the pull request and its files through
 * `container.reviewRepo` (the one workspace-scoped pull-request query), the
 * derived intent through `container.intent`, the blast map through
 * `container.blast`, the documents through `container.projectContext`, GitHub
 * through `container.github()` and the model through `container.llm`. Not one
 * sibling module is imported — that is what `container.blast` was brokered for.
 */
export class BriefService {
  private repo: BriefRepository;

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
  }

  /**
   * The stored brief, whether it still describes the pull request, and how it
   * got here. `null` when nothing was ever generated — the route's one and only
   * 404 (AC-03).
   *
   * ZERO model calls, under every condition. It is not free — it re-reads the
   * intent row, the blast map, `pr_files`, the enabled documents and, when the
   * body links one, an issue — because `stale` is defined against a key
   * RECOMPUTED from current inputs (AC-04) and that key is the hash of the fully
   * assembled, fully trimmed input (AC-05). Zero model calls is the claim that
   * matters for cost, and it is the one this method keeps.
   */
  async read(workspaceId: string, prId: string): Promise<PrBriefResponse | null> {
    const pull = await this.requirePull(workspaceId, prId);
    const rows = await this.repo.timeline(pull.id, BRIEF_MAX_HISTORY);
    if (rows.length === 0) return null;

    const history = toBriefTimeline(
      rows.map((row) => ({ seq: row.seq, record: PrBriefRecord.parse(row.json) })),
    );
    const record = PrBriefRecord.parse(rows[0]!.json);

    const parts = await this.gather(workspaceId, pull);
    // The SAME call `generate` makes. Not "assemble, then trim, then hash" —
    // one function, because AC-05 fixes the key as the hash of the input AFTER
    // trimming, and a read that skipped the ladder would hash a longer string
    // than the one that was stored.
    const state = briefStateOf(parts, (text) => this.container.tokenizer.count(text));

    // An input that no longer fits even at its minimum does NOT answer 422 here.
    // That status belongs to the POST, where AC-12 makes it a statement about
    // refusing to spend; on this path there is a stored brief in hand, and 422
    // would make an existing brief unreadable because the pull request grew.
    // A key that cannot be computed is not a key that equals the stored one, so
    // AC-04 read literally gives `stale: true` — and the banner then says why
    // regenerating will not help.
    const stale = state.overBudget || state.stateKey !== record.state_key;

    return { ...record, stale, history };
  }

  /**
   * Generate one brief with exactly one structured model call, and persist it.
   *
   * The order below is the order the criteria demand, and each step's placement
   * is load-bearing: the file check and the budget check both happen BEFORE any
   * provider is resolved, so a 422 costs nothing at all.
   */
  async generate(workspaceId: string, prId: string): Promise<PrBriefRecord> {
    const started = Date.now();
    const pull = await this.requirePull(workspaceId, prId);

    const parts = await this.gather(workspaceId, pull);
    if (parts.files.length === 0) {
      // Nothing to ground on, so every reference the model produced would be
      // dropped anyway. Refusing is cheaper and more honest than paying for a
      // brief that could not cite a single file (AC-24).
      throw new AppError(
        'brief_no_changed_files',
        'This pull request has no changed files, so there is nothing to brief.',
        422,
      );
    }

    const state = briefStateOf(parts, (text) => this.container.tokenizer.count(text));
    if (state.overBudget) {
      throw new AppError(
        'brief_input_too_large',
        'Even the minimal input for this pull request exceeds the token budget, so no brief was generated.',
        422,
      );
    }

    const choice =
      (await this.container.featureModelOverride(workspaceId, 'risk_brief')) ?? BRIEF_MODEL;
    const llm = await this.container.llm(choice.provider);
    const reply = await llm.completeStructured({
      model: choice.model,
      schema: BriefReplySchema,
      schemaName: 'PrBrief',
      messages: [
        { role: 'system', content: state.system },
        { role: 'user', content: state.user },
      ],
      temperature: 0,
      timeoutMs: BRIEF_TIMEOUT_MS,
    });

    const normalised = normaliseReply(reply.data);
    const grounded = groundRefs(normalised, buildAllowList(parts.files, parts.blast));
    const risks = grounded.risks.slice(0, BRIEF_MAX_RISKS);
    const review_focus = grounded.review_focus.slice(0, BRIEF_MAX_FOCUS);

    const record: PrBriefRecord = {
      pr_id: pull.id,
      what: normalised.what,
      why: normalised.why,
      // Computed from the risks that SURVIVED grounding, and the model's own
      // suggestion is accepted only if it is not higher (AC-20).
      risk_level: settleRiskLevel(risks, reply.data.risk_level),
      risks,
      review_focus,
      state_key: state.stateKey,
      head_sha: pull.headSha,
      missing_inputs: parts.missingInputs,
      dropped_refs: grounded.dropped_refs,
      trimmed: state.trimmed,
      // OUR count of what was sent, beside the provider's own. They differ, and
      // substituting one for the other would make the budget unfalsifiable
      // (AC-14).
      input_tokens: state.inputTokens,
      provider: choice.provider,
      model: choice.model,
      tokens_in: reply.tokensIn,
      tokens_out: reply.tokensOut,
      cost_usd: reply.costUsd,
      duration_ms: Date.now() - started,
      generated_at: new Date().toISOString(),
    };

    const row = await this.repo.upsert({
      prId: pull.id,
      stateKey: record.state_key,
      headSha: record.head_sha,
      json: record,
    });
    await this.repo.trimToCap(pull.id, BRIEF_MAX_HISTORY);

    // The row is the source of truth for `generated_at`: the column carries the
    // database's clock, and returning our own would let the response and the
    // Why Timeline disagree by a few milliseconds for no reason.
    return { ...record, generated_at: row.generatedAt.toISOString() };
  }

  // ===========================================================================

  private async requirePull(workspaceId: string, prId: string): Promise<PullRow> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  /**
   * Everything a brief is assembled from, gathered the SAME way on both paths.
   *
   * One function for both, because `read` recomputes the key `generate` stored
   * and any asymmetry here would show up as permanent staleness rather than as
   * an error. Every source is best-effort: what cannot be read becomes a line in
   * `missing_inputs` rather than an exception, so a missing GitHub token costs
   * the issue and nothing else.
   *
   * The one thing it will NOT do is derive an intent. That would be a second
   * model call the reader did not ask for (AC-22) — so `container.intent.get`,
   * never `derive`.
   */
  private async gather(workspaceId: string, pull: PullRow): Promise<BriefInputParts> {
    const missingInputs: string[] = [];

    const repo = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const files = await this.container.reviewRepo.getPrFiles(pull.id);

    const intentRecord = await this.container.intent.get(workspaceId, pull.id);
    if (!intentRecord) {
      missingInputs.push(
        'no intent has been derived for this pull request, so nothing states its scope',
      );
    }

    const blast = await this.readBlast(workspaceId, pull.id, missingInputs);

    let issue: BriefInputParts['issue'] = null;
    const issueNumber = extractLinkedIssue(pull.body, repo.fullName);
    if (issueNumber !== undefined) {
      try {
        const gh = await this.container.github();
        const meta = await withDeadline(BRIEF_ISSUE_TIMEOUT_MS, () =>
          gh.getIssue({ owner: repo.owner, name: repo.name }, issueNumber),
        );
        issue = { number: meta.number, title: meta.title, body: meta.body ?? null };
      } catch (err) {
        missingInputs.push(
          `issue #${String(issueNumber)} is linked but could not be read (${(err as Error).message})`,
        );
      }
    }

    const docs = await this.container.projectContext.listForPrompt(workspaceId, pull.repoId);

    return {
      title: pull.title,
      branch: pull.branch,
      body: pull.body,
      intent: intentRecord
        ? {
            kind: intentRecord.kind,
            intent: intentRecord.intent,
            in_scope: intentRecord.in_scope,
            out_of_scope: intentRecord.out_of_scope,
            confidence_tier: intentRecord.confidence_tier,
          }
        : null,
      blast,
      // Only the three columns the prompt is allowed to see. The row carries
      // more, and the projection is what keeps the rest of it out.
      files: files.map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
      })),
      issue,
      contextDocs: docs
        .filter((d) => typeof d.body === 'string' && d.body.length > 0)
        .map((d) => ({ title: d.title, path_label: d.path_label, body: d.body! })),
      missingInputs,
      limits: BRIEF_LIMITS_NONE,
    };
  }

  /**
   * The blast map, and what its state means for the brief.
   *
   * A `degraded` map is dropped entirely rather than rendered: there is no index
   * to have answered, so its lists are empty by construction and the allow-list
   * narrows to the pull request's own changed files (AC-23). A `partial` map is
   * KEPT — the rows it does have are real call sites, and discarding true facts
   * because the set is incomplete would be the wrong trade — with its reason
   * recorded so the reader knows the map under-reports.
   *
   * A blast map that throws is a missing input, not a failed brief. The map is
   * an enrichment; the diff is what the brief is really about.
   */
  private async readBlast(
    workspaceId: string,
    prId: string,
    missingInputs: string[],
  ): Promise<BlastRadiusResponse | null> {
    let map: BlastRadiusResponse;
    try {
      map = await this.container.blast.forPull(workspaceId, prId);
    } catch (err) {
      missingInputs.push(`the blast map could not be read (${(err as Error).message})`);
      return null;
    }

    if (map.status === 'degraded') {
      missingInputs.push(
        `the blast map is unavailable (${map.reason ?? 'no reason given'}), so downstream ` +
          'callers, endpoints and jobs are not part of this brief',
      );
      return null;
    }
    if (map.status === 'partial') {
      missingInputs.push(
        `the blast map is partial (${map.reason ?? 'no reason given'}), so some downstream ` +
          'callers may be missing from it',
      );
    }
    return map;
  }
}
