import OpenAI from 'openai';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { toJsonSchema, parseWithRepair } from './structured.js';

/**
 * The single OpenAI-compatible structured provider, owned by the engine because
 * BOTH consumers need it: the CI runner (the GitHub Action runs reviewer-core
 * directly) and the studio server's openrouter path. Centralizing it here means
 * session grouping, the no-choices guard, the wall-clock timeout, and the
 * parse-with-repair loop live in ONE place instead of being duplicated.
 *
 * OpenRouter is OpenAI-compatible, so we drive it with the OpenAI SDK pointed at
 * its baseURL. Only completeStructured is needed by reviewPullRequest; the rest
 * are stubs. Cost attribution is INJECTED (`estimateCost`) so the engine stays
 * free of a pricing table — the server passes its own, the runner passes none.
 */

const NOT_SUPPORTED = 'OpenRouterProvider only implements completeStructured';

/** Matches `DEFAULT_TIMEOUT` in the server's openai/anthropic adapters. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Thrown when `req.timeoutMs` runs out. Named so a caller can tell it from a 5xx. */
export class LlmTimeoutError extends Error {
  constructor(ms: number) {
    super(`OpenRouter call exceeded its ${ms}ms budget`);
    this.name = 'LlmTimeoutError';
  }
}

export interface OpenRouterProviderOptions {
  /** OpenAI-compatible base URL (default: OpenRouter). */
  baseURL?: string;
  /** Provider id for traces/gating (default 'openrouter'). */
  id?: 'openai' | 'openrouter';
  /**
   * PER-ATTEMPT socket timeout (ms) handed to the SDK, which retries on
   * timeout/5xx/429 with backoff — so it does NOT bound how long a call takes.
   * The wall-clock bound is `StructuredRequest.timeoutMs`, enforced below.
   */
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected cost estimator; returns USD or null when the model is unknown. */
  estimateCost?: (model: string, tokensIn: number, tokensOut: number) => number | null;
}

export class OpenRouterProvider implements LLMProvider {
  readonly id: 'openai' | 'openrouter';
  private client: OpenAI;
  private baseURL: string;
  private apiKey: string;
  private estimateCost?: OpenRouterProviderOptions['estimateCost'];

