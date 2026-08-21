import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillRequest,
  ConventionUpdate,
  RepoRef,
  Skill,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ConventionsRepository, type InsertConvention } from './repository.js';
import {
  CONFIG_FILES,
  DEFAULT_CONVENTIONS_MODEL,
  EXTRACTION_TIMEOUT_MS,
  SAMPLE_FILE_COUNT,
  SYSTEM_PROMPT,
} from './constants.js';
import {
  ExtractionReplySchema,
  buildSamplePrompt,
  normalizeRule,
  ruleKey,
  toConventionDto,
  verifyCandidates,
  type SampleFile,
} from './helpers.js';

/**
 * Conventions extractor — the service that turns a repository into a list of the
 * house rules it already follows.
 *
 * One pass is: sample (code), read (ports), ask the model ONCE, verify the
 * evidence (code), persist what survived. The model is the only step that can
 * invent something, and it is the only step whose output is not trusted: a rule
 * exists after this service runs iff a file in the sample contains the lines it
 * cites. Everything about that check is in `helpers.ts`, deliberately pure.
 *
 * No SQL, no Fastify, no `src/adapters/**` — file bodies arrive through
 * `container.git`, the sample through `container.repoIntel`, the model through
 * `container.llm`, and the merged skill through `container.skillsService`. That
 * is what lets `conventions.it.test.ts` run the whole flow against
 * `MockLLMProvider` and `MockGitClient`.
 */

/**
 * The slice of this service the delivery layer and `ContainerOverrides` see.
 *
 * A `Pick` rather than the class: the class has private fields, so nothing else
 * could ever satisfy its type, and an override that only a real instance can
 * fill is not an override.
 */
export type ConventionsApi = Pick<
  ConventionsService,
  'extract' | 'list' | 'update' | 'createSkill'
