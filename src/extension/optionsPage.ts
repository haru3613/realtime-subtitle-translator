/**
 * Options / first-run setup wizard (BYOK).
 * Provider presets fill endpoint + model; user only pastes an API key.
 */

import {
  applyProviderPreset,
  getProviderPreset,
  PROVIDER_PRESETS,
  type ProviderId,
} from "./providers";
import { ensureHostPermissionForEndpoint } from "./hostPermission";
import {
  DEFAULT_SETTINGS,
  isSettingsConfigured,
  needsSetupWizard,
  type ExtensionSettings,
} from "./settings";
import { loadSettings, saveSettings } from "./storage";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function setStatus(text: string, kind: "ok" | "err" | ""): void {
  const status = el<HTMLElement>("status");
  status.textContent = text;
  status.className = kind;
}

function providerSelect(): HTMLSelectElement {
  return el<HTMLSelectElement>("providerId");
}

function fillProviderOptions(): void {
  const select = providerSelect();
  select.innerHTML = "";
  for (const p of PROVIDER_PRESETS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    select.append(opt);
  }
}

function selectedProviderId(): ProviderId {
  return providerSelect().value as ProviderId;
}

function syncProviderUi(): void {
  const preset = getProviderPreset(selectedProviderId());
  el<HTMLElement>("providerBlurb").textContent = preset.blurb;

  const helpWrap = el<HTMLElement>("keyHelpWrap");
  const helpLink = el<HTMLAnchorElement>("keyHelpLink");
  if (preset.keyHelpUrl) {
    helpWrap.hidden = false;
    helpLink.href = preset.keyHelpUrl;
  } else {
    helpWrap.hidden = true;
  }

  el<HTMLInputElement>("apiKey").placeholder = preset.keyPlaceholder;

  const custom = el<HTMLElement>("customFields");
  if (preset.editableEndpoint) {
    custom.classList.remove("hidden");
  } else {
    custom.classList.add("hidden");
    // Keep hidden field in sync so Save still works.
    el<HTMLInputElement>("endpoint").value = preset.endpoint;
  }

  // Only overwrite model when switching presets if field empty or still a known default.
  const modelInput = el<HTMLInputElement>("model");
  const knownDefaults = new Set(PROVIDER_PRESETS.map((p) => p.defaultModel));
  if (!modelInput.value.trim() || knownDefaults.has(modelInput.value.trim())) {
    modelInput.value = preset.defaultModel;
  }
}

function readForm(): ExtensionSettings {
  const providerId = selectedProviderId();
  const preset = getProviderPreset(providerId);
  const endpoint = preset.editableEndpoint
    ? el<HTMLInputElement>("endpoint").value
    : preset.endpoint;

  return {
    providerId,
    endpoint,
    apiKey: el<HTMLInputElement>("apiKey").value,
    model: el<HTMLInputElement>("model").value,
    targetLanguage: el<HTMLInputElement>("targetLanguage").value,
    sourceLang: el<HTMLInputElement>("sourceLang").value,
    enabled: el<HTMLInputElement>("enabled").checked,
    bilingual: el<HTMLInputElement>("bilingual").checked,
    setupComplete: el<HTMLElement>("doneBox").classList.contains("show"),
  };
}

function writeForm(s: ExtensionSettings): void {
  providerSelect().value = s.providerId;
  el<HTMLInputElement>("endpoint").value = s.endpoint;
  el<HTMLInputElement>("apiKey").value = s.apiKey;
  el<HTMLInputElement>("model").value = s.model;
  el<HTMLInputElement>("targetLanguage").value = s.targetLanguage;
  el<HTMLInputElement>("sourceLang").value = s.sourceLang;
  el<HTMLInputElement>("enabled").checked = s.enabled;
  el<HTMLInputElement>("bilingual").checked = s.bilingual;
  syncProviderUi();
  // After syncProviderUi may overwrite endpoint for non-custom — restore.
  if (s.providerId === "custom") {
    el<HTMLInputElement>("endpoint").value = s.endpoint;
  } else {
    el<HTMLInputElement>("endpoint").value = getProviderPreset(s.providerId)
      .endpoint;
  }
  el<HTMLInputElement>("model").value = s.model;
  showDone(s.setupComplete && isSettingsConfigured(s));
}

function showDone(show: boolean): void {
  el<HTMLElement>("doneBox").classList.toggle("show", show);
}

