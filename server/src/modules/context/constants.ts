/**
 * Project Context — the literals. Every number the service rejects on lives
 * here, so a rejection message and the limit it names cannot drift apart.
 */

/**
 * The largest single document, in BYTES of UTF-8 — 256 KB.
 *
 * Well under `app.ts`'s `bodyLimit` (1 MB), which is the point: a document at
 * the ceiling still fits in a JSON body with its escaping, so the user gets
 * this module's 413 naming the limit rather than Fastify's generic one.
 */
export const MAX_DOC_BYTES = 262_144;

/** The most documents one repository may hold. */
export const MAX_DOCS_PER_REPO = 50;

/**
 * The only extensions accepted. Text formats only — a binary parser is a
 * dependency this feature does not need, and the body is stored verbatim and
 * fed to a model as-is.
 */
export const ALLOWED_EXTENSIONS = ['.md', '.txt'] as const;
