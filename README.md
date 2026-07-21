# Realtime Subtitle Translator

[![CI](https://github.com/haru3613/realtime-subtitle-translator/actions/workflows/ci.yml/badge.svg)](https://github.com/haru3613/realtime-subtitle-translator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Chrome extension that translates YouTube captions into Traditional Chinese
and displays them as a low-latency subtitle overlay.

> **Project status:** Beta. The extension is usable on captioned YouTube videos,
> but APIs and browser behavior may change. Maintained on a best-effort basis.

## Why

YouTube's built-in translation offers little control over providers, models, or
technical terminology. Realtime Subtitle Translator uses your own
OpenAI-compatible endpoint, keeps the API key in Chrome's local extension
storage, and renders translated captions directly on the video.

## Features

- Translates regular YouTube caption tracks and Live CC
- Supports OpenAI, OpenRouter, Groq, Ollama, and custom compatible endpoints
- Uses your own API key; no developer-operated proxy or account
- Traditional Chinese-only or bilingual subtitle display
- Streams partial translations when the provider supports SSE
- Requests custom endpoint permissions only when configured

## Quick start

Requirements:

- Node.js 22.13 or newer
- npm 10 or newer
- A Chromium-based browser
- An API key for your chosen provider, or a local Ollama endpoint

```bash
git clone https://github.com/haru3613/realtime-subtitle-translator.git
cd realtime-subtitle-translator
npm ci
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose `.output/chrome-mv3`.
4. Choose a translation provider in the setup page and save your API key.
5. Open a YouTube video, enable CC, and start playback.

No `.env` file or developer-hosted backend is required.

## Configuration and privacy

Provider settings and the API key are stored in `chrome.storage.local`. Caption
text and recent caption context are sent directly from your browser to the
provider you configure. They are not sent to a server operated by this project.
Provider charges and data-handling terms still apply.

Custom endpoints may receive an optional host permission after you approve the
browser prompt. Prefer HTTPS unless you intentionally use a local service.

See the bilingual [privacy policy](docs/privacy-policy.html) for details.

## Development

```bash
npm ci
npm run dev        # watch build; load .output/chrome-mv3-dev
npm test           # Vitest unit tests
npm run typecheck  # TypeScript strict-mode check
npm run build      # production Chrome MV3 bundle
```

CI runs these checks on supported branches.

## Architecture

```text
YouTube captions -> content script -> translation pipeline -> provider API
                                            |
                                            +-> Shadow DOM subtitle overlay
```

- `src/core/` contains the provider-independent translation pipeline and pure helpers.
- `src/extension/` contains Chrome storage, settings, permissions, and YouTube integration.
- `entrypoints/` contains WXT Manifest V3 entrypoints.
- `wxt.config.ts` declares extension permissions and build configuration.
- `docs/SPEC.md` records the broader product and technical design.

## Limitations

- YouTube captions or Live CC must be available.
- Translation latency and quality depend on the selected provider and model.
- Only Chrome Manifest V3 builds are currently tested.
- The API key is stored locally but is not protected by a separate passphrase.

## Troubleshooting

- **No subtitles:** enable CC and confirm translation is enabled in the extension settings.
- **Authentication error:** verify the API key, endpoint, model, and provider balance.
- **Custom endpoint fails:** approve its host permission and use an OpenAI-compatible chat-completions URL.
- **Extension stopped after an update:** reload it from `chrome://extensions`, then refresh the YouTube tab.

## Contributing and security

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a pull request. Please report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not through a public issue.

## License

MIT © Harvey Chan. See [LICENSE](LICENSE).
