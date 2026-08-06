/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * Budget for the assembled `## Skills / rules` section, in characters.
 * `reviewer-core/docs/prompt-contract.md` rule 6 requires every slot to have one.
 *
 * Two reasons this matters more than it looks. A skill body is author-controlled
 * and unbounded, and under the `map-reduce` strategy `assemblePrompt` runs once
 * per changed file — so the section's cost is multiplied by the file count.
 *
 * When the budget is exceeded we drop WHOLE skills from the tail of the ordered
 * list rather than truncating a body mid-sentence: half a rule is worse than no
 * rule, because the model still tries to apply it. What was dropped is logged.
 */
export const MAX_SKILLS_CHARS = 24_000;
