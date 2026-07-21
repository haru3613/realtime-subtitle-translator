import { describe, it, expect, beforeEach } from "vitest";
import { TranslationCache, type TranslationKey } from "./translationCache";

const base: TranslationKey = {
  source_text: "The rollup is EVM-compatible.",
  target_lang: "zh-TW",
  glossary_profile: "ai_crypto",
  provider: "openai-compatible",
};

const KEY_FIELDS = [
  "source_text",
  "target_lang",
  "glossary_profile",
  "provider",
] as const;

describe("TranslationCache", () => {
  let cache: TranslationCache;
  beforeEach(() => {
    cache = new TranslationCache();
  });

  it("returns undefined on a cold miss", () => {
    expect(cache.get(base)).toBeUndefined();
  });

  it("returns the stored translation for an identical four-tuple", () => {
    cache.set(base, "這個 Rollup 相容 EVM。");
    // A fresh object with the same field values must still hit.
    expect(cache.get({ ...base })).toBe("這個 Rollup 相容 EVM。");
  });

  it.each(KEY_FIELDS)("misses when only %s differs", (field) => {
    cache.set(base, "cached");
    expect(cache.get({ ...base, [field]: base[field] + "-changed" })).toBeUndefined();
  });

  it("does not collide across fields (delimiter-safe key)", () => {
    // Under a naive `join("|")` these two distinct tuples would produce the
    // same key. They must stay distinct.
    cache.set({ ...base, source_text: "a", target_lang: "b|c" }, "left");
    cache.set({ ...base, source_text: "a|b", target_lang: "c" }, "right");
    expect(cache.get({ ...base, source_text: "a", target_lang: "b|c" })).toBe("left");
    expect(cache.get({ ...base, source_text: "a|b", target_lang: "c" })).toBe("right");
  });

  it("overwrites the value for the same key on re-set", () => {
    cache.set(base, "first");
    cache.set(base, "second");
    expect(cache.get(base)).toBe("second");
  });

  it("clear() empties the cache", () => {
    cache.set(base, "cached");
    cache.clear();
    expect(cache.get(base)).toBeUndefined();
  });
});
