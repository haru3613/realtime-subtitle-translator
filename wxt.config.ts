import { defineConfig } from "wxt";

// WXT/MV3 shell for v0 YouTube caption-translation mode (SPEC §14 / §17).
// host_permissions stay explicit (no https://*/*) for Chrome Web Store review.
// Custom providers request optional hosts at runtime in the options wizard.
export default defineConfig({
  srcDir: ".",
  entrypointsDir: "entrypoints",
  outDir: ".output",
  manifest: {
    name: "Realtime Subtitle Translator",
    description:
      "YouTube 字幕即時翻成繁中。使用你自己的 API key（OpenAI / OpenRouter / Groq / Ollama）。",
    // version intentionally omitted — WXT reads it from package.json, so one
    // bump covers both (a hardcoded 0.2.1 here once shipped a mislabeled build).
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    action: {
      default_title: "Realtime Subtitle Translator",
      default_popup: "options.html",
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
      },
    },
    permissions: ["storage"],
    host_permissions: [
      "*://*.youtube.com/*",
      "*://youtube.com/*",
      "https://api.openai.com/*",
      "https://openrouter.ai/*",
      "https://api.groq.com/*",
      "http://127.0.0.1/*",
      "http://localhost/*",
    ],
    // Only requested when the user picks a custom endpoint (options wizard).
    optional_host_permissions: ["https://*/*", "http://*/*"],
  },
});
