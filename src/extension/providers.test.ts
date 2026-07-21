import { describe, expect, it } from "vitest";
import {
  PROVIDER_PRESETS,
  applyProviderPreset,
  detectProviderId,
  getProviderPreset,
} from "./providers";

describe("PROVIDER_PRESETS", () => {
  it("includes the BYOK cloud presets + local + custom", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(ids).toEqual([
      "openai",
      "openrouter",
      "groq",
      "ollama",
      "custom",
    ]);
  });

  it("gives every preset a non-empty default model and endpoint", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.endpoint.length).toBeGreaterThan(0);
      expect(p.defaultModel.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});

describe("applyProviderPreset", () => {
  it("fills OpenAI endpoint and mini model", () => {
    expect(applyProviderPreset("openai")).toEqual({
      providerId: "openai",
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini",
    });
  });

  it("fills Ollama localhost endpoint", () => {
    const r = applyProviderPreset("ollama");
    expect(r.endpoint).toContain("127.0.0.1");
    expect(r.providerId).toBe("ollama");
  });
});

describe("detectProviderId", () => {
  it("maps known hosts", () => {
    expect(
      detectProviderId("https://api.openai.com/v1/chat/completions"),
    ).toBe("openai");
    expect(
      detectProviderId("https://openrouter.ai/api/v1/chat/completions"),
    ).toBe("openrouter");
    expect(
      detectProviderId("https://api.groq.com/openai/v1/chat/completions"),
    ).toBe("groq");
    expect(
      detectProviderId("http://127.0.0.1:11434/v1/chat/completions"),
    ).toBe("ollama");
    expect(detectProviderId("https://example.com/v1/chat/completions")).toBe(
      "custom",
    );
  });
});

describe("getProviderPreset", () => {
  it("returns the matching preset", () => {
    expect(getProviderPreset("groq").label).toMatch(/Groq/i);
  });
});
