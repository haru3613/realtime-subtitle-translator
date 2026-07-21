import { describe, it, expect, vi } from "vitest";
import {
  createTranslationPipeline,
  type PipelineConfig,
  type Transport,
} from "./pipeline";
import { AI_CRYPTO_GLOSSARY } from "./glossary";
import type { OpenAICompatibleRequest } from "./provider";

function fakeResponse(text: string) {
  return { choices: [{ message: { content: text } }] };
}

const baseConfig: PipelineConfig = {
  model: "gpt-4o-mini",
  targetLanguage: "Traditional Chinese",
  provider: "openai-compatible",
  glossaryProfile: "ai_crypto",
  glossary: AI_CRYPTO_GLOSSARY,
};

function userMessage(req: OpenAICompatibleRequest): string {
  return req.messages.find((m) => m.role === "user")!.content;
}

describe("createTranslationPipeline", () => {
  it("cache MISS: transport called once, text returned, write-through makes the next cue a HIT", async () => {
    const transport = vi.fn(async () => fakeResponse("這個 Rollup 相容 EVM。"));
    const pipe = createTranslationPipeline(baseConfig, transport);

    const out = await pipe.translateCue("The rollup is EVM-compatible.");
    expect(out).toBe("這個 Rollup 相容 EVM。");
    expect(transport).toHaveBeenCalledTimes(1);

    // Identical cue → served from translationCache, transport NOT hit again.
    const out2 = await pipe.translateCue("The rollup is EVM-compatible.");
    expect(out2).toBe("這個 Rollup 相容 EVM。");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("cache HIT: transport not called (call count 0 after the entry exists)", async () => {
    const transport = vi.fn(async () => fakeResponse("翻譯"));
    const pipe = createTranslationPipeline(baseConfig, transport);

    await pipe.translateCue("hello world"); // populate
    transport.mockClear();

    const out = await pipe.translateCue("hello world");
    expect(out).toBe("翻譯");
    expect(transport).toHaveBeenCalledTimes(0);
  });

  it("selected glossary terms for the source text reach the built prompt", async () => {
    let captured: OpenAICompatibleRequest | undefined;
    const transport: Transport = async (req) => {
      captured = req;
      return fakeResponse("譯文");
    };
    const pipe = createTranslationPipeline(baseConfig, transport);

    await pipe.translateCue("This rollup uses staking.");
    const user = userMessage(captured!);
    expect(user).toContain("rollup → Rollup");
    expect(user).toContain("staking → 質押");
    // A term absent from the source must NOT leak in.
    expect(user).not.toContain("perpetual");
  });

  it("folds the prior source into the prompt as rolling context (recentContext)", async () => {
    let captured: OpenAICompatibleRequest | undefined;
    const transport: Transport = async (req) => {
      captured = req;
      return fakeResponse("t");
    };
    const pipe = createTranslationPipeline(baseConfig, transport);

    await pipe.translateCue("First sentence.");
    await pipe.translateCue("Second sentence.");
    const user = userMessage(captured!);
    expect(user).toContain("First sentence.");
    expect(user).toContain("Translate this line:");
    expect(user).toContain("Second sentence.");
    expect(user.indexOf("First sentence.")).toBeLessThan(
      user.indexOf("Second sentence."),
    );
  });

  it("onPartial: request carries stream:true, deltas are forwarded, result cached", async () => {
    const transport: Transport = async (req, options) => {
      expect(req.stream).toBe(true);
      options?.onDelta?.("這");
      options?.onDelta?.("這句");
      return fakeResponse("這句話");
    };
    const pipe = createTranslationPipeline(baseConfig, transport);

    const partials: string[] = [];
    const out = await pipe.translateCue("this line", {
      onPartial: (t) => partials.push(t),
    });
    expect(out).toBe("這句話");
    expect(partials).toEqual(["這", "這句"]);

    // Cache HIT path resolves the full text without emitting partials.
    const partials2: string[] = [];
    const out2 = await pipe.translateCue("this line", {
      onPartial: (t) => partials2.push(t),
    });
    expect(out2).toBe("這句話");
    expect(partials2).toEqual([]);
  });

  it("without onPartial the request does not ask for a stream", async () => {
    let captured: OpenAICompatibleRequest | undefined;
    const transport: Transport = async (req) => {
      captured = req;
      return fakeResponse("t");
    };
    await createTranslationPipeline(baseConfig, transport).translateCue("x");
    expect(captured?.stream).toBeUndefined();
  });

  it("records latency and the segment into sessionCache stats on a miss", async () => {
    const transport = vi.fn(async () => fakeResponse("譯"));
    const pipe = createTranslationPipeline(baseConfig, transport);

    expect(pipe.sessionCache.latencyStats().count).toBe(0);
    await pipe.translateCue("some fresh caption");
    expect(pipe.sessionCache.latencyStats().count).toBe(1);
    expect(pipe.sessionCache.recentSource()).toEqual(["some fresh caption"]);
    expect(pipe.sessionCache.recentTranslated()).toEqual(["譯"]);
  });

  it("forwards cancellation to the transport", async () => {
    const transport = vi.fn(async () => fakeResponse("譯"));
    const pipe = createTranslationPipeline(baseConfig, transport);
    const controller = new AbortController();

    await pipe.translateCue("latest caption", { signal: controller.signal });

    expect(transport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
