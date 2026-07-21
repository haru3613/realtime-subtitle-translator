import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  isSettingsConfigured,
  needsSetupWizard,
  normalizeSettings,
  type ExtensionSettings,
} from "./settings";

describe("normalizeSettings", () => {
  it("returns defaults for null/undefined/non-object", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("x")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps known string fields and coerces types", () => {
    const raw = {
      providerId: "openai",
      endpoint: " http://127.0.0.1:11434/v1/chat/completions ",
      apiKey: " sk-test ",
      model: "gpt-4o-mini",
      targetLanguage: "Traditional Chinese",
      sourceLang: "en",
      enabled: false,
      bilingual: true,
      setupComplete: true,
    };
    expect(normalizeSettings(raw)).toEqual({
      providerId: "openai",
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      targetLanguage: "Traditional Chinese",
      sourceLang: "en",
      enabled: false,
      bilingual: true,
      setupComplete: true,
    } satisfies ExtensionSettings);
  });

  it("infers providerId from endpoint when missing", () => {
    const out = normalizeSettings({
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: "gsk",
      model: "llama",
    });
    expect(out.providerId).toBe("groq");
    expect(out.setupComplete).toBe(false);
  });

  it("falls back per-field when values are empty or wrong type", () => {
    const out = normalizeSettings({
      endpoint: "   ",
      apiKey: 12,
      model: "",
      targetLanguage: null,
      sourceLang: {},
      enabled: "yes",
      bilingual: "no",
    });
    expect(out.endpoint).toBe(DEFAULT_SETTINGS.endpoint);
    expect(out.apiKey).toBe(DEFAULT_SETTINGS.apiKey);
    expect(out.model).toBe(DEFAULT_SETTINGS.model);
    expect(out.targetLanguage).toBe(DEFAULT_SETTINGS.targetLanguage);
    expect(out.sourceLang).toBe(DEFAULT_SETTINGS.sourceLang);
    expect(out.enabled).toBe(true);
    expect(out.bilingual).toBe(false);
  });
});

describe("isSettingsConfigured / needsSetupWizard", () => {
  it("requires non-empty endpoint, apiKey, and model", () => {
    expect(isSettingsConfigured(DEFAULT_SETTINGS)).toBe(false);
    expect(needsSetupWizard(DEFAULT_SETTINGS)).toBe(true);
    expect(
      isSettingsConfigured({
        ...DEFAULT_SETTINGS,
        apiKey: "sk-x",
        setupComplete: true,
      }),
    ).toBe(true);
    expect(
      needsSetupWizard({
        ...DEFAULT_SETTINGS,
        apiKey: "sk-x",
        setupComplete: true,
      }),
    ).toBe(false);
    expect(
      needsSetupWizard({
        ...DEFAULT_SETTINGS,
        apiKey: "sk-x",
        setupComplete: false,
      }),
    ).toBe(true);
    expect(
      isSettingsConfigured({
        ...DEFAULT_SETTINGS,
        endpoint: "",
        apiKey: "sk-x",
      }),
    ).toBe(false);
  });
});
