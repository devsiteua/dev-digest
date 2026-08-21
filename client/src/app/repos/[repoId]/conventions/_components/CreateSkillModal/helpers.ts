import type { ConventionCandidate, SkillType } from "@devdigest/shared";
import { evidenceLabel } from "../../helpers";
import {
  DEFAULT_SKILL_NAME,
  DEFAULT_SKILL_TYPE,
  SLUG_MAX_WORDS,
  SLUG_STOP_WORDS,
} from "./constants";

/** The fields the modal edits, and the shape `ConventionSkillRequest` is built from. */
export interface SkillFormDraft {
  name: string;
  description: string;
  type: SkillType;
  enabled: boolean;
  body: string;
}

/**
 * The sentences the draft is written in. Passed in rather than read here, because
 * the body is user-facing copy and lives in `messages/en/conventions.json` —
 * this file stays a pure string builder and can be tested without next-intl.
 */
export interface DraftCopy {
  description: string;
  /** The line under the heading, naming the repo and what the agent should do. */
  intro: string;
  /** "Detected in `src/api/users.ts:23-31`:" for one evidence label. */
  detected: (evidence: string) => string;
}

/**
 * `Always return early with a typed error` → `return-early-typed-error`.
 * A section anchor, not an identifier: lossy on purpose, and only ever read by
 * a human scanning the merged body.
 */
export function slugifyRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter((w) => w && !SLUG_STOP_WORDS.includes(w))
    .slice(0, SLUG_MAX_WORDS)
    .join("-");
}

/**
 * The accepted candidates, merged into one editable skill draft (design N7
 * `conventionsToDraft`).
 *
 * Whatever is in `accepted` ends up in the body — the filtering is the caller's,
 * and the caller passes only `status === 'accepted'` rows. That is the acceptance
 * criterion this screen turns on: a rejected or undecided rule must not reach a
 * prompt through the back door of a merged body. The server enforces the same
 * thing again on `convention_ids`, so the two disagree loudly rather than
 * quietly.
 *
 * Each rule becomes a section carrying its own evidence, because the body is the
 * ONLY thing the model ever sees: a rule with no `file:line` under it is an
 * assertion, and a rule with one can be checked.
 */
export function conventionsToDraft(
  accepted: ConventionCandidate[],
  copy: DraftCopy,
): SkillFormDraft {
  const sections = accepted.map((c, i) => {
    const slug = slugifyRule(c.rule) || `rule-${i + 1}`;
    return [
      `## ${slug}`,
      c.rule,
      "",
      copy.detected(evidenceLabel(c)),
      "",
      "```",
      c.evidence_snippet,
      "```",
    ].join("\n");
  });

  return {
    name: DEFAULT_SKILL_NAME,
    description: copy.description,
    type: DEFAULT_SKILL_TYPE,
    enabled: true,
    body: [`# ${DEFAULT_SKILL_NAME}`, "", copy.intro, "", sections.join("\n\n")]
      .join("\n")
      .trimEnd(),
  };
}
