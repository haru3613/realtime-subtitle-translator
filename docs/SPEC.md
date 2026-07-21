# Chrome Extension 即時影片翻譯工具 — Product & Technical Spec

## 1. 背景

目前 YouTube 內建自動翻譯字幕品質不穩，常見問題包括：

* 原始 ASR 聽錯，導致後續翻譯也錯。
* 技術、AI、Crypto、金融、開發者影片術語翻譯不準。
* 無法套用使用者自訂術語表。
* 不支援跨網站一致體驗，例如 YouTube、Udemy、Coursera、X/Twitter、一般網頁影片。
* 缺乏本機 ASR 與可控翻譯 provider 的組合。

因此，本專案目標是建立一個 Chrome Extension，用於觀看國外網頁影片時，即時產生高品質繁體中文字幕。

核心策略：

```text
Chrome Extension 負責音訊擷取與字幕顯示
Local Daemon 負責 ASR、翻譯、快取與模型管理
開源 ASR / 翻譯專案作為後端積木
```

## 2. 產品目標

### 2.1 主要目標

建立一個可用於 Chrome / Chromium-based browser 的即時影片翻譯工具，支援：

* 擷取目前瀏覽器 tab 的音訊。
* 使用本機 ASR 將外語語音轉成文字。
* 使用翻譯 provider 將文字翻成繁體中文。
* 將翻譯字幕即時疊加在影片上。
* 支援術語表，改善技術影片翻譯品質。
* 支援 YouTube 原字幕翻譯模式，作為低成本 fallback。
* 支援本機與雲端翻譯 provider 切換。

### 2.2 非目標

MVP 階段不處理：

* VLC / Zoom / Discord / 桌面播放器音訊。
* 即時語音配音。
* 多人語者辨識。
* 完整字幕編輯器。
* 行動版瀏覽器支援。
* 把大型 ASR 模型直接打包進 Chrome Extension。

## 3. 使用場景

### 3.1 主要使用者

經常觀看英文或外語影片的技術型使用者，例如：

* 軟體工程師
* AI / Crypto / Finance 研究者
* 線上課程學習者
* 國外訪談、podcast、conference talk 觀看者

### 3.2 典型情境

#### 情境 A：YouTube 技術影片

使用者正在觀看一支英文 AI 影片，YouTube 自動翻譯字幕把 `inference` 翻成「推斷」，把 `rollup` 翻成「彙總」。使用者開啟 extension，選擇「本機 ASR + LLM 翻譯 + AI 術語表」，字幕顯示為較自然的繁中翻譯。

#### 情境 B：Udemy / Coursera 課程

使用者觀看英文教學影片，平台原生字幕品質普通。Extension 擷取 tab audio，透過本機 Whisper 轉錄並即時翻譯成繁中字幕。

#### 情境 C：低成本模式

使用者觀看 YouTube，影片已有英文字幕。使用者選擇「字幕翻譯模式」，extension 直接擷取 YouTube caption text 進行翻譯，不啟動 ASR。

## 4. 系統架構

### 4.1 高層架構

```text
Browser Tab Video
        ↓
Chrome Extension
        ↓
tabCapture / Caption Extraction
        ↓
Local Daemon
        ↓
ASR Engine
        ↓
Translation Engine
        ↓
Subtitle Segment
        ↓
Chrome Extension Overlay
```

### 4.2 元件劃分

```text
Chrome Extension
├── Popup UI
├── Background Service Worker
├── Offscreen Document
├── Content Script
├── Subtitle Overlay
└── Settings Storage

Local Daemon
├── WebSocket Server
├── Audio Preprocessor
├── VAD
├── ASR Adapter
├── Translation Adapter
├── Glossary Manager
├── Subtitle Segment Cache
└── Provider Config Manager
```

## 5. Chrome Extension 設計

### 5.1 Popup UI

功能：

* Start / Stop 翻譯
* 選擇模式：

  * Caption Translation Mode
  * ASR Translation Mode
* 選擇來源語言：

  * Auto
  * English
  * Japanese
  * Korean
  * Chinese
  * Custom
