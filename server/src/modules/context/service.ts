import type {
  ProjectContextDoc,
  ProjectContextPatch,
  ProjectContextUpload,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import {
  ALLOWED_EXTENSIONS,
  MAX_DOCS_PER_REPO,
  MAX_DOC_BYTES,
} from './constants.js';
import {
  byteLength,
  hasAllowedExtension,
  isBlank,
  toProjectContextDoc,
  toProjectContextDocSummary,
} from './helpers.js';
import type { ProjectContextRepository } from './repository.js';

/**
 * Project Context — the documents a user gives DevDigest about their project,
 * and which the reviewer reads before judging a diff.
 *
 * Two things this service deliberately does NOT do:
 *
 *  - **It never touches a file.** A document is a row. `path_label` is stored
 *    and returned as a label and is never resolved, joined or opened, and the
 *    user's clone at `repos.clone_path` is not read or written by any path
 *    through this module (AC-02, AC-03, AC-09).
 *  - **It does not validate uploads in the route schema.** The four rejections
 *    below need four different statuses — 400, 413, 409, 400 — and a Zod route
 *    schema can only produce 422. So the body schema stays loose and the
 *    decisions are made here, where an `AppError` carries its own status
 *    (`platform/errors.ts`) and `app.ts` forwards it.
 */

/**
 * The slice of the repository this service uses, named as an interface so the
 * unit test can stand in a stub. A `Pick` of the class rather than a
 * hand-written twin: the two cannot drift.
 */
export type ProjectContextStore = Pick<
  ProjectContextRepository,
  | 'getRepo'
  | 'listByRepo'
  | 'listEnabledByRepo'
  | 'get'
  | 'countByRepo'
  | 'nextOrder'
  | 'insert'
  | 'update'
  | 'remove'
  | 'setOrder'
>;

/**
 * What the delivery layer and `ContainerOverrides` see. A `Pick` rather than
 * the class, for the reason `ConventionsApi` is one: a class with private
 * fields can only ever be satisfied by itself, which is not an override.
 */
export type ProjectContextApi = Pick<
  ProjectContextService,
  'list' | 'get' | 'upload' | 'patch' | 'remove' | 'reorder' | 'listForPrompt'
>;

export class ProjectContextService {
  constructor(private repo: ProjectContextStore) {}

  /** Every document of a repo, in the user's order, bodies omitted. */
  async list(workspaceId: string, repoId: string): Promise<ProjectContextDoc[]> {
    await this.requireRepo(workspaceId, repoId);
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toProjectContextDocSummary);
  }

  /** One document, with its body. */
  async get(workspaceId: string, id: string): Promise<ProjectContextDoc> {
    const row = await this.repo.get(workspaceId, id);
    if (!row) throw new NotFoundError('Project context document not found');
    return toProjectContextDoc(row);
  }

  /**
   * The enabled documents of a repo, with bodies, in the user's order — what
   * the review run reads. Kept separate from `list` because the prompt wants
   * the text and the screen does not.
   */
  async listForPrompt(workspaceId: string, repoId: string): Promise<ProjectContextDoc[]> {
    const rows = await this.repo.listEnabledByRepo(workspaceId, repoId);
    return rows.map(toProjectContextDoc);
  }

  /**
   * Store one uploaded document.
   *
   * The four rejections run before anything is written, in this order: the two
   * that need only the request (extension, size, blank body) and then the one
   * that needs the repository's current state (the per-repo ceiling). A rejected
   * upload creates no row — there is a single `insert` and it is the last thing
   * that happens.
   */
  async upload(
    workspaceId: string,
    repoId: string,
    input: ProjectContextUpload,
  ): Promise<ProjectContextDoc> {
    await this.requireRepo(workspaceId, repoId);

    if (!hasAllowedExtension(input.filename)) {
      throw new AppError(
        'unsupported_document_type',
        `Only ${ALLOWED_EXTENSIONS.join(' and ')} documents can be uploaded.`,
        400,
      );
    }

    const sizeBytes = byteLength(input.content);
    if (sizeBytes > MAX_DOC_BYTES) {
      throw new AppError(
        'document_too_large',
        `A document may be at most ${MAX_DOC_BYTES} bytes; this one is ${sizeBytes}.`,
        413,
      );
    }

    if (isBlank(input.content)) {
      throw new AppError(
        'empty_document',
        'A document must contain something other than whitespace.',
        400,
      );
    }

    const existing = await this.repo.countByRepo(workspaceId, repoId);
    if (existing >= MAX_DOCS_PER_REPO) {
      throw new AppError(
        'document_limit_reached',
        `This repository already holds the maximum of ${MAX_DOCS_PER_REPO} project context documents.`,
        409,
      );
    }

    // Enabled on creation (the column's default) and after the current tail, so
    // a new document is read last rather than displacing the user's priorities.
    const order = await this.repo.nextOrder(workspaceId, repoId);
    const row = await this.repo.insert({
      workspaceId,
      repoId,
      title: input.title?.trim() || input.filename,
      pathLabel: input.filename,
      body: input.content,
      order,
      sizeBytes,
    });
    return toProjectContextDoc(row);
  }

  /** Enable, disable, or retitle one document. The body is never edited. */
  async patch(
    workspaceId: string,
    id: string,
    input: ProjectContextPatch,
  ): Promise<ProjectContextDoc> {
    const row = await this.repo.update(workspaceId, id, input);
    if (!row) throw new NotFoundError('Project context document not found');
    return toProjectContextDoc(row);
  }

  /** Delete one document. It leaves the next prompt with it. */
  async remove(workspaceId: string, id: string): Promise<void> {
    const deleted = await this.repo.remove(workspaceId, id);
    if (!deleted) throw new NotFoundError('Project context document not found');
  }

  /**
   * Apply a new order and return the list as it now stands.
   *
   * The caller sends the full id list; an id from another repository is scoped
   * out by the repository rather than rejected here, so a stale tab cannot move
   * a document it should not see.
   */
  async reorder(
    workspaceId: string,
    repoId: string,
    ids: string[],
  ): Promise<ProjectContextDoc[]> {
    await this.requireRepo(workspaceId, repoId);
    await this.repo.setOrder(workspaceId, repoId, ids);
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toProjectContextDocSummary);
  }

  /** 404 for a repo that is not this workspace's, before anything else runs. */
  private async requireRepo(workspaceId: string, repoId: string): Promise<void> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
  }
}
