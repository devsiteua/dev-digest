import type { SkillType } from "@devdigest/shared";

/** Design N7 artboard `conv-create` opens at 760px. */
export const MODAL_WIDTH = 760;

/**
 * The merged skill's default name.
 *
 * A constant, not a translated string: it is an identifier the server writes to
 * `skills.name` and the prompt renders verbatim — the same on every locale. The
 * design slugifies the first rule when a single card is merged; L02 asks for one
 * predictable name per repo instead, so a re-merge is recognisable as a re-merge.
 */
export const DEFAULT_SKILL_NAME = "repo-conventions";

/** House rules are conventions — the other three are one click away. */
export const DEFAULT_SKILL_TYPE: SkillType = "convention";

export const TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Rows of the body editor. `@devdigest/ui` has no CodeEditor — a mono Textarea
    plus the token counter is what the skill editor uses, and this mirrors it. */
export const BODY_ROWS = 16;

/** Keep in step with MAX_BODY_CHARS in the server's skills module. */
export const MAX_BODY_CHARS = 40_000;

/** Words dropped when a rule is turned into a section slug. */
export const SLUG_STOP_WORDS: readonly string[] = [
  "always",
  "use",
  "the",
  "a",
  "an",
  "to",
  "of",
  "instead",
  "must",
  "should",
  "all",
  "in",
  "via",
  "through",
  "are",
  "is",
  "and",
  "with",
  "for",
];

/** How many words survive into a slug — `## error-handling-typed-result`. */
export const SLUG_MAX_WORDS = 4;