* 選擇目標語言：

  * Traditional Chinese
  * Simplified Chinese
  * English
  * Japanese
  * Custom
* 選擇翻譯 provider：

  * OpenAI-compatible API
  * Ollama
  * DeepL
  * Google Translate
  * LibreTranslate
  * Argos Translate
* 選擇 ASR provider：

  * WhisperLiveKit
  * faster-whisper
  * whisper.cpp
  * Custom WebSocket ASR
* 開啟 / 關閉雙語字幕
* 選擇字幕位置
* 設定字幕大小
* 設定 Local Daemon URL

### 5.2 Background Service Worker

職責：

* 管理 extension lifecycle。
* 接收 popup 的 start / stop 指令。
* 呼叫 `chrome.tabCapture` 取得目前 tab 的 stream ID。
* 建立 offscreen document。
* 管理 extension 與 content script 的 message routing。
* 偵測 tab change / reload / close 時自動停止翻譯。

### 5.3 Offscreen Document

職責：

* 使用 `getUserMedia()` 消費 tab capture stream。
* 使用 Web Audio API 讀取音訊。
* 將音訊轉成 mono PCM。
* 重採樣至 16kHz。
* 以固定 chunk 傳送到 Local Daemon。
* 將 captured audio 接回 output，避免 tab 被 capture 後靜音。

音訊 chunk 建議：

```text
sample_rate: 16000
channels: 1
format: pcm_s16le
chunk_duration: 500ms - 1000ms
transport: WebSocket binary frame
```

### 5.4 Content Script

職責：

* 偵測頁面中的 video element。
* 注入字幕 overlay。
* 監聽 fullscreen change。
* 支援 YouTube / Udemy / Coursera / X/Twitter / generic video。
* 接收 background 傳來的字幕 segment。
* 根據影片播放狀態控制字幕顯示。

### 5.5 Subtitle Overlay

字幕顯示需求：

* 支援單語字幕。
* 支援雙語字幕。
* 支援 Shadow DOM，避免被網站 CSS 污染。
* 支援 fullscreen。
* 支援字幕位置調整。
* 支援透明背景。
* 支援字體大小、行距、最大寬度調整。
* 支援暫停 / 恢復。
* 支援顯示 partial result 與 final result。

字幕資料格式：

```json
{
  "segment_id": "seg_000123",
  "source_text": "The developer experience around Cairo is still too niche.",
  "translated_text": "Cairo 的開發者體驗仍然太小眾。",
  "start_time": 123.5,
  "end_time": 128.2,
  "is_final": true,
  "confidence": 0.91,
  "provider": {
    "asr": "whisperlivekit",
    "translation": "openai-compatible"
  }
}
```

## 6. Local Daemon 設計

### 6.1 職責

Local Daemon 不屬於 Chrome Extension 本體，負責重型任務：

* 接收 browser tab audio。
* 執行 VAD。
* 執行 ASR。
* 執行翻譯。
* 套用 glossary。
* 做 translation cache。
* 回傳字幕 segment。
* 管理不同模型與 provider。

### 6.2 API

#### WebSocket Audio Endpoint

```text
ws://127.0.0.1:17531/v1/audio/stream
```

Client sends:

```json
{
  "type": "start",
  "session_id": "sess_abc123",
  "source_lang": "en",
  "target_lang": "zh-TW",
  "mode": "asr_translation",
  "asr_provider": "whisperlivekit",
  "translation_provider": "openai-compatible",
  "glossary_profile": "ai_crypto"
}
```

Then client sends binary PCM chunks.

Server returns:

```json
{
  "type": "subtitle",
  "session_id": "sess_abc123",
  "segment_id": "seg_000001",
  "source_text": "This rollup is still struggling with developer adoption.",
  "translated_text": "這個 Rollup 在開發者採用上仍然很吃力。",
  "is_final": true,
  "start_time": 3.2,
  "end_time": 7.8,
  "latency_ms": 4200
}
```

Stop message:

