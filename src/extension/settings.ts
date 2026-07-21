/**
 * Extension settings schema + pure normalize (SPEC §5.1 / §14 v0).
 * Persistence is chrome.storage.local via thin wrappers in the shell;
 * this module stays free of chrome.* so vitest can cover it.
 */

import {
  detectProviderId,
  type ProviderId,
} from "./providers";

export interface ExtensionSettings {
  /** Selected BYOK provider preset id. */
  providerId: ProviderId;
  /** Full chat-completions URL (OpenAI-compatible). */
  endpoint: string;
  /** Bearer token; stored in chrome.storage.local (v0 has no daemon). */
  apiKey: string;
  /** Model id sent in the provider request body. */
  model: string;
  /** Human-readable target language for prompts + cache keys. */
  targetLanguage: string;
  /** Preferred caption track language code (e.g. "en"). */
  sourceLang: string;
  /** Auto-start caption translation when on a YouTube watch page. */
  enabled: boolean;
  /** Show source + translated lines (vs translated-only 繁中). */
  bilingual: boolean;
  /**
   * True after the user completes the setup wizard (Save + Test passed, or
   * explicit dismiss). Used to re-open the wizard on first install only.
   */
  setupComplete: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  providerId: "openai",
  endpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  targetLanguage: "Traditional Chinese",
  sourceLang: "en",
  enabled: true,
  // Live mode: Chinese-only is less cluttered; bilingual is opt-in in Options.
  bilingual: false,
  setupComplete: false,
};

/** chrome.storage.local key for the whole settings blob. */
export const SETTINGS_STORAGE_KEY = "rst.settings";

const PROVIDER_IDS = new Set<string>([
  "openai",
  "openrouter",
  "groq",
  "ollama",
  "custom",
]);

function asTrimmedString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asProviderId(value: unknown, endpoint: string): ProviderId {
  if (typeof value === "string" && PROVIDER_IDS.has(value)) {
    return value as ProviderId;
  }
  return detectProviderId(endpoint);
}

/** Coerce arbitrary storage JSON into a complete settings object. */
export function normalizeSettings(raw: unknown): ExtensionSettings {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  const o = raw as Record<string, unknown>;
  const endpoint = asTrimmedString(o.endpoint, DEFAULT_SETTINGS.endpoint);
  return {
    providerId: asProviderId(o.providerId, endpoint),
    endpoint,
    apiKey: asTrimmedString(o.apiKey, DEFAULT_SETTINGS.apiKey),
    model: asTrimmedString(o.model, DEFAULT_SETTINGS.model),
    targetLanguage: asTrimmedString(
      o.targetLanguage,
      DEFAULT_SETTINGS.targetLanguage,
    ),
    sourceLang: asTrimmedString(o.sourceLang, DEFAULT_SETTINGS.sourceLang),
    enabled: asBoolean(o.enabled, DEFAULT_SETTINGS.enabled),
    bilingual: asBoolean(o.bilingual, DEFAULT_SETTINGS.bilingual),
    setupComplete: asBoolean(o.setupComplete, DEFAULT_SETTINGS.setupComplete),
  };
}

/** True when the user has enough config to call a translation provider. */
export function isSettingsConfigured(settings: ExtensionSettings): boolean {
  return (
    settings.endpoint.trim() !== "" &&
    settings.apiKey.trim() !== "" &&
    settings.model.trim() !== ""
  );
}

/** First-run: not configured, or never finished the wizard. */
export function needsSetupWizard(settings: ExtensionSettings): boolean {
  return !settings.setupComplete || !isSettingsConfigured(settings);
}
