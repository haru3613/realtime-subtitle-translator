import { describe, it, expect, beforeEach } from "vitest";
import { SessionCache } from "./sessionCache";

describe("SessionCache", () => {
  let cache: SessionCache;
  beforeEach(() => {
    cache = new SessionCache();
  });

  it("keeps recent segments newest-last in insertion order", () => {
    cache.record({ source: "a", translated: "甲", latencyMs: 10 });
    cache.record({ source: "b", translated: "乙", latencyMs: 20 });
    cache.record({ source: "c", translated: "丙", latencyMs: 30 });
    expect(cache.recentSource()).toEqual(["a", "b", "c"]);
    expect(cache.recentTranslated()).toEqual(["甲", "乙", "丙"]);
  });

  it("evicts oldest beyond maxRecent (both rings)", () => {
    const c = new SessionCache({ maxRecent: 2 });
    c.record({ source: "a", translated: "甲", latencyMs: 1 });
    c.record({ source: "b", translated: "乙", latencyMs: 1 });
    c.record({ source: "c", translated: "丙", latencyMs: 1 });
    expect(c.recentSource()).toEqual(["b", "c"]);
    expect(c.recentTranslated()).toEqual(["乙", "丙"]);
  });

  it("defaults maxRecent to 20", () => {
    for (let i = 0; i < 25; i++) {
      cache.record({ source: `s${i}`, translated: `t${i}`, latencyMs: 1 });
    }
    expect(cache.recentSource().length).toBe(20);
    expect(cache.recentSource()[0]).toBe("s5"); // s0..s4 evicted
    expect(cache.recentSource()[19]).toBe("s24");
  });

  it("recentSource(n) / recentTranslated(n) return the last n newest-last", () => {
    ["a", "b", "c", "d"].forEach((s, i) =>
      cache.record({ source: s, translated: s.toUpperCase(), latencyMs: i }),
    );
    expect(cache.recentSource(2)).toEqual(["c", "d"]);
    expect(cache.recentTranslated(2)).toEqual(["C", "D"]);
  });

  it("n <= 0 returns an empty slice (not the whole ring)", () => {
    cache.record({ source: "a", translated: "甲", latencyMs: 1 });
    expect(cache.recentSource(0)).toEqual([]);
    expect(cache.recentTranslated(-1)).toEqual([]);
  });

  it("n larger than retained returns all retained", () => {
    cache.record({ source: "a", translated: "甲", latencyMs: 1 });
    expect(cache.recentSource(99)).toEqual(["a"]);
  });

  it("returns copies — mutating the result does not corrupt the ring", () => {
    cache.record({ source: "a", translated: "甲", latencyMs: 1 });
    const out = cache.recentSource();
    out.push("injected");
    expect(cache.recentSource()).toEqual(["a"]);
  });

  it("latencyStats() is {0,0,0} on an empty session", () => {
    expect(cache.latencyStats()).toEqual({ count: 0, avgMs: 0, lastMs: 0 });
  });

  it("latencyStats() averages over all recorded and tracks last", () => {
    cache.record({ source: "a", translated: "甲", latencyMs: 100 });
    cache.record({ source: "b", translated: "乙", latencyMs: 200 });
    cache.record({ source: "c", translated: "丙", latencyMs: 300 });
    expect(cache.latencyStats()).toEqual({ count: 3, avgMs: 200, lastMs: 300 });
  });

  it("latency count spans records even after eviction", () => {
    const c = new SessionCache({ maxRecent: 1 });
    c.record({ source: "a", translated: "甲", latencyMs: 10 });
    c.record({ source: "b", translated: "乙", latencyMs: 30 });
    // ring holds only "b", but stats reflect both records
    expect(c.recentSource()).toEqual(["b"]);
    expect(c.latencyStats()).toEqual({ count: 2, avgMs: 20, lastMs: 30 });
  });

  it("round-trips glossary profile and provider config via getters", () => {
    expect(cache.glossaryProfile).toBeUndefined();
    expect(cache.providerConfig).toBeUndefined();
    cache.setGlossaryProfile("ai_crypto");
    cache.setProviderConfig({ provider: "openai-compatible", model: "gpt-4o-mini" });
    expect(cache.glossaryProfile).toBe("ai_crypto");
    expect(cache.providerConfig).toEqual({
      provider: "openai-compatible",
      model: "gpt-4o-mini",
    });
  });

  it("reset() clears rings, stats and config", () => {
    cache.record({ source: "a", translated: "甲", latencyMs: 50 });
    cache.setGlossaryProfile("ai_crypto");
    cache.setProviderConfig({ provider: "openai-compatible" });
    cache.reset();
    expect(cache.recentSource()).toEqual([]);
    expect(cache.recentTranslated()).toEqual([]);
    expect(cache.latencyStats()).toEqual({ count: 0, avgMs: 0, lastMs: 0 });
    expect(cache.glossaryProfile).toBeUndefined();
    expect(cache.providerConfig).toBeUndefined();
  });
});
