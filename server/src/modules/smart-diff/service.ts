import type { SmartDiffResponse } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { SmartDiffRepository } from './repository.js';
import { buildGroups, buildSplitSuggestion, groupFindingLines } from './helpers.js';

/**
 * The Smart Diff — a PR's changed files in the order a reviewer should read
 * them, with the lines a review already flagged.
 *
 * It costs NO model call, and that is a property of the design rather than a
 * budget note: everything it answers with is already in Postgres. The ordering
 * comes from path rules (`helpers.ts`), the badges from the latest review's
 * findings. An integration test proves it by serving the route with providers
 * that throw on every method.
 *
 * No SQL and no Fastify below this line: the repository is constructed from
 * `container.db` the way `IntentService` builds its own, and the PR is resolved
 * through `container.reviewRepo` so tenancy is checked by the one query in this
 * codebase that is workspace-scoped for PRs.
 */
export type SmartDiffApi = Pick<SmartDiffService, 'forPull'>;

export class SmartDiffService {
  private repo: SmartDiffRepository;

  constructor(private container: Container) {
    this.repo = new SmartDiffRepository(container.db);
  }

  /**
   * The whole response for one PR.
   *
   * Note what is NOT here: `patch` text. `GET /pulls/:id` already ships every
   * hunk, and the client joins the two by path — so the diff bytes cross the wire
   * once, and a client polling for fresh badges is not re-downloading the diff to
   * get them.
   *
   * A PR with no `pr_files` rows (imported, never opened) yields `groups: []`
   * rather than a 404. Nothing is wrong in that case; there is simply nothing to
   * order yet, and the client falls back to its flat viewer.
   */
  async forPull(workspaceId: string, prId: string): Promise<SmartDiffResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // Independent reads on the same PR — the findings do not filter the files and
    // the files do not filter the findings, so there is no reason to serialise.
    const [files, findingRows] = await Promise.all([
      this.repo.filesForPr(prId),
      this.repo.latestReviewFindingLines(prId),
    ]);

    return {
      groups: buildGroups(files, groupFindingLines(findingRows)),
      split_suggestion: buildSplitSuggestion(files),
    };
  }
}
