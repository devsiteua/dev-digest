import type { ProjectContextDoc } from '@devdigest/shared';
import { ALLOWED_EXTENSIONS } from './constants.js';
import type { ProjectContextDocRow, ProjectContextDocSummary } from './repository.js';

/**
 * Pure shape work for the project-context module. Nothing here touches the
 * database, Fastify, or the filesystem — `pathLabel` in particular is only ever
 * copied from a row into a DTO.
 */

/**
 * The document's extension, lower-cased and including the dot, or `undefined`
 * when the name carries none.
 *
 * `lastIndexOf` rather than `endsWith(ext)`: a file called `notes.md.bak` ends
 * with neither allowed extension, but a naive `endsWith` over a longer list
 * would be one careless entry away from accepting it. A leading dot with
 * nothing before it (`.md`) is a dotfile, not an extension, hence `> 0`.
 */
export function extensionOf(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot).toLowerCase() : undefined;
}

/** Is this filename's extension one this feature stores? */
export function hasAllowedExtension(filename: string): boolean {
  const ext = extensionOf(filename);
  return ext !== undefined && (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Size in BYTES of UTF-8, which is what `MAX_DOC_BYTES` counts and what the
 * database stores. `String.length` counts UTF-16 code units and would let a
 * document of CJK or emoji text through at roughly a third over the limit.
 *
 * `TextEncoder` rather than `Buffer` so this file stays free of Node globals.
 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Is the body empty or nothing but whitespace? */
export function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/** One stored row as the public DTO, including its body. */
export function toProjectContextDoc(row: ProjectContextDocRow): ProjectContextDoc {
  return { ...toProjectContextDocSummary(row), body: row.body };
}

/**
 * One stored row as the public DTO WITHOUT its body — the list projection.
 *
 * The key is left out entirely rather than set to `null`: `ProjectContextDoc.body`
 * is `.nullish()`, and "this response does not carry bodies" should not be
 * indistinguishable from "this document is empty" (which AC-08 forbids anyway).
 */
export function toProjectContextDocSummary(row: ProjectContextDocSummary): ProjectContextDoc {
  return {
    id: row.id,
    title: row.title,
    path_label: row.pathLabel,
    enabled: row.enabled,
    order: row.order,
    size_bytes: row.sizeBytes,
    updated_at: row.updatedAt.toISOString(),
  };
}
