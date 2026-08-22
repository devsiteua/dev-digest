import type { FeatureModelChoice } from '@devdigest/shared';

/** Constants for the intent layer (L03). */

/**
 * The model one intent derivation uses when the workspace has not picked another.
 *
 * Deliberately NOT `resolveFeatureModel(container, ws, 'review_intent')`. That
 * helper's registry promises its defaults "MIRROR each module's constants, so
 * behaviour is unchanged until a model is explicitly picked" — a promise that can
 * only hold where the module already existed to have a constant. This module is
 * being written now, so the caller asks `container.featureModelOverride()` for the
 * workspace's choice and falls back to this value; a user who picked a model still
 * gets it. Same reasoning as `DEFAULT_CONVENTIONS_MODEL`, and the root
 * `INSIGHTS.md` entry of 2026-08-06 that it came from.
 *
 * Why this model. The call is small and mechanical — a few thousand tokens of PR
 * text in, a few hundred tokens of JSON out — so the deciding factors are price
 * and schema adherence, not reasoning depth. This is already the house default for
 * cheap LLM features here (`onboarding` in the registry, `DEFAULT_CONVENTIONS_MODEL`
 * in conventions), and `OpenRouterProvider` is the most-exercised structured path
 * in this repository.
 *
 * What it costs. OpenRouter's structured-output support is per-ENDPOINT and
 * provider-dependent, so "returns valid JSON" here is a strong convention rather
 * than an API-level contract. Two first-party models enforce the schema at the
 * contract instead, and a workspace switches to either from Settings with no code
 * change:
 *   - Anthropic `claude-haiku-4-5` — $1 / $5 per MTok, guaranteed shape via
 *     `strict: true` on the tool definition;
 *   - OpenAI `gpt-5-mini` — $0.25 / $2 per MTok, `json_schema` with `strict: true`.
 * Neither model id takes a date suffix.
 */
export const DEFAULT_INTENT_MODEL: FeatureModelChoice = {
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
};
