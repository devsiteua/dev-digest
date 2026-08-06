import type { Container } from '../../platform/container.js';
import type { Skill, SkillDraft, SkillType, SkillVersion } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';
import { MAX_BODY_CHARS } from './constants.js';
import {
  decodeBase64,
  draftFromMarkdown,
  draftFromZip,
  toSkillDto,
  toSkillVersionDto,
} from './helpers.js';

/**
 * Skills service — business logic for the Skills page and the import flow.
 *
 * A skill is TEXT and nothing else: a name, a description that states when it
 * applies, a type, and a markdown body. The body is the only part that reaches a
 * model, and it reaches it by concatenation — never by evaluation.
 *
 * `source` is set HERE, from which entry point created the row, and is never
 * accepted from a request. It decides whether the body is delimiter-wrapped at
 * prompt assembly, so letting a caller supply it would be an opt-out from the
 * untrusted-content defence.
 *
 * Workspace-scoped: a miss returns `undefined`, which the route turns into a 404.
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/** An upload, already read by the browser. Markdown as text, archives as base64. */
export type ImportPayload =
  | { kind: 'markdown'; filename: string; content: string }
  | { kind: 'zip'; filename: string; content_base64: string };

export class SkillsService {
  private repo: SkillsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const versions = await this.repo.listVersions(id);
    return versions.map(toSkillVersionDto);
  }

  /** Create a skill authored in this workspace. Always `source: 'manual'`. */
  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    this.assertBodyFits(input.body);
    await this.assertNameFree(workspaceId, input.name);
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: 'manual',
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return toSkillDto(row);
  }

  /**
   * Persist a reviewed import. Always `source: 'imported_file'` and always
   * disabled: third-party instructions do not join an agent's prompt until
   * someone has read them and switched them on.
   */
  async createFromImport(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    this.assertBodyFits(input.body);
    await this.assertNameFree(workspaceId, input.name);
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: 'imported_file',
      body: input.body,
      enabled: false,
    });
    return toSkillDto(row);
  }

  /** A skill of this workspace by exact name, or `undefined`. */
  async findByName(workspaceId: string, name: string): Promise<Skill | undefined> {
    const row = await this.repo.findByName(workspaceId, name);
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Persist a skill merged from extracted conventions. Always
   * `source: 'extracted'`, and `evidence_files` records which files the rules
   * were read out of.
   *
   * Unlike an import, `enabled` is the caller's: the user has just read every
   * rule that went into this body and clicked accept on each one, which is the
   * review step the import flow has to defer. The body is still generated text,
   * so `'extracted'` still gets it delimiter-wrapped at prompt assembly.
   *
   * `replaceId` makes a re-merge a NEW VERSION of the skill this repo already
   * produced, rather than a name clash. Merging is not a one-shot act: the user
   * accepts three rules, merges, accepts two more and merges again — and with an
   * insert-only path the second merge died on `assertNameFree` AFTER the whole
   * body had been composed. The caller decides what may be replaced (see
   * `ConventionsService.createSkill`); everything this method does with the id
   * is write through it, so a skill some other repo or a person owns is still
   * protected by the name check below.
   */
  async saveFromConventions(
    workspaceId: string,
    input: CreateSkillInput & { evidenceFiles: string[] },
    replaceId?: string,
  ): Promise<Skill> {
    this.assertBodyFits(input.body);
    await this.assertNameFree(workspaceId, input.name, replaceId);

    if (replaceId) {
      // `repo.update` bumps `version` and snapshots the old body into
      // `skill_versions` whenever the text changed — which is exactly what a
      // re-merge is, and why this is an update rather than a delete + insert.
      const row = await this.repo.update(workspaceId, replaceId, {
        name: input.name,
        description: input.description,
        type: input.type,
        body: input.body,
        enabled: input.enabled ?? true,
        evidenceFiles: input.evidenceFiles,
      });
      if (row) return toSkillDto(row);
      // The row vanished between the caller's read and this write. Fall through
      // and create it rather than reporting a 404 for something the user never
      // asked to update.
    }

    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: 'extracted',
      body: input.body,
      enabled: input.enabled ?? true,
      evidenceFiles: input.evidenceFiles,
    });
    return toSkillDto(row);
  }

  /**
   * `source` is intentionally absent from the patch type. Allowing an edit to
   * relabel an imported skill as `manual` would strip its untrusted wrapping
   * after the fact, which is exactly the bypass `create` avoids.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    if (patch.body !== undefined) this.assertBodyFits(patch.body);
    if (patch.name !== undefined) await this.assertNameFree(workspaceId, patch.name, id);
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Parse an upload into an editable draft. Writes NOTHING: the preview step
   * cannot create a skill even if the UI is wrong about when to call it.
   */
  preview(payload: ImportPayload): SkillDraft {
    return payload.kind === 'markdown'
      ? draftFromMarkdown(payload.filename, payload.content)
      : draftFromZip(decodeBase64(payload.content_base64), payload.filename);
  }

  /** Ids from `ids` that belong to this workspace (see `SkillsRepository`). */
  async idsInWorkspace(workspaceId: string, ids: string[]): Promise<string[]> {
    return this.repo.idsInWorkspace(workspaceId, ids);
  }

  private assertBodyFits(body: string): void {
    if (body.length > MAX_BODY_CHARS) {
      throw new ValidationError(
        `Skill body is ${body.length} characters; the limit is ${MAX_BODY_CHARS}.`,
      );
    }
  }

  /**
   * Names are how a skill is recognised in a prompt block and in the run log, so
   * duplicates are confusing rather than merely untidy. Enforced here and not by a
   * unique index: adding one would mean a migration, and the schema is fixed for
   * this lesson. That makes the check advisory — two simultaneous requests could
   * still both pass it. Acceptable for a single-user local studio.
   */
  private async assertNameFree(
    workspaceId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.repo.findByName(workspaceId, name, exceptId);
    if (clash) throw new ValidationError(`A skill named "${name}" already exists.`);
  }
}