async function testApi(settings: ExtensionSettings): Promise<string> {
  const res = await fetch(settings.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        {
          role: "user",
          content: "Reply with exactly the two letters: ok",
        },
      ],
      max_tokens: 8,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${raw.slice(0, 280)}`);
  }
  try {
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
  } catch {
    /* fall through */
  }
  return raw.slice(0, 120);
}

function applyPresetToForm(id: ProviderId): void {
  const applied = applyProviderPreset(id);
  providerSelect().value = applied.providerId;
  el<HTMLInputElement>("endpoint").value = applied.endpoint;
  el<HTMLInputElement>("model").value = applied.model;
  syncProviderUi();
}

async function main(): Promise<void> {
  fillProviderOptions();

  const current = await loadSettings();
  writeForm({ ...DEFAULT_SETTINGS, ...current });

  // First-run: force OpenAI defaults if empty key.
  if (needsSetupWizard(current) && !current.apiKey) {
    applyPresetToForm(current.providerId || "openai");
    setStatus("請選擇服務並貼上 API key，然後按「測試並儲存」。", "");
  }

  providerSelect().addEventListener("change", () => {
    // Provider credentials are not interchangeable; never carry one key to a new host.
    el<HTMLInputElement>("apiKey").value = "";
    showDone(false);
    applyPresetToForm(selectedProviderId());
  });
  el<HTMLInputElement>("endpoint").addEventListener("change", () => {
    el<HTMLInputElement>("apiKey").value = "";
    showDone(false);
  });

  // Advanced fields can be autosaved while a Save/testSave handler is
  // suspended on an await; re-read them at write time so a stale readForm()
  // snapshot never reverts a newer autosave.
  const withCurrentAdvanced = (s: ExtensionSettings): ExtensionSettings => ({
    ...s,
    targetLanguage: el<HTMLInputElement>("targetLanguage").value,
    sourceLang: el<HTMLInputElement>("sourceLang").value,
    enabled: el<HTMLInputElement>("enabled").checked,
    bilingual: el<HTMLInputElement>("bilingual").checked,
  });

  el<HTMLButtonElement>("save").addEventListener("click", () => {
    void (async () => {
      try {
        const form = readForm();
        if (isSettingsConfigured(form)) {
          const perm = await ensureHostPermissionForEndpoint(form.endpoint);
          if (!perm.ok) throw new Error(perm.reason ?? "Host permission denied");
        }
        // Manual save does not mark setup complete unless already configured.
        form.setupComplete =
          form.setupComplete || isSettingsConfigured(form);
        await saveSettings(withCurrentAdvanced(form));
        showDone(isSettingsConfigured(form));
        setStatus(
          isSettingsConfigured(form)
            ? "已儲存。請重新整理 YouTube 分頁後開啟 CC。"
            : "已儲存，但尚未填完整（需要 endpoint + key + model）。",
          isSettingsConfigured(form) ? "ok" : "err",
        );
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), "err");
      }
    })();
  });

  el<HTMLButtonElement>("testSave").addEventListener("click", () => {
    void (async () => {
      const btn = el<HTMLButtonElement>("testSave");
      btn.disabled = true;
      try {
        const form = readForm();
        if (!isSettingsConfigured(form)) {
          throw new Error("請填寫 API key 與模型（自訂服務還需 endpoint）。");
        }
        setStatus("確認網站權限…", "");
        const perm = await ensureHostPermissionForEndpoint(form.endpoint);
        if (!perm.ok) throw new Error(perm.reason ?? "Host permission denied");
        setStatus("正在測試 API…", "");
        const preview = await testApi(form);
        form.setupComplete = true;
        await saveSettings(withCurrentAdvanced(form));
        showDone(true);
        setStatus(
          `連線成功（模型回覆：${preview}）。\n請到 YouTube 開 CC 後播放即可。`,
          "ok",
        );
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), "err");
        showDone(false);
      } finally {
        btn.disabled = false;
      }
    })();
  });

  el<HTMLButtonElement>("openYoutube").addEventListener("click", () => {
    window.open("https://www.youtube.com/", "_blank", "noopener,noreferrer");
  });

  // Advanced fields live BELOW the save buttons, so users toggling 雙語 never
  // found a save affordance — persist them on change instead. Merge over the
  // STORED settings (not the whole form) so an unsaved endpoint/key edit in
  // the section above is never committed as a side effect.
  for (const id of ["targetLanguage", "sourceLang", "enabled", "bilingual"]) {
    el<HTMLInputElement>(id).addEventListener("change", () => {
      void (async () => {
        try {
          const stored = await loadSettings();
          await saveSettings(withCurrentAdvanced(stored));
          setStatus("進階設定已自動儲存。", "ok");
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err), "err");
        }
      })();
    });
  }
}

void main();
