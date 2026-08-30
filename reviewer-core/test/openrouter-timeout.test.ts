/**
 * The wall-clock budget on `completeStructured`.
 *
 * Written after a real `POST /pulls/:id/brief` took 126 s against a 60 s
 * `BRIEF_TIMEOUT_MS`: `req.timeoutMs` was never read, and the constructor's
 * `timeout` bounds ONE SDK attempt, not the call — the SDK retries under it and
 * the repair loop retries over it.
 *
 * No keys and no network: the SDK client is replaced with an in-memory stub, so
 * what is under test is the budget and the signal, not OpenRouter.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider, LlmTimeoutError } from '../src/llm/openrouter.js';

const Schema = z.object({ ok: z.boolean() });

type CreateOpts = { signal: AbortSignal };

/** A provider whose transport never answers, recording the options it was handed. */
function hangingProvider() {
  const provider = new OpenRouterProvider('test-key');
  const seen: CreateOpts[] = [];
  (provider as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: (_body: unknown, opts: CreateOpts) => {
          seen.push(opts);
          return new Promise((_resolve, reject) => {
            // What a real SDK does on abort: reject with its own opaque error.
            opts.signal.addEventListener('abort', () => reject(new Error('Request was aborted.')));
          });
        },
      },
    },
  };
  return { provider, seen };
}

const req = (timeoutMs?: number) => ({
  model: 'test/model',
  schema: Schema,
  schemaName: 'Test',
  messages: [{ role: 'user' as const, content: 'hi' }],
  ...(timeoutMs === undefined ? {} : { timeoutMs }),
});

describe('OpenRouterProvider — the wall-clock budget', () => {
  it('rejects with LlmTimeoutError when the call outlives req.timeoutMs', async () => {
    const { provider } = hangingProvider();
    await expect(provider.completeStructured(req(50))).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it('names the budget in the error, so a 5xx is not mistaken for a timeout', async () => {
    const { provider } = hangingProvider();
    await expect(provider.completeStructured(req(50))).rejects.toThrow(/50ms budget/);
  });

  it('hands the SDK an abort signal and actually fires it — the request is cancelled, not abandoned', async () => {
    const { provider, seen } = hangingProvider();
    await provider.completeStructured(req(50)).catch(() => undefined);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.signal).toBeInstanceOf(AbortSignal);
    // Without this the deadline would only reject the promise while the request
    // kept running, still spending tokens nobody is waiting for.
    expect(seen[0]!.signal.aborted).toBe(true);
  });

  it('leaves a call that answers in time completely alone', async () => {
    const provider = new OpenRouterProvider('test-key');
    (provider as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 7, completion_tokens: 3 },
          }),
        },
      },
    };
    const res = await provider.completeStructured(req(50_000));
    expect(res.data).toEqual({ ok: true });
    expect(res.attempts).toBe(1);
    expect(res.tokensIn).toBe(7);
  });

  it('does not restart the budget for each retry — one signal covers every attempt', async () => {
    // Two attempts: the first returns unparseable content so the repair loop runs
    // again. The same signal must reach both, or a schema miss would buy a second
    // full budget.
    const provider = new OpenRouterProvider('test-key');
    const signals: AbortSignal[] = [];
    let call = 0;
    (provider as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: async (_body: unknown, opts: CreateOpts) => {
            signals.push(opts.signal);
            call += 1;
            return {
              choices: [{ message: { content: call === 1 ? 'not json' : '{"ok":true}' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          },
        },
      },
    };
    const res = await provider.completeStructured(req(50_000));
    expect(res.attempts).toBe(2);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
  });
});
