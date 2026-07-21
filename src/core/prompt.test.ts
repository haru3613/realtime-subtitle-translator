import { describe, expect, it } from "vitest";
import { buildTranslationPrompt } from "./prompt";

describe("buildTranslationPrompt", () => {
  it("always includes the current source text and target language", () => {
    const { system, user } = buildTranslationPrompt({
      currentSource: "But the rollup still has weak developer adoption.",
      targetLanguage: "Traditional Chinese",
    });

    expect(system).toContain("Traditional Chinese");
    expect(user).toContain("But the rollup still has weak developer adoption.");
  });

  it("includes previous context before the current source when provided", () => {
    const { user } = buildTranslationPrompt({
      currentSource: "But the rollup still has weak developer adoption.",
      targetLanguage: "Traditional Chinese",
      previousSource: "The network is EVM-compatible.",
    });

    expect(user).toContain("The network is EVM-compatible.");
    expect(user.indexOf("The network is EVM-compatible.")).toBeLessThan(
      user.indexOf("But the rollup still has weak developer adoption."),
    );
  });

  it("omits previous context when absent or empty", () => {
    const omittedUndefined = buildTranslationPrompt({
      currentSource: "current only",
      targetLanguage: "Traditional Chinese",
    }).user;
    const omittedEmpty = buildTranslationPrompt({
      currentSource: "current only",
      targetLanguage: "Traditional Chinese",
      previousSource: "",
    }).user;

    expect(omittedUndefined).not.toContain("Previous");
    expect(omittedEmpty).not.toContain("Previous");
  });

  it("renders glossary terms as source to target pairs when provided", () => {
    const { user } = buildTranslationPrompt({
      currentSource: "The rollup uses staking.",
      targetLanguage: "Traditional Chinese",
      glossary: { rollup: "Rollup", staking: "質押" },
    });

    expect(user).toContain("rollup → Rollup");
    expect(user).toContain("staking → 質押");
  });

  it("omits the glossary section when absent or empty", () => {
    const omittedUndefined = buildTranslationPrompt({
      currentSource: "no glossary here",
      targetLanguage: "Traditional Chinese",
    }).user;
    const omittedEmpty = buildTranslationPrompt({
      currentSource: "no glossary here",
      targetLanguage: "Traditional Chinese",
      glossary: {},
    }).user;

    expect(omittedUndefined).not.toContain("Glossary");
    expect(omittedEmpty).not.toContain("Glossary");
  });

  it("is deterministic for identical input", () => {
    const input = {
      currentSource: "The rollup uses staking.",
      targetLanguage: "Traditional Chinese",
      previousSource: "The network is EVM-compatible.",
      glossary: { rollup: "Rollup", staking: "質押" },
    };
    expect(buildTranslationPrompt(input)).toEqual(buildTranslationPrompt(input));
  });
});
