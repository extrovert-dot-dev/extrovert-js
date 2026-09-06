/**
 * fetch-based transport for the Extrovert API.
 *
 * Runtime-agnostic: uses the global `fetch` (Node 18+, Cloudflare Workers, Vercel Edge, Deno,
 * browsers). No Node-only APIs, no dependencies. Retries idempotent requests with jittered backoff
 * on 429/5xx, honors `Retry-After`, and surfaces every failure as a typed {@link ApiError}.
 */

import {
  ApiError,
  ConnectionError,
  TimeoutError,
  errorForStatus,
  type ApiErrorBody,
} from "./errors.js";
import { parseProblem, type Problem } from "./problem.js";
import { API_VERSION_HEADER, CURRENT_API_VERSION } from "./version.js";

/** The library version, surfaced in the User-Agent. Kept in sync with package.json by build. */
export const SDK_VERSION = "0.1.0-pre.13";

export interface RetryOptions {
  /** Max retry attempts for idempotent requests on 429/5xx/network errors. Default 2. */
  maxRetries: number;
  /** Base backoff in ms (grows exponentially with jitter). Default 250. */
  baseDelayMs: number;
  /** Cap on a single backoff delay. Default 8000. */
  maxDelayMs: number;
}

export interface RequestOptions {
  method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT";
  path: string;
  /** Query params; undefined/null values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** JSON body; serialized as `application/json`. */
  body?: unknown;
  /** Per-request idempotency key, sent as the `Idempotency-Key` header. */
  idempotencyKey?: string;
  /** Per-request timeout override (ms). */
  timeoutMs?: number;
  /** Per-request abort signal, merged with the timeout signal. */
  signal?: AbortSignal;
  /** Force this request to be treated as (non-)retryable, overriding the method default. */
  retryable?: boolean;
  /**
   * Return the raw response body as text instead of JSON-parsing it. Used for the
   * raw `.eml` download (Content-Type `message/rfc822`), which is not JSON.
   */
  raw?: boolean;
  /**
   * Return the raw response as binary, alongside the Content-Type and
   * Content-Disposition headers. Used for the attachment download (arbitrary
   * bytes), which must not pass through text/JSON decoding.
   */
  binary?: boolean;
}

/** A binary response body plus the headers needed to save/serve it. */
export interface BinaryResponse {
  bytes: Uint8Array;
  contentType: string;
  contentDisposition: string;
}

export interface HttpClientConfig {
  baseUrl: string;
  apiKey: string;
  /** Default timeout in ms. Default 30000. wait_for_email overrides this per call. */
  timeoutMs: number;
  retry: RetryOptions;
  /** Custom fetch (e.g. for tests or a proxy). Defaults to the global fetch. */
  fetch: typeof fetch;
  /** Extra headers merged into every request. */
  defaultHeaders: Record<string, string>;
  /**
   * Dated API version pinned on every request as the `Extrovert-Version` header
   * (redesign §5.4). Defaults to {@link CURRENT_API_VERSION}.
   */
  apiVersion: string;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: RequestOptions["query"],
): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const rel = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(base + rel);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new TimeoutError("Aborted during backoff"));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new TimeoutError("Aborted during backoff"));
      },
      { once: true },
    );
  });
}

