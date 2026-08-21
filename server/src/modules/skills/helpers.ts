import { unzipSync } from 'fflate';
import type { Skill, SkillDraft, SkillType, SkillSource, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import { ValidationError } from '../../platform/errors.js';
import {
  DEFAULT_SKILL_TYPE,
  MAX_BODY_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_NAME_CHARS,
  MAX_UNPACKED_BYTES,
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
  SKILL_ENTRY_NAME,
} from './constants.js';

/**
 * Pure helpers for the skills module: row ⇄ DTO mapping, and the import parsers
 * that turn an uploaded markdown file or archive into an editable `SkillDraft`.
 *
 * No I/O. The archive parser works entirely over an in-memory `Uint8Array`: it
 * never touches the filesystem, so a malicious entry path (`../../etc/passwd`)
 * has nothing to escape into, and it never executes anything. That is the whole
 * safety argument for accepting third-party bundles — see `draftFromZip`.
 */

// ---- DTO mapping -----------------------------------------------------------

export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

// ---- Markdown parsing ------------------------------------------------------

/**
 * Split a leading YAML frontmatter block off a markdown document.
 *
 * Deliberately NOT a YAML parser: we accept a flat `key: value` block and nothing
 * else. A real YAML engine would bring anchors, merge keys and type coercion into
 * the parse path for a file we already treat as untrusted — for two string fields
 * that is a bad trade. Anything we do not recognise stays in the body, where it is
 * inert text.
 *
 * Returns the document unchanged when there is no well-formed frontmatter.
 */
export function parseFrontmatter(md: string): {
  attrs: Record<string, string>;
  body: string;
} {
  const normalized = md.replace(/^﻿/, '');
  if (!/^---[ \t]*\r?\n/.test(normalized)) return { attrs: {}, body: md };

  const lines = normalized.split(/\r?\n/);
  const closing = lines.findIndex((l, i) => i > 0 && /^---[ \t]*$/.test(l));
  // Unterminated frontmatter: treat the whole document as body rather than
  // swallowing it.
  if (closing === -1) return { attrs: {}, body: md };

  const attrs: Record<string, string> = {};
  for (const line of lines.slice(1, closing)) {
    const match = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    attrs[match[1]!.toLowerCase()] = stripQuotes(match[2]!.trim());
  }
  return { attrs, body: lines.slice(closing + 1).join('\n').replace(/^\n+/, '') };
}

function stripQuotes(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2]! : value;
}

/**
 * Normalise a derived name into the slug style the rest of the product shows in
 * mono type (`pr-quality-rubric`). Only applied to names we *derived* — a name the
 * author wrote in frontmatter is kept as-is unless it contains whitespace.
 */
export function toSkillName(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_NAME_CHARS) || 'imported-skill'
  );
}

/** First markdown heading of any level, without its hashes. */
function firstHeading(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    const match = /^#{1,6}[ \t]+(.+?)[ \t]*#*$/.exec(line);
    if (match) return match[1]!.trim();
  }
  return undefined;
}

/** First non-empty, non-heading, non-fence line — used as a fallback description. */
function firstParagraph(body: string): string | undefined {
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue;
    return trimmed.slice(0, 300);
  }
  return undefined;
}

/** Strip a directory prefix and any extension: `skills/foo/bar.md` → `bar`. */
function fileStem(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  return base.replace(/\.[^.]+$/, '');
}

/**
 * Turn a markdown document into an editable draft.
 *
 * `name` falls back through frontmatter → first heading → file stem, and
 * `description` through frontmatter → first paragraph. Each fallback records a
 * warning, so the preview can tell the user what the product guessed rather than
 * silently inventing metadata.
 */
export function draftFromMarkdown(filename: string, content: string): SkillDraft {
  if (content.length > MAX_BODY_CHARS) {
    throw new ValidationError(
      `Skill body is ${content.length} characters; the limit is ${MAX_BODY_CHARS}.`,
    );
  }

  const { attrs, body } = parseFrontmatter(content);
  const warnings: string[] = [];

  let name = attrs.name;
  if (!name) {
    const heading = firstHeading(body);
    name = toSkillName(heading ?? fileStem(filename));
    warnings.push(
      heading
        ? 'No frontmatter name — derived from the first heading.'
        : 'No frontmatter name or heading — derived from the file name.',
    );
  } else if (/\s/.test(name)) {
    name = toSkillName(name);
  }
  // Clamp to what the create endpoint accepts. Handing back a draft that is
  // valid here and rejected on confirm would look like the product breaking at
  // the last step; saying so in a warning lets the user adjust it in the preview.
  if (name.length > MAX_NAME_CHARS) {
    name = name.slice(0, MAX_NAME_CHARS);
    warnings.push(`Name was longer than ${MAX_NAME_CHARS} characters and has been shortened.`);
  }

  let description = attrs.description;
  if (!description) {
    description = firstParagraph(body) ?? '';
    warnings.push(
      description
        ? 'No frontmatter description — derived from the first paragraph.'
        : 'No description found. Write one: it is how an agent knows when this skill applies.',
    );
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    description = description.slice(0, MAX_DESCRIPTION_CHARS);
    warnings.push(
      `Description was longer than ${MAX_DESCRIPTION_CHARS} characters and has been shortened.`,
    );
  }

  const trimmedBody = body.trim();
  if (!trimmedBody) throw new ValidationError('The skill body is empty.');

  return {
    name,
    description,
    type: DEFAULT_SKILL_TYPE satisfies SkillType,
    body: trimmedBody,
    ignored_files: [],
    warnings,
  };
}