>;

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    await this.requireRepo(workspaceId, repoId);
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  /**
   * One extraction pass.
   *
   * Synchronous by design — not a job, not an SSE stream. It is a single call to
   * a cheap model, the screen shows "Scanning…" while it runs, and a job would
   * buy a status table and a polling loop for something the user is standing in
   * front of. The cost of that choice is a long-held request; see
   * `EXTRACTION_TIMEOUT_MS` and the spec's Risks.
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionExtractResult> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    // (a) The sample is picked by code, which is why the model is called once.
    // repo-intel degrades SILENTLY: an unindexed repo, or the whole facade
    // switched off, returns `[]` with no error (server/CLAUDE.md, Gotchas).
    // Reading that as "this repo has no conventions" would show an empty screen
    // for a repo nobody has looked at yet, so it is reported as the one thing
    // the user can act on instead.
    const sampled = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
    if (sampled.length === 0) {
      throw new ValidationError(
        `No indexed files to sample for ${repo.fullName}. Index the repo first — ` +
          'conventions are found by reading its highest-ranked source files.',
      );
    }

    // (b) File bodies come from the clone through the git port. A path that
    // cannot be read is skipped rather than fatal: the index can outlive the
    // file it names, and eleven samples still make a pass.
    const files: SampleFile[] = [];
    for (const path of sampled) {
      const text = await this.readOrSkip(ref, path);
      if (text !== undefined) files.push({ path, text });
    }
    if (files.length === 0) {
      throw new ValidationError(
        `None of the ${sampled.length} sampled files could be read from the clone of ` +
          `${repo.fullName}. Re-clone or re-index the repo, then scan again.`,
      );
    }

    // Declared rules first: a repo that ships an ESLint config has written some
    // of its style down already. There is no globbing on the read path, so each
    // known filename is probed and the misses are simply absent.
    const configs: SampleFile[] = [];
    for (const path of CONFIG_FILES) {
      const text = await this.readOrSkip(ref, path);
      if (text !== undefined) configs.push({ path, text });
    }

    // (c) One structured call.
    const prompt = buildSamplePrompt({ repoFullName: repo.fullName, configs, files });
    const choice =
      (await this.container.featureModelOverride(workspaceId, 'conventions')) ??
      DEFAULT_CONVENTIONS_MODEL;
    const llm = await this.container.llm(choice.provider);
    const reply = await llm.completeStructured({
      model: choice.model,
      schema: ExtractionReplySchema,
      schemaName: 'ConventionExtraction',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      timeoutMs: EXTRACTION_TIMEOUT_MS,
    });

    // (d) Grounding. The map is built from exactly what went into the prompt, so
    // "is this path one of the sampled files?" and "does the file contain these
    // lines?" are one lookup. `verifyCandidates` also caps, dedupes, and reports
    // every rejection with its reason.
    const sampleTexts = new Map([...configs, ...files].map((f) => [f.path, f.text]));
    const { verified, discarded } = verifyCandidates(reply.data.candidates, sampleTexts);

    // (e) A re-scan replaces the undecided rows and leaves the decided ones
    // alone, so an accepted rule keeps its skill link and a rejected one does
    // not come back as new.
    await this.repo.deletePendingByRepo(workspaceId, repoId);
    const decided = await this.repo.listByRepo(workspaceId, repoId);
    const decidedKeys = new Set(decided.map((row) => ruleKey(row.rule)));

    const fresh: InsertConvention[] = [];
    for (const candidate of verified) {
      if (decidedKeys.has(ruleKey(candidate.rule))) {
        discarded.push({
          rule: candidate.rule,
          reason: 'already accepted or rejected in an earlier scan',
        });
        continue;
      }
      fresh.push({
        workspaceId,
        repoId,
        rule: candidate.rule,
        category: candidate.category,
        evidencePath: candidate.evidence_path,
        evidenceSnippet: candidate.evidence_snippet,
        evidenceStartLine: candidate.evidence_start_line,
        evidenceEndLine: candidate.evidence_end_line,
        confidence: candidate.confidence,
      });
    }
    await this.repo.insertMany(fresh);

    // (f) The candidates are the screen's whole state after the pass — the new
    // rows plus the decisions that survived it — while `sampled_files` and
    // `discarded` describe the pass itself. Returning only the new rows would
    // make the response disagree with `GET /repos/:id/conventions` one refetch
    // later; returning them without the discards would make a two-rule result
    // read as "this repo has two conventions" rather than "eighteen rules had
    // no evidence in these files".
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return {
      candidates: rows.map(toConventionDto),
      sampled_files: [...configs, ...files].map((f) => f.path),
      discarded,
    };
  }

  /**
   * Reword, re-file, accept or reject one candidate.
   *
   * A hand-typed rule goes through the same `normalizeRule` as a generated one:
   * these lines are concatenated into a prompt block, and the bound is what
   * stops one edited card from deciding how much of an agent's prompt the house
   * style gets. Evidence is not patchable — see `ConventionUpdate`.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: ConventionUpdate,
  ): Promise<ConventionCandidate | undefined> {
    let row = await this.repo.get(workspaceId, id);
    if (!row) return undefined;

    if (patch.rule !== undefined || patch.category !== undefined) {
      const fields = {
        ...(patch.rule !== undefined ? { rule: normalizeRule(patch.rule) } : {}),
        ...(patch.category !== undefined ? { category: patch.category.trim() } : {}),
      };
      if (fields.rule !== undefined && fields.rule.length === 0) {
        throw new ValidationError('A convention rule cannot be empty.');
      }
      row = (await this.repo.updateFields(workspaceId, id, fields)) ?? row;
    }
    if (patch.status !== undefined) {
      row = (await this.repo.updateStatus(workspaceId, id, patch.status)) ?? row;
    }
    return toConventionDto(row);
  }

  /**
   * Merge the accepted candidates of one repo into a single skill.
   *
   * Two rules the caller does not get to bend. Provenance is the server's:
   * `ConventionSkillRequest` has no `source`, and the skills layer stamps
   * `'extracted'`, so this body is delimiter-wrapped at prompt assembly like any
   * other text a model wrote. And only `accepted` candidates are merged —
   * `pending` and `rejected` ids in the request are ignored rather than
   * honoured, because the accept click is the entire review step of this
   * feature.
   */
  async createSkill(
    workspaceId: string,
    repoId: string,
    payload: ConventionSkillRequest,
  ): Promise<Skill> {
    await this.requireRepo(workspaceId, repoId);

    const rows = await this.repo.listByRepo(workspaceId, repoId);
    const byId = new Map(rows.map((row) => [row.id, row]));

    // An id from another workspace or another repo is a 404, not a silent skip:
    // the caller asked for something that does not exist here.
    const requested = payload.convention_ids.map((id) => {
      const row = byId.get(id);
      if (!row) throw new NotFoundError(`Convention ${id} not found in this repo`);
      return row;
    });

    const merged = requested.filter((row) => row.status === 'accepted');
    if (merged.length === 0) {
      throw new ValidationError(
        'None of the selected conventions are accepted. Accept the rules you want in ' +
          'the skill first — rejected and undecided ones are never merged.',
      );
    }

    // A re-merge is a new version of THIS repo's skill, not a name clash. The
    // default name is fixed (`repo-conventions`), so an insert-only path failed
    // the second time the user merged — after they had composed the whole body.
    //
    // Only a skill this repo already produced may be replaced: the candidates
    // carry `skill_id`, so "did we write this one?" is a lookup rather than a
    // guess. A name held by another repo's merge, or by a hand-written skill,
    // falls through to `assertNameFree` and its 422 — which is the right answer,
    // because those are somebody else's rules under the same title.
    const replaceId = await this.replaceableSkillId(workspaceId, rows, payload.name);

    const skill = await this.container.skillsService.saveFromConventions(
      workspaceId,
      {
        name: payload.name,
        description: payload.description,
        type: payload.type,
        body: payload.body,
        enabled: payload.enabled,
        // Which files this skill's rules were read out of — the provenance the
        // Skills screen shows next to an `extracted` badge. Unique and sorted so
        // two merges of the same cards produce the same list.
        evidenceFiles: [...new Set(merged.map((row) => row.evidencePath))].sort(),
      },
      replaceId,
    );

    await this.repo.markLinkedToSkill(
      workspaceId,
      merged.map((row) => row.id),
      skill.id,
    );
    return skill;
  }

  private async requireRepo(workspaceId: string, repoId: string) {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /**
   * The id of the skill a merge under `name` is allowed to overwrite, or
   * `undefined` when it must create one.
   *
   * Three conditions, all required: a skill with that name exists, it is
   * `extracted` (a merge never overwrites hand-written or imported text), and at
   * least one candidate OF THIS REPO already points at it. The last one is what
   * keeps two repos in one workspace from silently overwriting each other under
   * the shared default name.
   */
  private async replaceableSkillId(
    workspaceId: string,
    rows: { skillId: string | null }[],
    name: string,
  ): Promise<string | undefined> {
    const ours = new Set(rows.map((row) => row.skillId).filter((id): id is string => id !== null));
    if (ours.size === 0) return undefined;
    const existing = await this.container.skillsService.findByName(workspaceId, name);
    if (!existing || existing.source !== 'extracted') return undefined;
    return ours.has(existing.id) ? existing.id : undefined;
  }

  /**
   * Read one file out of the clone, or `undefined` when it is not there.
   *
   * `git.readFile` throws for a missing path (and the mock returns `''`), and
   * both mean the same thing to a sampler: nothing to show the model. Empty
   * files are dropped too — a zero-line sample costs prompt structure and can
   * ground nothing.
   */
  private async readOrSkip(ref: RepoRef, path: string): Promise<string | undefined> {
    try {
      const text = await this.container.git.readFile(ref, path);
      return text.trim().length > 0 ? text : undefined;
    } catch {
      return undefined;
    }
  }
}
