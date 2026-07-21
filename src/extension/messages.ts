/**
 * Extension message protocol (content script ↔ background).
 * Translation HTTP and caption timedtext fetch run in the service worker so
 * host_permissions apply and page CORS does not block them.
 */

import type { OpenAICompatibleRequest } from "../core/provider";

export const TRANSLATE_MESSAGE_TYPE = "rst.translate" as const;
export const CANCEL_TRANSLATE_MESSAGE_TYPE = "rst.cancelTranslate" as const;
export const FETCH_TEXT_MESSAGE_TYPE = "rst.fetchText" as const;

/**
 * Streaming translation runs over a dedicated runtime Port (one per request):
 * content posts `{ request }`, background answers with a sequence of
 * `{ delta }` events and closes with `{ done, data }` or `{ error }`.
 */
export const TRANSLATE_STREAM_PORT_NAME = "rst.translateStream" as const;

export interface StreamStartMessage {
  request: OpenAICompatibleRequest;
}

export type StreamEventMessage =
  | { delta: string }
  | { done: true; data: unknown }
  | { error: string };

export interface TranslateRequestMessage {
  type: typeof TRANSLATE_MESSAGE_TYPE;
  id: string;
  request: OpenAICompatibleRequest;
}

export type TranslateResponseMessage =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export interface CancelTranslateRequestMessage {
  type: typeof CANCEL_TRANSLATE_MESSAGE_TYPE;
  id: string;
}

export interface FetchTextRequestMessage {
  type: typeof FETCH_TEXT_MESSAGE_TYPE;
  url: string;
}

export type FetchTextResponseMessage =
  | { ok: true; text: string }
  | { ok: false; error: string };

function isRequestShape(req: unknown): req is OpenAICompatibleRequest {
  if (req === null || typeof req !== "object") return false;
  const r = req as Record<string, unknown>;
  return typeof r.model === "string" && Array.isArray(r.messages);
}

export function isTranslateRequest(msg: unknown): msg is TranslateRequestMessage {
  if (msg === null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === TRANSLATE_MESSAGE_TYPE &&
    typeof m.id === "string" &&
    m.id !== "" &&
    isRequestShape(m.request)
  );
}

export function isStreamStart(msg: unknown): msg is StreamStartMessage {
  if (msg === null || typeof msg !== "object") return false;
  return isRequestShape((msg as Record<string, unknown>).request);
}

export type ParsedStreamEvent =
  | { kind: "delta"; delta: string }
  | { kind: "done"; data: unknown }
  | { kind: "error"; error: string };

/** Classify a bg→content stream event; null for anything malformed. */
export function parseStreamEvent(msg: unknown): ParsedStreamEvent | null {
  if (msg === null || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.delta === "string") return { kind: "delta", delta: m.delta };
  if (m.done === true && "data" in m) return { kind: "done", data: m.data };
  if (typeof m.error === "string") return { kind: "error", error: m.error };
  return null;
}

export function isCancelTranslateRequest(
  msg: unknown,
): msg is CancelTranslateRequestMessage {
  if (msg === null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === CANCEL_TRANSLATE_MESSAGE_TYPE &&
    typeof m.id === "string" &&
    m.id !== ""
  );
}

export function isFetchTextRequest(
  msg: unknown,
): msg is FetchTextRequestMessage {
  if (msg === null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return m.type === FETCH_TEXT_MESSAGE_TYPE && typeof m.url === "string";
}

export function isTranslateResponseOk(
  msg: unknown,
): msg is { ok: true; data: unknown } {
  return (
    msg !== null &&
    typeof msg === "object" &&
    (msg as { ok?: unknown }).ok === true &&
    "data" in (msg as object)
  );
}

export function isFetchTextResponseOk(
  msg: unknown,
): msg is { ok: true; text: string } {
  return (
    msg !== null &&
    typeof msg === "object" &&
    (msg as { ok?: unknown }).ok === true &&
    typeof (msg as { text?: unknown }).text === "string"
  );
}
