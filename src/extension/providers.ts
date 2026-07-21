/**
 * BYOK provider presets for the setup wizard (store-friendly).
 * Users pay their own API cost; we only ship endpoint/model defaults.
 */

export type ProviderId =
  | "openai"
  | "openrouter"
  | "groq"
  | "ollama"
  | "custom";

export interface ProviderPreset {
  id: ProviderId;
  /** UI label (zh-Hant ok for options page). */
  label: string;
  /** Short blurb under the radio/select. */
  blurb: string;
  endpoint: string;
  defaultModel: string;
  /** Where to get a key (omit for local). */
  keyHelpUrl?: string;
  keyPlaceholder: string;
  /** Show free-form endpoint field. */
  editableEndpoint: boolean;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    blurb: "官方 API。建議模型 gpt-4o-mini（便宜、夠快）。",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    keyHelpUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    editableEndpoint: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    blurb: "一個 key 可選多家模型。",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
    keyHelpUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-…",
    editableEndpoint: false,
  },
  {
    id: "groq",
    label: "Groq",
    blurb: "速度快，適合即時字幕。",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
    keyHelpUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    editableEndpoint: false,
  },
  {
    id: "ollama",
    label: "Ollama（本機）",
    blurb: "完全本機、免雲端費用。需先在本機啟動 Ollama。",
    endpoint: "http://127.0.0.1:11434/v1/chat/completions",
    defaultModel: "llama3.2",
    keyPlaceholder: "ollama（任意非空字串即可）",
    editableEndpoint: false,
  },
  {
    id: "custom",
    label: "自訂 OpenAI-compatible",
    blurb: "任何相容 chat/completions 的 endpoint。",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    keyPlaceholder: "API key",
    editableEndpoint: true,
  },
] as const;

export function getProviderPreset(id: ProviderId): ProviderPreset {
  return (
    PROVIDER_PRESETS.find((p) => p.id === id) ??
    PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]!
  );
}

/** Infer provider from a stored endpoint (best-effort). */
export function detectProviderId(endpoint: string): ProviderId {
  const e = endpoint.toLowerCase();
  if (e.includes("api.openai.com")) return "openai";
  if (e.includes("openrouter.ai")) return "openrouter";
  if (e.includes("api.groq.com")) return "groq";
  if (e.includes("127.0.0.1") || e.includes("localhost")) return "ollama";
  return "custom";
}

export interface ProviderApplyResult {
  providerId: ProviderId;
  endpoint: string;
  model: string;
}

/** Apply a preset’s endpoint + default model (does not touch apiKey). */
export function applyProviderPreset(id: ProviderId): ProviderApplyResult {
  const p = getProviderPreset(id);
  return {
    providerId: p.id,
    endpoint: p.endpoint,
    model: p.defaultModel,
  };
}