```json
{
  "type": "stop",
  "session_id": "sess_abc123"
}
```

### 6.3 Health Check

```text
GET http://127.0.0.1:17531/health
```

Response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "available_asr_providers": ["whisperlivekit", "faster-whisper", "whisper.cpp"],
  "available_translation_providers": ["openai-compatible", "ollama", "deepl", "libretranslate", "argos"]
}
```

## 7. 翻譯策略

### 7.1 翻譯模式

支援兩種模式：

#### Mode A：字幕翻譯模式

```text
Page Captions
→ Extract caption text
→ Translate
→ Overlay bilingual subtitles
```

優點：

* 成本低。
* 延遲低。
* 不需要 ASR。
* 適合作為 v0。

缺點：

* 依賴平台原始字幕品質。
* 無字幕影片無法使用。

#### Mode B：音訊 ASR 翻譯模式

```text
Tab Audio
→ Local ASR
→ Translate
→ Overlay subtitles
```

優點：

* 不依賴 YouTube 自動字幕。
* 可支援任意網頁影片。
* 可控 ASR 模型與翻譯模型。
* 可套用術語表。

缺點：

* 延遲較高。
* 需要 Local Daemon。
* 需要額外安裝模型或 provider。

### 7.2 翻譯 Provider

支援 provider adapter 架構：

```text
TranslationAdapter
├── OpenAICompatibleAdapter
├── OllamaAdapter
├── DeepLAdapter
├── GoogleTranslateAdapter
├── LibreTranslateAdapter
└── ArgosTranslateAdapter
```

### 7.3 LLM 翻譯 Prompt

預設 prompt 應保持短小，避免 token 成本過高。

建議 system prompt：

```text
Translate subtitles into Traditional Chinese. Keep technical terms accurate. Do not explain.
```

單次輸入格式：

```json
{
  "previous_source": "The network is EVM-compatible.",
  "previous_translation": "這個網路相容 EVM。",
  "current_source": "But the rollup still has weak developer adoption.",
  "glossary": {
    "rollup": "Rollup",
    "staking": "質押",
    "inference": "推論",
    "settlement": "結算"
  }
}
```

輸出格式：

```json
{
  "translation": "但這個 Rollup 的開發者採用仍然偏弱。"
}
```

### 7.4 成本控制

必須實作：

* 不逐秒翻譯。
* 以句尾或 5–10 秒 chunk 送翻譯。
* 只保留最近 2–3 句上下文。
* glossary 限制在目前 profile 需要的詞。
* translation cache。
* 可選低成本 provider。
* 支援 local provider。

## 8. ASR 策略

### 8.1 ASR Provider

支援 provider adapter 架構：

```text
ASRAdapter
├── WhisperLiveKitAdapter
├── FasterWhisperAdapter
├── WhisperCppAdapter
└── CustomWebSocketAdapter
```

### 8.2 ASR 輸入格式

```text
PCM 16kHz mono
chunk duration: 500ms - 1000ms
```

### 8.3 ASR 輸出格式

```json
{
  "segment_id": "seg_000001",
  "text": "The model is much better at following instructions.",
  "start_time": 12.3,
  "end_time": 16.9,
  "is_final": true,
  "confidence": 0.88
}
```

### 8.4 延遲目標

| 場景   |   目標延遲 |
| ---- | -----: |
| 普通影片 |  2–5 秒 |
| 技術訪談 |  4–8 秒 |
| 直播   | 5–10 秒 |

不追求 0 秒延遲。過短 chunk 會造成句子不完整，降低 ASR 與翻譯品質。

## 9. Glossary 設計

### 9.1 Glossary Profile

使用者可以建立多個術語 profile：

```text
AI
Crypto
Finance
Software Engineering
Custom
```

### 9.2 Glossary Entry

```json
{
  "source": "rollup",
  "target": "Rollup",
  "note": "Do not translate as 彙總.",
  "case_sensitive": false,
  "domain": "crypto"
}
```

### 9.3 預設 AI / Crypto 術語

```text
rollup = Rollup
staking = 質押
settlement = 結算
inference = 推論
fine-tuning = 微調
embedding = embedding
agentic coding = agentic coding
context window = context window
liquidity = 流動性
slippage = 滑價
perpetual = 永續合約
```

## 10. 快取設計

### 10.1 Translation Cache

目的：

* 降低 token 成本。
* 避免重複翻譯相同片段。
* 提升字幕穩定性。

Cache key：

```text
hash(source_text + target_lang + glossary_profile + provider)
```

Cache value：

```json
{
  "source_text": "The rollup is EVM-compatible.",
  "translated_text": "這個 Rollup 相容 EVM。",
  "provider": "openai-compatible",
  "created_at": "2026-07-02T15:00:00Z"
}
```

### 10.2 Session Cache

每次播放 session 需要保存：

* 最近 source segments。
* 最近 translated segments。
* 當前 glossary profile。
* 當前 provider config。
* latency statistics。

## 11. 權限需求

Chrome Extension 需要的 permissions：

```json
{
  "permissions": [
    "tabCapture",
    "activeTab",
    "storage",
    "offscreen"
  ],
  "host_permissions": [
    "http://127.0.0.1/*",
    "http://localhost/*"
  ]
}
```

注意：

* 不應要求 `<all_urls>`，除非 generic video support 需要。
* 優先使用 `activeTab` 降低權限敏感度。
* Local Daemon 僅綁定 `127.0.0.1`，避免外部存取。

## 12. 安全與隱私

### 12.1 預設安全策略

* 音訊預設只送到本機 daemon。
* 不保存完整影片音訊。
* 不保存完整 transcript，除非使用者明確開啟 history。
* API key 存放在 Local Daemon，不放在 extension。
* Local Daemon 只監聽 localhost。
* WebSocket session 需要 local token 驗證。
* 使用者可清除 translation cache。

### 12.2 Provider 隱私等級

UI 應清楚標示：

```text
Local-only:
- whisper.cpp
- faster-whisper local
- LibreTranslate local
- Argos Translate local
- Ollama local

