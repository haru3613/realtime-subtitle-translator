import { describe, expect, it } from "vitest";
import { originPatternFromEndpoint } from "./hostPermission";

describe("originPatternFromEndpoint", () => {
  it("builds a host match pattern from a full chat URL", () => {
    expect(
      originPatternFromEndpoint(
        "https://api.openai.com/v1/chat/completions",
      ),
    ).toBe("https://api.openai.com/*");
    expect(
      originPatternFromEndpoint(
        "https://openrouter.ai/api/v1/chat/completions",
      ),
    ).toBe("https://openrouter.ai/*");
    expect(
      originPatternFromEndpoint("http://127.0.0.1:11434/v1/chat/completions"),
    ).toBe("http://127.0.0.1/*");
  });

  it("rejects invalid URLs and cleartext non-loopback endpoints", () => {
    expect(originPatternFromEndpoint("not-a-url")).toBeNull();
    expect(originPatternFromEndpoint("")).toBeNull();
    expect(
      originPatternFromEndpoint("http://api.example.com/v1/chat/completions"),
    ).toBeNull();
    expect(
      originPatternFromEndpoint("https://api.example.com:8443/v1/chat/completions"),
    ).toBe("https://api.example.com/*");
  });
});
