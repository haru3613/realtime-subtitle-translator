// Request/response shaping for an OpenAI-compatible chat-completions endpoint.
// Pure logic only: no fetch, no client, no API keys (SPEC §7.2).

export type ProviderRole = "system" | "user" | "assistant";

export interface ProviderMessage {
  role: ProviderRole;
  content: string;
}

/** Chat-completions request body an OpenAI-compatible endpoint accepts. */
export interface OpenAICompatibleRequest {
  model: string;
  messages: ProviderMessage[];
  /** Ask the endpoint for an SSE stream (see core/sse.ts + streaming transport). */
  stream?: boolean;
}

export interface BuildRequestParams {
  model: string;
  system: string;
  user: string;
  stream?: boolean;
}

/** Normalized translation result, provider-agnostic. */
export interface TranslationResponse {
  text: string;
}

/**
 * Shape a deterministic chat-completions request: the system prompt first,
 * then the user text. Order matters — the model reads system before user.
 */
export function buildOpenAICompatibleRequest({
  model,
  system,
  user,
  stream,
}: BuildRequestParams): OpenAICompatibleRequest {
  return {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(stream ? { stream: true } : {}),
  };
}

/**
 * Extract the first choice's assistant content from an OpenAI-compatible
 * response. Throws a clear error on any missing/malformed shape — the payload
 * is untrusted network JSON.
 */
export function parseOpenAICompatibleResponse(
  payload: unknown,
): TranslationResponse {
  const choices = (payload as { choices?: unknown } | null | undefined)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("OpenAI-compatible response has no choices");
  }

  const content = (
    choices[0] as { message?: { content?: unknown } } | null | undefined
  )?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error(
      "OpenAI-compatible response is missing assistant message content",
    );
  }

  return { text: content };
}
