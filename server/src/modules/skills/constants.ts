/** Constants for the skills module. */

/** Version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Default type when an imported skill declares none. */
export const DEFAULT_SKILL_TYPE = 'custom' as const;

/**
 * Longest accepted skill body, in characters. Also the cap on a pasted/imported
 * markdown payload — a body is the ONLY thing a skill contributes to a prompt,
 * so this is the real budget knob, not a defensive guess.
 */
export const MAX_BODY_CHARS = 40_000;

/**
 * Field limits, shared by the import parser and the route schemas.
 *
 * The parser MUST clamp to the same numbers the create endpoint enforces:
 * otherwise a bundle with an over-long frontmatter `name:` previews cleanly and
 * then 422s the moment the user confirms, which reads as "the product is broken"
 * rather than "your file needs trimming".
 */
export const MAX_NAME_CHARS = 80;
export const MAX_DESCRIPTION_CHARS = 500;

// ---- Import limits ---------------------------------------------------------
// An uploaded archive is attacker-controlled input. It is never written to disk
// and never executed, but it is still decompressed in memory, so all three
// dimensions of a zip bomb need a ceiling. Exceeding any of them is a 422
// (bad input), never a 500.

/** Largest accepted archive, compressed. Below `app.ts`'s 1 MB body limit even after base64 (+33%). */
export const MAX_ZIP_BYTES = 512 * 1024;

/** Largest accepted archive, decompressed — the anti-zip-bomb ratio guard. */
export const MAX_UNPACKED_BYTES = 2 * 1024 * 1024;

/** Most entries we will even enumerate. */
export const MAX_ZIP_ENTRIES = 200;

/**
 * The markdown file we treat as a skill's core, matched case-insensitively at the
 * archive root or inside a single root folder. This is the Anthropic Agent Skills
 * layout, so a skill bundle authored for that ecosystem imports unchanged.
 */
export const SKILL_ENTRY_NAME = 'skill.md';