Cloud:
- OpenAI-compatible API
- DeepL API
- Google Translate
```

## 13. 開源整合策略

### 13.1 建議整合專案

ASR：

```text
whisper.cpp
faster-whisper
WhisperLiveKit
WhisperLive
```

翻譯：

```text
LibreTranslate
Argos Translate
Ollama
OpenAI-compatible API
DeepL API
```

字幕 / 影片處理參考：

```text
pyVideoTrans
Buzz
LiveCaptions-Translator
YouTube subtitle translator 類 extension
```

### 13.2 整合方式

不建議直接 copy 大量開源代碼到 extension。

建議方式：

```text
Extension repo:
- 自己維護 UI / overlay / browser integration

Local daemon repo:
- adapter 接 whisper.cpp / faster-whisper / WhisperLiveKit

External tools:
- 作為 optional dependency
- 透過 process / HTTP / WebSocket 溝通
```

### 13.3 授權注意事項

* MIT / Apache / BSD 類授權較適合整合。
* GPL 專案需謹慎，避免污染 closed-source extension。
* 若發布成商業產品，必須整理 third-party license notice。

## 14. MVP 分期

### v0：YouTube Caption Translation Mode

目標：先做出最薄可用產品。

功能：

* YouTube captions 擷取。
* 翻譯成繁體中文。
* 雙語字幕 overlay。
* OpenAI-compatible / DeepL / LibreTranslate provider。
* 基本 glossary。
* 基本設定頁。

成功標準：

* 可以在 YouTube 有字幕影片上穩定顯示雙語字幕。
* 延遲低於 1 秒。
* 可套用術語表。
* 不需要 Local Daemon。

### v1：ASR Translation Mode

目標：擺脫 YouTube 自動字幕。

功能：

* `chrome.tabCapture` 擷取 tab audio。
* offscreen document 處理音訊。
* WebSocket 傳送 PCM 到 Local Daemon。
* Local Daemon 接 WhisperLiveKit / faster-whisper。
* 回傳 ASR transcript。
* 翻譯後 overlay。
* Start / Stop 控制。
* Health check。
* Error handling。

成功標準：

* YouTube 無字幕影片可顯示繁中字幕。
* 一般英文影片延遲控制在 2–8 秒。
* 可正常 fullscreen 顯示。
* 可停止後釋放 audio stream 與 WebSocket。

### v2：Domain Translation Quality

目標：提升技術影片翻譯品質。

功能：

* 多 glossary profile。
* 最近 2–3 句上下文翻譯。
* translation memory。
* confidence fallback。
* provider fallback。
* domain mode：

  * AI
  * Crypto
  * Finance
  * Software Engineering
* local-only mode。

成功標準：

* 技術術語翻譯穩定。
* 長影片 token 成本可控。
* 翻譯一致性優於 YouTube 自動翻譯。

### v3：Productization

功能：

* Local daemon installer。
* Tray app。
* Auto update。
* Provider setup wizard。
* Usage statistics。
* Debug panel。
* Export SRT / VTT。
* Multi-site player support。

## 15. 錯誤處理

### 15.1 Extension 端

需要處理：

* 使用者未授權 tab capture。
* 無 active tab。
* 目前 tab 沒有 audio。
* 找不到 video element。
* fullscreen overlay 插入失敗。
* Local Daemon 未啟動。
* WebSocket 斷線。
* provider 回傳錯誤。
* 翻譯結果超時。

### 15.2 Local Daemon 端

需要處理：

* ASR provider 未安裝。
* 模型檔不存在。
* GPU 不可用，自動 fallback CPU。
* 翻譯 API key 缺失。
* 翻譯 API rate limit。
* chunk 格式錯誤。
* session timeout。
* memory usage 過高。

## 16. Debug / Observability

### 16.1 Extension Debug Panel

顯示：

* Current mode
* Current tab ID
* Capture status
* WebSocket status
* Audio chunk rate
* Last subtitle segment
* Average latency
* Error logs

### 16.2 Local Daemon Metrics

顯示：

* ASR latency
* Translation latency
* End-to-end latency
* Token usage
* Cache hit rate
* Provider error rate
* Active sessions
* CPU / GPU usage

## 17. 技術選型建議

### Extension

```text
Framework: WXT or Plasmo
Language: TypeScript
Manifest: MV3
Audio: Web Audio API
Overlay: Shadow DOM + content script
Storage: chrome.storage.local / sync
Transport: WebSocket
```

### Local Daemon

```text
Language: Python or Go
API: FastAPI / aiohttp / Go net/http
Streaming: WebSocket
ASR: WhisperLiveKit / faster-whisper / whisper.cpp
Translation: OpenAI-compatible / Ollama / LibreTranslate / Argos
Config: TOML / YAML
Cache: SQLite
```

### 推薦第一版

```text
Extension: WXT + TypeScript
Daemon: Python + FastAPI + WebSocket
ASR: WhisperLiveKit or faster-whisper
Translation: OpenAI-compatible + LibreTranslate
Cache: SQLite
```

## 18. 目錄結構建議

```text
realtime-subtitle-translator/
├── apps/
│   ├── extension/
│   │   ├── src/
│   │   │   ├── background/
│   │   │   ├── content/
│   │   │   ├── offscreen/
│   │   │   ├── popup/
│   │   │   ├── options/
│   │   │   └── shared/
│   │   ├── manifest.json
│   │   └── package.json
│   │
│   └── daemon/
│       ├── app/
│       │   ├── api/
│       │   ├── asr/
│       │   ├── translation/
│       │   ├── glossary/
│       │   ├── cache/
│       │   └── config/
│       ├── models/
│       ├── config.example.yaml
│       └── pyproject.toml
│
├── docs/
│   ├── architecture.md
│   ├── chrome-extension.md
│   ├── daemon-api.md
│   ├── provider-adapters.md
│   └── privacy.md
│
├── examples/
│   ├── glossary-ai.yaml
│   ├── glossary-crypto.yaml
│   └── config.local.yaml
│
└── README.md
```

## 19. 主要里程碑

### Milestone 1：Extension Skeleton

* 建立 WXT / Plasmo extension。
* popup UI。
* content script overlay。
* options page。
* storage config。

### Milestone 2：YouTube Caption Translation

* 擷取 YouTube captions。
* 串接翻譯 provider。
* 顯示雙語字幕。
* 支援 glossary。

### Milestone 3：Local Daemon

* 建立 daemon。
* health check。
* WebSocket audio endpoint。
* provider config。
* SQLite cache。

### Milestone 4：Tab Audio Capture

* 使用 `chrome.tabCapture`。
* 建立 offscreen document。
* 音訊轉 PCM 16k mono。
* WebSocket streaming。

### Milestone 5：ASR Integration

* 接 WhisperLiveKit / faster-whisper。
* 回傳 transcript。
* 支援 partial / final segment。
* 基本 latency 統計。

### Milestone 6：Translation Quality

* 最近上下文。
* glossary profile。
* translation cache。
* provider fallback。
* debug panel。

## 20. 成功指標

### 使用體驗

* 使用者 3 步內啟動翻譯。
* YouTube 有字幕模式延遲低於 1 秒。
* ASR 模式一般延遲 2–8 秒。
* fullscreen 模式字幕正常顯示。
* 停止翻譯後不影響影片播放。

### 翻譯品質

* 技術術語可透過 glossary 穩定控制。
* 翻譯結果比 YouTube 自動翻譯自然。
* 支援上下文，減少代詞與術語不一致。

### 成本

* 本機 ASR 不產生雲端 ASR 成本。
* 翻譯支援 low-cost provider。
* LLM 翻譯採 chunk batching。
* 支援 cache，降低重複翻譯成本。

### 穩定性

* WebSocket 斷線可恢復。
* Local Daemon 未啟動時 UI 顯示明確錯誤。
* 不因單一 provider 錯誤導致整個 extension crash。

## 21. 風險

### 21.1 技術風險

* Chrome MV3 lifecycle 對長時間音訊處理不友好。
* 不同網站 video DOM 差異大。
* fullscreen overlay 相容性需要逐站處理。
* ASR streaming chunk 過短會降低準確率。
* 本機模型安裝門檻高。

### 21.2 產品風險

* 純 extension 模式無法處理桌面 App 音訊。
* 使用者可能不願意安裝 Local Daemon。
* LLM API 成本與隱私疑慮。
* YouTube DOM 變更可能導致 caption extraction 壞掉。

### 21.3 緩解策略

* v0 先做 caption translation，降低難度。
* v1 再做 ASR mode。
* daemon 以 optional local app 提供。
* provider adapter 化。
* overlay 使用 Shadow DOM。
* 對 YouTube、Udemy、Coursera 先做站點最佳化，再支援 generic video。

## 22. 最小可行版本定義

MVP 必須完成：

```text
Chrome Extension
- popup start / stop
- YouTube caption extraction
- translation provider
- glossary
- subtitle overlay
- settings page

Local Daemon
- health check
- WebSocket endpoint
- one ASR provider
- one translation provider
- subtitle segment response
```

MVP 不必完成：

```text
- Desktop audio capture
- Mobile browser
- Voice dubbing
- Speaker diarization
- 完整字幕編輯器
- 多平台 installer
```

## 23. 一句話定位

本專案不是單純的 YouTube 字幕翻譯外掛，而是：

```text
一個以 Chrome Extension 為前端、本機 ASR/翻譯服務為後端的即時影片翻譯系統。
```

主要差異化：

```text
不依賴 YouTube 自動字幕
支援本機 ASR
支援可控翻譯 provider
支援技術術語表
支援低成本與 local-only 模式
```

## 🤖 Mission Control

<!-- mc:auto:start -->
> 🤖 Mission Control · scaffolded (un-armed) · arm via projects.toml
**Repo** https://github.com/haru3613/realtime-subtitle-translator
**Tenant note** [[Realtime Subtitle Translator]]
<!-- mc:auto:end -->