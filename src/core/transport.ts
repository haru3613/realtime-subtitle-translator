/**
 * Real network transport for the translation pipeline (SPEC §7 / §10).
 *
 * Everything else in `src/core/` is pure — no `fetch`, no keys. `pipeline.ts`
 * injects a `Transport = (req) => Promise<unknown>`; THIS is the one seam that
 * actually talks to the network. It stays adapter-thin: POST the already-built
 * `OpenAICompatibleRequest` as JSON to the configured endpoint with a Bearer
 * key, and hand the raw response JSON back for `parseOpenAICompatibleResponse`
 * to validate. The model already travels inside the request body, so the
 * transport never rewrites it.
 */

import type { Transport } from "./pipeline";
import type { OpenAICompatibleRequest } from "./provider";
import { createSseAccumulator } from "./sse";

export interface HttpTransportConfig {
  /** Full chat-completions URL, e.g. https://api.openai.com/v1/chat/completions */
  endpoint: string;
  /** Sent verbatim as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Optional abort hook — cancels the request (and any SSE stream read). */
  signal?: AbortSignal;
}

/** Shared fetch init both transports POST with. */
function requestInit(
  config: HttpTransportConfig,
  req: OpenAICompatibleRequest,
  signal = config.signal,
) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(req),
    signal,
  };
}

/** The subset of the DOM `Response` this transport consumes. */
interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/**
 * Injected network call. The global `fetch` satisfies this narrower type, so a
 * test can pass a small mock without reconstructing the full `Response` shape.
 */
export type FetchImpl = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<JsonResponse>;

export function httpTransport(
  config: HttpTransportConfig,
  fetchImpl: FetchImpl = fetch,
): Transport {
  return async (req, options): Promise<unknown> => {
    const res = await fetchImpl(
      config.endpoint,
      requestInit(config, req, options?.signal),
    );
    // Fail loudly on a transport-level error rather than passing an error body
    // (e.g. a 401 `{"error": ...}`) to the response parser, which would only
    // surface a misleading "no choices" error.
    if (!res.ok) {
      throw new Error(`httpTransport: ${config.endpoint} responded ${res.status}`);
    }
    return res.json();
  };
}

/** The subset of a streaming DOM `Response` this transport consumes. */
interface StreamResponse {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}

export type StreamFetchImpl = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<StreamResponse>;

/**
 * SSE variant of `httpTransport` for `stream: true` requests: reads the
 * response body incrementally, reports accumulated text via `onDelta`, and
 * resolves to a plain chat-completions payload so the same
 * `parseOpenAICompatibleResponse` validates streamed and non-streamed calls.
 */
export function streamingHttpTransport(
  config: HttpTransportConfig,
  fetchImpl: StreamFetchImpl = fetch,
): (
  req: OpenAICompatibleRequest,
  onDelta: (accumulated: string) => void,
) => Promise<unknown> {
  return async (req, onDelta) => {
    const res = await fetchImpl(config.endpoint, requestInit(config, req));
    if (!res.ok) {
      throw new Error(
        `streamingHttpTransport: ${config.endpoint} responded ${res.status}`,
      );
    }
    if (!res.body) {
      throw new Error("streamingHttpTransport: response has no body stream");
    }

    const acc = createSseAccumulator(onDelta);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc.feed(decoder.decode(value, { stream: true }));
    }
    // Some endpoints end the stream without a trailing blank line — don't
    // silently drop that final event.
    acc.flush();
    return { choices: [{ message: { content: acc.text() } }] };
  };
}
