import { z } from 'zod';

/**
 * Pure ring — every tool's input and output schema, and the flat argument fields
 * they are built from.
 *
 * Two rules shape this file, and both come from the plan rather than from taste:
 *
 * 1. **A tool input is flat.** Every property is a string, number, boolean or
 *    enum; there is no nested object anywhere. A model fills a flat argument list
 *    reliably and a nested one badly, and `test/tool-surface.test.ts` asserts the
 *    published JSON Schema still holds to it.
 * 2. **A shared field is declared once.** `repo`, `pr`, `agent`,
 *    `response_format` and `limit` mean the same thing in every tool that takes
 *    them, so they are defined here once and reused. Five copies of the same
 *    `.describe()` would drift, and the description is what the model reads.
 *
 * Outputs are allowed to nest — a finding is an object and pretending otherwise
 * would flatten away the payload's shape — but they are all rooted in an object,
 * which is what the SDK requires of an `outputSchema` it advertises.
 */

/** The five tools this server publishes, and the only five it ever will. */
export const TOOL_NAMES = [
  'list_agents',
  'run_agent_on_pr',
  'get_findings',
  'get_conventions',
  'get_blast_radius',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// The shared flat fields. Declared once; reused by every schema below.
// ---------------------------------------------------------------------------

const repoField = z
  .string()
  .min(1)
  .describe(
    'A repository as owner/name, exactly as it was imported into DevDigest — for example ' +
      '"acme/payments-api". Not a URL, and not an internal id.',
  );

const prField = z
  .number()
  .int()
  .positive()
  .describe(
    'The pull request number as the hosting platform shows it — for example 482. Not the ' +
      "internal DevDigest id of the pull request.",
  );

const agentField = z
  .string()
  .min(1)
  .describe(
    'A reviewer agent, given as the name or the slug that list_agents returned — for example ' +
      '"Security Reviewer" or "security-reviewer". Matching is case-insensitive. An internal ' +
      'UUID is accepted too, but nothing should ever need one.',
  );

const responseFormatField = z
  .enum(['concise', 'detailed'])
  .default('concise')
  .describe(
    '"concise" (the default) keeps each entry to what you need to act on. "detailed" adds the ' +
      'rationale, the suggested fix, the confidence and the category, and produces a materially ' +
      'larger response.',
  );

/**
 * `limit` differs only in how many is sensible per tool, so the field is one
 * declaration taking that number — not one declaration per tool.
 *
 * Truncation is never silent: the response always reports the full total beside
 * the truncated list (`total_findings` for a review, the `accepted` count for
 * conventions), so a caller can always see that something was dropped.
 */
const limitField = (defaultValue: number, max: number) =>
  z
    .number()
    .int()
    .min(1)
    .max(max)
    .default(defaultValue)
    .describe(
      `How many entries to return at most. Defaults to ${defaultValue}, maximum ${max}. ` +
        'The response always reports the untruncated total, so a smaller limit never hides ' +
        'the fact that there was more.',
    );

// ---------------------------------------------------------------------------
// Inputs — flat, always. One `z.object({...})` per tool (the raw-shape form the
// SDK also accepts is deprecated).
// ---------------------------------------------------------------------------

export const listAgentsInput = z.object({});

export const runAgentOnPrInput = z.object({
  repo: repoField,
  pr: prField,
  agent: agentField,
  response_format: responseFormatField,
});

export const getFindingsInput = z.object({
  repo: repoField,
  pr: prField,
  // Optional here and required on run_agent_on_pr: omitting it means "the most
  // recent review", which is a question only this tool can answer.
  agent: agentField.optional(),
  response_format: responseFormatField,
  limit: limitField(20, 100),
});

export const getConventionsInput = z.object({
  repo: repoField,
  response_format: responseFormatField,
  limit: limitField(50, 200),
});

export const getBlastRadiusInput = z.object({
  repo: repoField,
  pr: prField,
});

// ---------------------------------------------------------------------------
// Outputs. Every tool declares one, and every non-error result carries a
// `structuredContent` that satisfies it plus the same payload as a JSON text
// block for clients that do not read structured output.
// ---------------------------------------------------------------------------

export const listAgentsOutput = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      /** Derived in this package by kebab-casing the name — there is no slug column. */
      slug: z.string(),
      provider: z.string(),
      model: z.string(),
      enabled: z.boolean(),
      description: z.string(),
    }),
  ),
});

const findingOutput = z.object({
  severity: z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']),
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  // Present only in the "detailed" form.
  id: z.string().optional(),
  category: z.string().optional(),
  rationale: z.string().optional(),
  suggestion: z.string().nullable().optional(),
  confidence: z.number().optional(),
});

/**
 * The run the findings came from. Every field is nullable because the two tools
 * that emit it know different amounts: `run_agent_on_pr` polled the run row and
 * fills all of it, while `get_findings` read a persisted review and knows only
 * the id it was written with. A null here means "not read", never "zero".
 */
const runOutput = z.object({
  id: z.string().nullable(),
  status: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});

/**
 * One shape for `run_agent_on_pr` and `get_findings`, because the `get_findings`
 * description promises exactly that ("Returns the same shape as run_agent_on_pr").
 *
 * `reviewed` is what keeps "nobody has reviewed this pull request" from being
 * served as an empty findings list — the distinction the tool description makes
 * in words, made in the structured payload too.
 */
const reviewResultOutput = z.object({
  repo: z.string(),
  pr: z.number().int(),
  reviewed: z.boolean(),
  agent: z.string().nullable(),
  verdict: z.enum(['request_changes', 'approve', 'comment']).nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  response_format: z.enum(['concise', 'detailed']),
  findings: z.array(findingOutput),
  /** The untruncated count. Greater than `findings.length` means `limit` dropped some. */
  total_findings: z.number().int(),
  run: runOutput,
});

export const runAgentOnPrOutput = reviewResultOutput;
export const getFindingsOutput = reviewResultOutput;

export const getConventionsOutput = z.object({
  repo: z.string(),
  /** Counts over every stored candidate, not over the truncated list below. */
  accepted: z.number().int(),
  pending: z.number().int(),
  rejected: z.number().int(),
  response_format: z.enum(['concise', 'detailed']),
  conventions: z.array(
    z.object({
      rule: z.string(),
      category: z.string(),
      /** `path:line`, re-joined from the two integer columns the candidate stores. */
      evidence: z.string(),
      // Present only in the "detailed" form.
      evidence_snippet: z.string().optional(),
      confidence: z.number().optional(),
    }),
  ),
});

/**
 * The stub's shape, and deliberately the whole of it: no `changed_symbols`, no
 * `downstream`, not even as empty arrays (D13). An empty array is the exact lie
 * this tool exists to avoid — it reads as "this pull request affects nothing".
 */
export const getBlastRadiusOutput = z.object({
  status: z.literal('not_implemented'),
  implemented_in: z.string(),
  message: z.string(),
});
