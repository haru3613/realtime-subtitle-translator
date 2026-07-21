import { describe, expect, it } from "vitest";
import {
  httpTransport,
  streamingHttpTransport,
  type FetchImpl,
  type HttpTransportConfig,
  type StreamFetchImpl,
} from "./transport";
import { parseOpenAICompatibleResponse } from "./provider";
import { buildOpenAICompatibleRequest } from "./provider";
import { createTranslationPipeline, type PipelineConfig } from "./pipeline";
import { AI_CRYPTO_GLOSSARY } from "./glossary";

const cfg: HttpTransportConfig = {
  endpoint: "https://api.example.com/v1/chat/completions",
  apiKey: "sk-test-123",
};

describe("httpTransport", () => {
  const request = buildOpenAICompatibleRequest({
    model: "gpt-4o-mini",
    system: "Translate subtitles into Traditional Chinese. Do not explain.",
    user: "The rollup is EVM-compatible.",
  });

  it("POSTs the built request to the endpoint with a Bearer auth header, returns raw JSON", async () => {
    const payload = { choices: [{ message: { content: "這個 Rollup 相容 EVM。" } }] };
    let seenUrl = "";
    let seenInit: Parameters<FetchImpl>[1] | undefined;
    const mockFetch: FetchImpl = async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return { ok: true, status: 200, json: async () => payload };
    };

    const raw = await httpTransport(cfg, mockFetch)(request);

    expect(seenUrl).toBe(cfg.endpoint);
    expect(seenInit?.method).toBe("POST");
    expect(seenInit?.headers.Authorization).toBe(`Bearer ${cfg.apiKey}`);
    expect(seenInit?.headers["Content-Type"]).toBe("application/json");
    // Body is exactly the built request, unmodified by the transport.
    expect(JSON.parse(seenInit!.body)).toEqual(request);
    // Returns the raw provider JSON for parseOpenAICompatibleResponse.
    expect(raw).toEqual(payload);
  });

  it("throws on a non-OK HTTP response instead of feeding an error body downstream", async () => {
    const mockFetch: FetchImpl = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    });
    await expect(httpTransport(cfg, mockFetch)(request)).rejects.toThrow(/401/);
  });

  it("forwards an abort signal to fetch", async () => {
    let seenSignal: AbortSignal | undefined;
    const mockFetch: FetchImpl = async (_url, init) => {
      seenSignal = init.signal;
      return { ok: true, status: 200, json: async () => ({ choices: [] }) };
    };
    const controller = new AbortController();

    await httpTransport(cfg, mockFetch)(request, { signal: controller.signal });

    expect(seenSignal).toBe(controller.signal);
  });

  it("consuming proof: pipeline translates a cue end-to-end through httpTransport", async () => {
    const pipelineConfig: PipelineConfig = {
      model: "gpt-4o-mini",
      targetLanguage: "Traditional Chinese",
      provider: "openai-compatible",
      glossaryProfile: "ai_crypto",
      glossary: AI_CRYPTO_GLOSSARY,
    };
    let calls = 0;
    const mockFetch: FetchImpl = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "這個 Rollup 相容 EVM。" } }],
        }),
      };
    };

    const pipe = createTranslationPipeline(
      pipelineConfig,
      httpTransport(cfg, mockFetch),
    );
    const out = await pipe.translateCue("The rollup is EVM-compatible.");

    expect(out).toBe("這個 Rollup 相容 EVM。");
    expect(calls).toBe(1);
  });
});

describe("streamingHttpTransport", () => {
  const sseBody = (events: string[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const e of events) controller.enqueue(encoder.encode(e));
        controller.close();
      },
    });
  };
  const event = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

  const request = buildOpenAICompatibleRequest({
    model: "gpt-4o-mini",
    system: "sys",
    user: "The rollup is EVM-compatible.",
    stream: true,
  });

  it("emits accumulated deltas and resolves to a parseable full response", async () => {
    let seenInit: Parameters<StreamFetchImpl>[1] | undefined;
    const mockFetch: StreamFetchImpl = async (_url, init) => {
      seenInit = init;
      return {
        ok: true,
        status: 200,
        body: sseBody([event("這個 "), event("Rollup。"), "data: [DONE]\n\n"]),
      };
    };

    const partials: string[] = [];
    const raw = await streamingHttpTransport(cfg, mockFetch)(request, (t) =>
      partials.push(t),
    );

    expect(seenInit?.headers.Authorization).toBe(`Bearer ${cfg.apiKey}`);
    expect(JSON.parse(seenInit!.body)).toEqual(request);
    expect(partials).toEqual(["這個 ", "這個 Rollup。"]);
    expect(parseOpenAICompatibleResponse(raw)).toEqual({ text: "這個 Rollup。" });
  });

  it("throws on a non-OK HTTP response", async () => {
    const mockFetch: StreamFetchImpl = async () => ({
      ok: false,
      status: 429,
      body: null,
    });
    await expect(
      streamingHttpTransport(cfg, mockFetch)(request, () => {}),
    ).rejects.toThrow(/429/);
  });

  it("throws when the response has no body stream", async () => {
    const mockFetch: StreamFetchImpl = async () => ({
      ok: true,
      status: 200,
      body: null,
    });
    await expect(
      streamingHttpTransport(cfg, mockFetch)(request, () => {}),
    ).rejects.toThrow(/body/);
  });
});