  constructor(apiKey: string, opts: OpenRouterProviderOptions = {}) {
    this.id = opts.id ?? 'openrouter';
    this.apiKey = apiKey;
    this.baseURL = opts.baseURL ?? 'https://openrouter.ai/api/v1';
    this.estimateCost = opts.estimateCost;
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      timeout: opts.timeoutMs ?? 90_000,
      maxRetries: opts.maxRetries ?? 2,
    });
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    const maxRetries = req.maxRetries ?? 2;
    const messages = [...req.messages];
    let tokensIn = 0;
    let tokensOut = 0;
    let costFromApi: number | null = null;
    let lastRaw = '';

    /**
     * `req.timeoutMs` is a WALL-CLOCK budget for the whole call, and it is
     * enforced here because nothing else can enforce it.
     *
     * The constructor's `timeout` is the SDK's PER-ATTEMPT limit, and the SDK
     * retries on timeout / 5xx / 429 (`maxRetries`, default 2). The repair loop
     * below then re-runs all of that up to `maxRetries + 1` times more on a
     * schema miss. Three inside three is nine, so the 90 s default never bounded
     * anything a caller waits on: a real `POST /pulls/:id/brief` measured 126 s
     * against a 60 s `BRIEF_TIMEOUT_MS`, with neither number doing any work.
     *
     * An AbortController rather than the `Promise.race` the server's sibling
     * adapters use: racing abandons the request but leaves it in flight, still
     * spending tokens nobody is waiting for. This cancels it. ONE signal covers
     * every attempt, so a retry does not restart the budget.
     */
    const budgetMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const abort = new AbortController();
    const deadline = budgetMs > 0 ? setTimeout(() => abort.abort(), budgetMs) : undefined;
    try {
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        // The SDK surfaces an abort as its own opaque error; check first so the
        // caller gets a timeout it can name.
        if (abort.signal.aborted) throw new LlmTimeoutError(budgetMs);
        const res = await this.client.chat.completions.create({
          model: req.model,
          messages,
          temperature: req.temperature ?? 0,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          response_format: {
            type: 'json_schema',
            json_schema: { name: req.schemaName, schema: jsonSchema.schema, strict: true },
          },
          // OpenRouter session grouping — extra body field (spread is exempt from
          // excess-property checks). Only sent when talking to OpenRouter.
          ...(this.id === 'openrouter' && req.sessionId ? { session_id: req.sessionId } : {}),
          // OpenRouter usage accounting — ask it to return the REAL generation
          // cost (USD) in `usage.cost`, instead of estimating from a price book.
          ...(this.id === 'openrouter' ? { usage: { include: true } } : {}),
        },
        // The signal is what makes the budget real: without it the deadline only
        // rejects the promise while the request keeps running and keeps billing.
        { signal: abort.signal });

        // OpenRouter can return HTTP 200 with no `choices` (an upstream provider
        // error / moderation / free-tier limit in the body) — surface it.
        const choice = res.choices?.[0];
        if (!choice) {
          const errMsg = (res as unknown as { error?: { message?: string } }).error?.message;
          throw new Error(`OpenRouter returned no choices for ${req.schemaName}${errMsg ? `: ${errMsg}` : ''}`);
        }
        lastRaw = choice.message?.content ?? '';
        tokensIn += res.usage?.prompt_tokens ?? 0;
        tokensOut += res.usage?.completion_tokens ?? 0;
        // `usage.cost` is an OpenRouter extension (USD), absent from the OpenAI SDK type.
        const apiCost = (res.usage as { cost?: number } | null | undefined)?.cost;
        if (typeof apiCost === 'number') costFromApi = (costFromApi ?? 0) + apiCost;

        const parsed = parseWithRepair(req.schema, lastRaw);
        if (parsed.ok) {
          return {
            data: parsed.data,
            model: req.model,
            tokensIn,
            tokensOut,
            costUsd: costFromApi ?? this.estimateCost?.(req.model, tokensIn, tokensOut) ?? null,
            raw: lastRaw,
            attempts: attempt,
          };
        }
        messages.push({ role: 'assistant', content: lastRaw });
        messages.push({ role: 'user', content: parsed.repromptMessage });
      }
      throw new Error(`OpenRouter structured output failed schema validation for ${req.schemaName}`);
    } catch (err) {
      // An abort reaching here is ours, not the caller's: translate, never leak.
      if (abort.signal.aborted) throw new LlmTimeoutError(budgetMs);
      throw err;
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

  /**
   * List models with pricing from the OpenRouter `/models` endpoint (the OpenAI
   * SDK's models.list strips the `pricing` field, so we fetch raw). Prices are
   * converted from per-token to USD per 1M tokens; cheapest output first.
   */
  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseURL}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    const models: ModelInfo[] = (json.data ?? []).map((m) => {
      const prompt = Number(m.pricing?.prompt);
      const completion = Number(m.pricing?.completion);
      // OpenRouter uses -1 as a sentinel for variable-priced router pseudo-models
      // (openrouter/auto etc.) — treat negatives as "unknown" so they don't show
      // as $-1000000 and don't sort to the top of the cheapest list.
      const pricing =
        Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
          ? { promptPerM: prompt * 1_000_000, completionPerM: completion * 1_000_000 }
          : null;
      return {
        id: m.id,
        provider: 'openrouter' as const,
        label: m.name ?? null,
        pricing,
        contextLength: m.context_length ?? null,
      };
    });
    return models.sort(
      (a, b) => (a.pricing?.completionPerM ?? Infinity) - (b.pricing?.completionPerM ?? Infinity),
    );
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error(NOT_SUPPORTED);
  }
  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(NOT_SUPPORTED);
  }
}
