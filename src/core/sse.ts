/**
 * Incremental SSE parser for OpenAI-compatible streaming responses
 * (SPEC §7.2 / §10 low-latency path). Pure logic: chunks of the response
 * body text go in (split anywhere, even mid-event), accumulated assistant
 * text comes out via `onDelta`. The network read loop lives in
 * `transport.streamingHttpTransport`; this module never touches fetch.
 */

export interface SseAccumulator {
  /** Feed the next raw chunk of the SSE body (any split point is fine). */
  feed(chunk: string): void;
  /**
   * Call once when the stream ends: processes a final event that the server
   * did not terminate with a blank line.
   */
  flush(): void;
  /** Accumulated assistant text so far. */
  text(): string;
}

/**
 * Create an accumulator for `text/event-stream` chat-completion chunks.
 * Calls `onDelta(accumulatedText)` after each event that carries new content.
 * Malformed lines and non-`data:` lines are ignored; `[DONE]` ends the stream.
 */
export function createSseAccumulator(
  onDelta: (accumulated: string) => void,
): SseAccumulator {
  let buffer = "";
  let accumulated = "";
  let done = false;

  const handleEvent = (rawEvent: string) => {
    for (const line of rawEvent.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (payload === "[DONE]") {
        done = true;
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // malformed data line — skip, keep the stream alive
      }
      const content = (
        parsed as { choices?: Array<{ delta?: { content?: unknown } }> }
      )?.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content !== "") {
        accumulated += content;
        onDelta(accumulated);
      }
    }
  };

  return {
    feed(chunk: string): void {
      if (done) return;
      buffer += chunk.replace(/\r\n/g, "\n");
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1 && !done) {
        handleEvent(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf("\n\n");
      }
    },
    flush(): void {
      if (done || buffer.trim() === "") return;
      handleEvent(buffer);
      buffer = "";
    },
    text(): string {
      return accumulated;
    },
  };
}
