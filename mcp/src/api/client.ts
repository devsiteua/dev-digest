import { DevDigestApiError, errorText, type McpErrorCode } from '../errors.js';
import type { ApiErrorBody } from '@devdigest/shared';

/**
 * Infrastructure ring — the only place in this package that speaks HTTP.
 *
 * The fetch implementation is injected rather than reached for, so the unit lane
 * drives every branch below with a scripted stub and needs no network at all.
 *
 * Response shapes are imported as TYPES ONLY, from `./types.ts`. Nothing here is
 * re-validated at runtime, and — since D14 fallback 1 dropped the
 * `@devdigest/shared` alias — nothing checks those shapes against the server at
 * compile time either. Read the header of `./types.ts` for why, and treat the live
 * lane as the guard.
 */

/** The subset of a `Response` this client uses. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** The subset of `RequestInit` this client sends. */
export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Structural type of the injected fetch. The platform's global `fetch` satisfies
 * it, and so does a three-line stub in a test.
 */
export type FetchLike = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

export interface ApiClientOptions {
  /** Origin of the API, without a trailing slash (see `config.ts`). */
  readonly baseUrl: string;
  readonly fetch: FetchLike;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /**
   * Send one request and return its parsed body, or throw a classified
   * {@link DevDigestApiError}. The returned value is asserted, not validated —
   * see the note at the top of this file.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const request = `${method} ${path}`;
    const init: HttpRequestInit = { method, headers: { accept: 'application/json' } };
    if (body !== undefined) {
      init.headers = { ...init.headers, 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    let response: HttpResponse;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      // Nothing came back at all: the API is down, the port is wrong, or the host
      // does not resolve. All three have the same next step for the caller.
      throw new DevDigestApiError({
        code: 'api_unreachable',
        message: errorText('api_unreachable', {
          baseUrl: this.baseUrl,
          request,
          reason: describeTransportFailure(cause),
        }),
        cause,
      });
    }

    if (!response.ok) {
      const envelope = await readErrorEnvelope(response);
      const code = classifyStatus(response.status);
      throw new DevDigestApiError({
        code,
        message: errorText(code, {
          baseUrl: this.baseUrl,
          request,
          apiMessage: envelope?.error.message,
        }),
        status: response.status,
        apiCode: envelope?.error.code ?? null,
        details: envelope?.error.details,
      });
    }

    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new DevDigestApiError({
        code: 'api_error',
        message: errorText('api_error', {
          baseUrl: this.baseUrl,
          request,
          apiMessage: 'the response body was not valid JSON',
        }),
        status: response.status,
        cause,
      });
    }
  }
}

/** HTTP status to the taxonomy of `errors.ts`. */
export function classifyStatus(status: number): McpErrorCode {
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'api_error';
  if (status >= 400) return 'bad_request';
  // A non-2xx that is neither client nor server error (a bare redirect reaching
  // here, say) is still not an answer this client can use.
  return 'api_error';
}

/**
 * Parse the API's stable `{ error: { code, message, details } }` envelope
 * (`server/src/vendor/shared/contracts/platform.ts`).
 *
 * Hand-written rather than a schema parse on purpose: the schema is Zod 3 and
 * lives in another package, and importing it as a value is exactly what this
 * package must not do.
 */
async function readErrorEnvelope(response: HttpResponse): Promise<ApiErrorBody | null> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  return isApiErrorBody(payload) ? payload : null;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

/**
 * One short phrase naming why the request never reached the API.
 *
 * `ECONNREFUSED` is called out by name because it is the overwhelmingly common
 * case — the stack simply is not running — and because it is the one the caller
 * can fix with the command `api_unreachable` already names.
 */
export function describeTransportFailure(error: unknown): string {
  if (isConnectionRefused(error)) return 'the connection was refused: ECONNREFUSED';
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * True when the failure chain carries a refused TCP connection.
 *
 * The platform's fetch reports this as a bland `TypeError: fetch failed` and hides
 * the real reason one or two levels down — in `cause`, and for a multi-address host
 * inside an `AggregateError`'s `errors`. A flat check on the thrown error finds
 * nothing. The depth guard is what stops a self-referential chain from recursing
 * forever.
 */
export function isConnectionRefused(error: unknown, depth = 0): boolean {
  if (depth > 5 || typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code === 'ECONNREFUSED') return true;

  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested) && nested.some((e) => isConnectionRefused(e, depth + 1))) {
    return true;
  }
  return isConnectionRefused((error as { cause?: unknown }).cause, depth + 1);
}