/** Compose the caller's signal with a timeout into a single AbortSignal. */
function withTimeout(timeoutMs: number, signal?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort((signal as AbortSignal & { reason?: unknown })?.reason);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new TimeoutError()), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export class HttpClient {
  constructor(private readonly config: HttpClientConfig) {}

  async request<T>(options: RequestOptions): Promise<T> {
    const url = buildUrl(this.config.baseUrl, options.path, options.query);
    const retryable =
      options.retryable ?? (options.method === "GET" || options.method === "DELETE");
    const maxAttempts = retryable ? this.config.retry.maxRetries + 1 : 1;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;

    let lastError: ApiError | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { signal, cancel } = withTimeout(timeoutMs, options.signal);
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.config.apiKey}`,
          // Accept problem+json (redesign) alongside json so the typed Problem body parses.
          Accept: "application/json, application/problem+json",
          "User-Agent": `extrovert-sdk-ts/${SDK_VERSION}`,
          // Pin the dated API version on every request (redesign §5.4).
          [API_VERSION_HEADER]: this.config.apiVersion || CURRENT_API_VERSION,
          ...this.config.defaultHeaders,
        };
        if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
        let bodyInit: string | undefined;
        if (options.body !== undefined) {
          headers["Content-Type"] = "application/json";
          bodyInit = JSON.stringify(options.body);
        }

        const response = await this.config.fetch(url, {
          method: options.method,
          redirect: "error",
          headers,
          body: bodyInit,
          signal,
        });

        if (response.ok) {
          cancel();
          if (response.status === 204) return undefined as T;
          // Binary requests (e.g. attachment bytes) return the raw bytes plus the
          // headers needed to save/serve the file, before any text decoding.
          if (options.binary) {
            const buf = new Uint8Array(await response.arrayBuffer());
            const binary: BinaryResponse = {
              bytes: buf,
              contentType: response.headers.get("content-type") ?? "application/octet-stream",
              contentDisposition: response.headers.get("content-disposition") ?? "",
            };
            return binary as unknown as T;
          }
          const text = await response.text();
          // Raw requests (e.g. message/rfc822 .eml) return the body verbatim.
          if (options.raw) return text as unknown as T;
          return (text ? JSON.parse(text) : undefined) as T;
        }

        const apiError = await toApiError(response);
        cancel();
        // Retry transient failures on idempotent requests.
        if (retryable && attempt < maxAttempts - 1 && isRetryableStatus(response.status)) {
          lastError = apiError;
          await sleep(this.backoff(attempt, apiError), options.signal);
          continue;
        }
        throw apiError;
      } catch (err) {
        cancel();
        if (err instanceof ApiError) {
          // Already a typed API error (thrown above) - propagate.
          if (!(err.isServerError && retryable && attempt < maxAttempts - 1)) throw err;
          lastError = err;
          await sleep(this.backoff(attempt, err), options.signal);
          continue;
        }
        // Transport-level failure (network, abort, timeout).
        const transportError = this.classifyTransportError(err);
        if (retryable && attempt < maxAttempts - 1 && transportError instanceof ConnectionError) {
          lastError = transportError;
          await sleep(this.backoff(attempt), options.signal);
          continue;
        }
        throw transportError;
      }
    }
    // Exhausted retries.
    throw lastError ?? new ConnectionError("Request failed after retries");
  }

  /**
   * Open a Server-Sent-Events stream and yield each parsed frame as it arrives.
   *
   * This bypasses the JSON request/retry path: it does a single streaming `fetch`,
   * reads the response body incrementally, splits it on the SSE frame delimiter
   * (a blank line), and yields one {@link SseFrame} per frame (skipping comment
   * heartbeats). The connection stays open until the server closes it or the
   * caller's `signal` aborts. Reconnection/resume is the caller's job (re-call with
   * the last `id` as Last-Event-ID), so this primitive stays small and predictable.
   */
  async *stream(options: {
    path: string;
    query?: RequestOptions["query"];
    lastEventId?: string;
    signal?: AbortSignal;
  }): AsyncGenerator<SseFrame, void, unknown> {
    const url = buildUrl(this.config.baseUrl, options.path, options.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: "text/event-stream",
      "User-Agent": `extrovert-sdk-ts/${SDK_VERSION}`,
      [API_VERSION_HEADER]: this.config.apiVersion || CURRENT_API_VERSION,
      ...this.config.defaultHeaders,
    };
    if (options.lastEventId) headers["Last-Event-ID"] = options.lastEventId;

    let response: Response;
    try {
      // No timeout: an SSE stream is intentionally long-lived. Only the caller's
      // signal closes it.
      response = await this.config.fetch(url, { method: "GET", headers, signal: options.signal });
    } catch (err) {
      throw this.classifyTransportError(err);
    }
    if (!response.ok) {
      throw await toApiError(response);
    }
    const body = response.body;
    if (!body) {
      throw new ConnectionError("SSE response had no readable body");
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Frames are separated by a blank line. Tolerate both \n\n and \r\n\r\n.
        let sep: number;
        while ((sep = indexOfFrameSeparator(buffer)) !== -1) {
          const rawFrame = buffer.slice(0, sep);
          buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, "");
          const frame = parseSseFrame(rawFrame);
          if (frame) yield frame;
        }
      }
    } finally {
      // Best-effort close of the underlying stream when the consumer stops early.
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
  }

  private backoff(attempt: number, error?: ApiError): number {
    if (error && "retryAfter" in error && typeof error.retryAfter === "number") {
      return Math.min(error.retryAfter * 1000, this.config.retry.maxDelayMs);
    }
    const exp = this.config.retry.baseDelayMs * 2 ** attempt;
    const jitter = Math.random() * this.config.retry.baseDelayMs;
    return Math.min(exp + jitter, this.config.retry.maxDelayMs);
  }

  private classifyTransportError(err: unknown): ApiError {
    if (err instanceof TimeoutError) return err;
    const name = (err as { name?: string })?.name;
    if (name === "AbortError" || name === "TimeoutError") {
      return new TimeoutError("Request timed out or was aborted", err);
    }
    const message = err instanceof Error ? err.message : String(err);
    return new ConnectionError(`Network request failed: ${message}`, err);
  }
}

/** One parsed Server-Sent-Events frame: the `id:`, `event:`, and joined `data:`. */
export interface SseFrame {
  /** The `id:` field - the monotonic resume token (Last-Event-ID). */
  id?: string;
  /** The `event:` field - the event type. Defaults to `"message"` per the SSE spec. */
  event: string;
  /** The joined `data:` lines (newline-separated, per the SSE spec). */
  data: string;
}

/** Index of the next frame separator (blank line) in an SSE buffer, or -1. */
function indexOfFrameSeparator(buf: string): number {
  const lf = buf.indexOf("\n\n");
  const crlf = buf.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

/**
 * Parse one raw SSE frame (the text between blank-line delimiters) into a
 * {@link SseFrame}. Comment lines (starting with `:`, e.g. heartbeats) and frames
 * with no `data` yield `undefined` so callers skip them.
 */
function parseSseFrame(raw: string): SseFrame | undefined {
  let id: string | undefined;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // A single leading space after the colon is stripped, per the SSE spec.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "id":
        id = value;
        break;
      case "event":
        event = value;
        break;
      case "data":
        dataLines.push(value);
        break;
      default:
        // ignore unknown fields (e.g. retry:)
        break;
    }
  }
  if (dataLines.length === 0) return undefined;
  return { id, event, data: dataLines.join("\n") };
}

/** Build a typed error from a non-2xx response, parsing the JSON envelope when present. */
async function toApiError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const retryAfterRaw = response.headers.get("retry-after");
  const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
  const paymentRequired = response.headers.get("payment-required") ?? undefined;

  let body: ApiErrorBody | undefined;
  let problem: Problem | undefined;
  let code = `http_${response.status}`;
  let message = `Extrovert API request failed with status ${response.status}`;
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text) as unknown;
      // Redesign surface: RFC-9457 problem+json (has a closed `code`).
      const parsedProblem = parseProblem(parsed);
      if (parsedProblem) {
        problem = parsedProblem.problem;
        code = parsedProblem.rawCode || code;
        message = parsedProblem.problem.detail || parsedProblem.problem.title || message;
        // Mirror onto the legacy body shape so `.body.error.code` still resolves.
        body = { error: { code, message }, request_id: parsedProblem.problem.request_id };
      } else if (parsed && typeof parsed === "object") {
        // LEGACY envelope. Two shapes are in the wild and BOTH must parse, or the
        // caller gets `http_409` and no server message - which is exactly what
        // happened until now, and why review-loop code could only branch on
        // `err.status`:
        //
        //   (a) `{ error: { code, message } }` - the nested form this parser was
        //       written for.
        //   (b) `{ error: "conflict", message: "…" }` - what the Go `writeError`
        //       helper actually emits (a STRING `error` plus a TOP-LEVEL
        //       `message`), still used by every `/v1/admin/*` route.
        //
        // Reading only (a) against a (b) body yields `undefined` for BOTH halves.
        // The code fell back to `http_<status>` and the message to the generic
        // "request failed with status N" - losing the one string that says WHY.
        const legacy = parsed as {
          error?: string | { code?: string; message?: string; details?: Record<string, unknown> };
          message?: string;
          request_id?: string;
        };
        const legacyCode =
          typeof legacy.error === "string" ? legacy.error : legacy.error?.code;
        const legacyMessage =
          (typeof legacy.error === "object" ? legacy.error?.message : undefined) ?? legacy.message;
        if (legacyCode || legacyMessage) {
          code = legacyCode || code;
          message = legacyMessage || message;
          // Normalize onto the nested ApiErrorBody shape so `.body.error.code`
          // resolves for both wire spellings.
          body = {
            error: {
              code,
              message,
              ...(typeof legacy.error === "object" && legacy.error?.details
                ? { details: legacy.error.details }
                : {}),
            },
            ...(legacy.request_id ? { request_id: legacy.request_id } : {}),
          };
        }
      }
    }
  } catch {
    // Non-JSON error body; keep the generic message.
  }

  return errorForStatus({
    status: response.status,
    code,
    message,
    requestId: problem?.request_id ?? requestId,
    body,
    problem,
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
    paymentRequired,
  });
}