// ---- Archive parsing -------------------------------------------------------

/** Depth of an archive entry: `SKILL.md` → 0, `pack/SKILL.md` → 1. */
function entryDepth(name: string): number {
  return name.split('/').length - 1;
}

/**
 * Extract a skill's markdown core from a zip archive, in memory.
 *
 * Two passes, and that is the point. The first pass only *enumerates* the central
 * directory (the filter returns false for everything, so fflate decompresses
 * nothing) to find the single `SKILL.md` and to record every other entry name.
 * The second pass decompresses that one entry and no other. Scripts, binaries and
 * images are therefore never decompressed, never read, and never executed — they
 * appear in `ignored_files` purely as names, which is what the preview shows.
 *
 * `SKILL.md` is matched case-insensitively at the archive root or inside a single
 * root folder (the Anthropic Agent Skills layout).
 */
export function draftFromZip(bytes: Uint8Array, filename: string): SkillDraft {
  if (bytes.length > MAX_ZIP_BYTES) {
    throw new ValidationError(
      `Archive is ${Math.round(bytes.length / 1024)} KB; the limit is ${MAX_ZIP_BYTES / 1024} KB.`,
    );
  }

  const entries: { name: string; originalSize: number }[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        entries.push({ name: file.name, originalSize: file.originalSize ?? 0 });
        return false; // enumerate only — decompress nothing on this pass
      },
    });
  } catch {
    throw new ValidationError('Could not read the archive. Is it a valid .zip file?');
  }

  const files = entries.filter((e) => !e.name.endsWith('/'));
  if (files.length > MAX_ZIP_ENTRIES) {
    throw new ValidationError(
      `Archive has ${files.length} entries; the limit is ${MAX_ZIP_ENTRIES}.`,
    );
  }
  const unpacked = files.reduce((sum, e) => sum + e.originalSize, 0);
  if (unpacked > MAX_UNPACKED_BYTES) {
    throw new ValidationError(
      `Archive expands to ${Math.round(unpacked / 1024)} KB; the limit is ${MAX_UNPACKED_BYTES / 1024} KB.`,
    );
  }

  const candidates = files
    .filter(
      (e) =>
        (e.name.split('/').pop() ?? '').toLowerCase() === SKILL_ENTRY_NAME && entryDepth(e.name) <= 1,
    )
    // Prefer the archive root over a wrapper folder.
    .sort((a, b) => entryDepth(a.name) - entryDepth(b.name));

  const target = candidates[0];
  if (!target) {
    throw new ValidationError(
      'No SKILL.md found in the archive root or its single root folder. ' +
        'A skill bundle must carry its instructions in SKILL.md.',
    );
  }
  if (target.originalSize > MAX_BODY_CHARS * 4) {
    throw new ValidationError(`SKILL.md is too large; the limit is ${MAX_BODY_CHARS} characters.`);
  }

  let unpackedTarget: Record<string, Uint8Array>;
  try {
    unpackedTarget = unzipSync(bytes, { filter: (file) => file.name === target.name });
  } catch {
    throw new ValidationError('Could not decompress SKILL.md from the archive.');
  }
  const raw = unpackedTarget[target.name];
  if (!raw) throw new ValidationError('Could not decompress SKILL.md from the archive.');

  const draft = draftFromMarkdown(target.name, new TextDecoder().decode(raw));
  const ignored = files.filter((e) => e.name !== target.name).map((e) => e.name);

  return {
    ...draft,
    // Fall back to the archive's own name when SKILL.md carried no usable name.
    name: draft.name === 'imported-skill' ? toSkillName(fileStem(filename)) : draft.name,
    ignored_files: ignored,
    warnings: ignored.length
      ? [
          ...draft.warnings,
          `${ignored.length} other archive ${ignored.length === 1 ? 'entry was' : 'entries were'} not read or executed.`,
        ]
      : draft.warnings,
  };
}

/** Decode a base64 upload into bytes, rejecting a malformed payload as 422. */
export function decodeBase64(content: string): Uint8Array {
  try {
    return new Uint8Array(Buffer.from(content, 'base64'));
  } catch {
    throw new ValidationError('Upload is not valid base64.');
  }
}
