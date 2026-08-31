/**
 * Literals of the multi-agent module. Every number the grouping, conflict and
 * estimate rules depend on lives here rather than inline in `helpers.ts`, so a
 * reader can see the whole tuning surface of the feature in one file.
 */

/**
 * How far apart two findings' line ranges may sit and still describe the same
 * place. Overlapping ranges are always the same place; beyond that, this is the
 * gap in lines between them.
 *
 * Small on purpose: a wide window merges two genuinely different problems in the
 * same function into one group, and a group is the unit a reviewer reads as
 * "the agents mean this one thing".
 */
export const GROUP_LINE_WINDOW = 5;

/**
 * Minimum Jaccard similarity of two findings' normalised title token sets for
 * them to join the same group. 0.5 = half the words they use between them are
 * shared, which is what two agents naming the same defect look like without
 * either an embedding or a model call.
 */
export const GROUP_TITLE_SIMILARITY = 0.5;

/**
 * How many completed runs an estimate averages over. The point of a cap is that
 * an agent whose prompt or model changed months ago should not be judged by runs
 * from before the change; the caller hands the most recent runs first.
 */
export const ESTIMATE_MAX_SAMPLES = 10;

/**
 * Words the title normaliser drops before comparing two titles. They are the
 * words review findings all share, so leaving them in inflates the similarity of
 * two unrelated titles towards the threshold.
 *
 * Deliberately short: a long stopword list is a second tuning surface that has to
 * be maintained against the models' phrasing, and everything here is a word that
 * carries no defect-specific meaning at all.
 */
export const TITLE_STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'may',
  'not',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'there',
  'this',
  'to',
  'was',
  'when',
  'which',
  'will',
  'with',
  'would',
]);
