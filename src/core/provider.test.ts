import { describe, expect, it } from "vitest";
import {
  buildOpenAICompatibleRequest,
  parseOpenAICompatibleResponse,
  type OpenAICompatibleRequest,
} from "./provider";

describe("buildOpenAICompatibleRequest", () => {
  it("preserves the model and emits system then user messages in order", () => {
    const request: OpenAICompatibleRequest = buildOpenAICompatibleRequest({
      model: "gpt-4o-mini",
      system: "Translate subtitles into Traditional Chinese. Do not explain.",
      user: "But the rollup still has weak developer adoption.",
    });

    expect(request).toEqual({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Translate subtitles into Traditional Chinese. Do not explain.",
        },
        {
          role: "user",
          content: "But the rollup still has weak developer adoption.",
        },
      ],
    });
    // Order matters for chat-completions: system must precede user.
    expect(request.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("adds stream: true only when requested", () => {
    const base = { model: "m", system: "s", user: "u" };
    expect(buildOpenAICompatibleRequest(base)).not.toHaveProperty("stream");
    expect(buildOpenAICompatibleRequest({ ...base, stream: true })).toMatchObject(
      { stream: true },
    );
  });
});

describe("parseOpenAICompatibleResponse", () => {
  it("extracts the assistant content from the first choice", () => {
    const parsed = parseOpenAICompatibleResponse({
      choices: [
        { message: { role: "assistant", content: "但這個 Rollup 的開發者採用仍然偏弱。" } },
        { message: { role: "assistant", content: "second choice ignored" } },
      ],
    });

    expect(parsed).toEqual({ text: "但這個 Rollup 的開發者採用仍然偏弱。" });
  });

  it.each([
    ["null payload", null],
    ["non-object payload", "nope"],
    ["missing choices", {}],
    ["empty choices array", { choices: [] }],
    ["choice without message", { choices: [{}] }],
    ["message without content", { choices: [{ message: { role: "assistant" } }] }],
    ["non-string content", { choices: [{ message: { content: 42 } }] }],
    ["empty content", { choices: [{ message: { content: "   " } }] }],
  ])("throws a clear error for %s", (_label, payload) => {
    expect(() => parseOpenAICompatibleResponse(payload)).toThrow(
      /OpenAI-compatible response/,
    );
  });
});
