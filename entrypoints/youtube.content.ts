/**
 * Isolated content script: load captions, run the translation session, mount
 * the Shadow-DOM bilingual overlay on YouTube watch pages.
 *
 * Mode A: timedtext cues (preferred when network works)
 * Mode B: live DOM scrape of native CC (fallback when timedtext returns empty)
 */

import { SubtitleOverlay } from "../src/core/overlay";
import { createWindowBridgePort } from "../src/extension/loadYoutubeCues";
import { loadYoutubeCues } from "../src/extension/loadYoutubeCues";
import {
  isSettingsConfigured,
  type ExtensionSettings,
} from "../src/extension/settings";
import {
  SOURCE_IS_TARGET_MESSAGE,
  SourceIsTargetError,
  startCaptionSession,
  type CaptionSession,
} from "../src/extension/session";
import { startLiveCaptionSession } from "../src/extension/liveCaptions";
import { onStorageChanged } from "../src/extension/chromeApi";
import { createStatusBanner } from "../src/extension/statusBanner";
import { loadSettings } from "../src/extension/storage";
import { createBackgroundTranslate } from "../src/extension/translateBridge";
import {
  extractVideoIdFromUrl,
  findPrimaryVideo,
} from "../src/extension/youtubePlayer";

/** Bumped so chrome://extensions version proves the new build is loaded. */
const RST_BUILD = "0.3.3-skip-zh-audio";

const SKIP_BANNER = SOURCE_IS_TARGET_MESSAGE;

function log(...args: unknown[]): void {
  console.info("[rst]", ...args);
}

function waitForVideo(timeoutMs = 15000): Promise<HTMLVideoElement> {
  const existing = findPrimaryVideo(document);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error("No <video> element found on this page"));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const v = findPrimaryVideo(document);
      if (v) {
        window.clearTimeout(timer);
        observer.disconnect();
        resolve(v);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

function makeSink(settings: ExtensionSettings) {
  return (container: HTMLElement) => {
    const overlay = new SubtitleOverlay(container);
    return {
      render(content: { source: string; translated: string }) {
        overlay.render({
          source: settings.bilingual ? content.source : "",
          translated: content.translated,
        });
      },
      clear: () => overlay.clear(),
      detach: () => overlay.detach(),
    };
  };
}

export default defineContentScript({
  matches: ["*://*.youtube.com/*", "*://youtube.com/*"],
  runAt: "document_idle",
  main() {
    const status = createStatusBanner();
    let session: CaptionSession | null = null;
    let activeVideoId: string | null = null;
    let starting = false;
    let startGeneration = 0;
    let lastTranslateErrorAt = 0;

    const stop = () => {
      session?.stop();
      session = null;
      activeVideoId = null;
    };

    const onTranslateError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const now = Date.now();
      if (now - lastTranslateErrorAt > 2000) {
        lastTranslateErrorAt = now;
        status.set(`translate error: ${msg}`, "err");
        log("translate error:", msg);
      }
    };

    const startIfNeeded = async () => {
      const generation = ++startGeneration;
      const videoId = extractVideoIdFromUrl(location.href);
      if (!videoId) {
        stop();
        status.clear();
        return;
      }
      if (starting) return;
      if (session && activeVideoId === videoId) return;
      const isStale = () =>
        generation !== startGeneration ||
        extractVideoIdFromUrl(location.href) !== videoId;

      starting = true;
      try {
        stop();
        status.set(`loading settings… (${RST_BUILD})`, "info");
        const settings: ExtensionSettings = await loadSettings();
        if (isStale()) return;
        log("settings", {
          build: RST_BUILD,
          endpoint: settings.endpoint,
          model: settings.model,
          hasKey: Boolean(settings.apiKey),
          enabled: settings.enabled,
        });
        if (!settings.enabled) {
          status.set("disabled in Options", "info");
          log("disabled in options");
          return;
        }
        if (!isSettingsConfigured(settings)) {
          status.set("open Options → set endpoint + API key + model", "err");
          log("open Options and set endpoint + API key + model");
          return;
        }

        status.set("waiting for player…", "info");
        const video = await waitForVideo();
        if (isStale()) return;
        const createSink = makeSink(settings);

        // Ask MAIN world to enable captions early (helps both modes).
        createWindowBridgePort().post({
          source: "rst-isolated",
          type: "enable-captions",
          lang: settings.sourceLang || "en",
        });

        // --- Mode A: timedtext cue list ---
        status.set("loading timedtext…", "info");
        log("starting caption session for", videoId, RST_BUILD);
        try {
          const candidate = await startCaptionSession({
            settings,
            video,
            container: document.documentElement,
            loadCues: () => loadYoutubeCues(settings),
            createSink,
            createTranslate: createBackgroundTranslate,
            onError: onTranslateError,
          });
          if (isStale()) {
            candidate.stop();
            return;
          }
          session = candidate;
          activeVideoId = videoId;
          status.set(`running timedtext (${videoId})`, "ok");
          window.setTimeout(() => {
            if (activeVideoId === videoId) status.clear();
          }, 4000);
          log("session running (timedtext mode)");
          return;
        } catch (timedtextErr) {
          if (isStale()) return;
          if (timedtextErr instanceof SourceIsTargetError) {
            status.set(SKIP_BANNER, "info");
            log("captions already Chinese — skipped (timedtext)");
            return;
          }
          log(
            "timedtext mode failed, falling back to live CC DOM:",
            timedtextErr instanceof Error
              ? timedtextErr.message
              : timedtextErr,
          );
        }

        // --- Mode B: scrape native on-screen CC ---
        status.set(
          "live CC mode — turn on YouTube CC, then play",
          "info",
        );
        if (isStale()) return;
        let sourceIsTarget = false;
        session = startLiveCaptionSession({
          settings,
          createSink,
          createTranslate: createBackgroundTranslate,
          container: document.documentElement,
          hideNative: true,
          onError: onTranslateError,
          onSourceIsTarget: () => {
            sourceIsTarget = true;
            status.set(SKIP_BANNER, "info");
            log("captions already Chinese — skipped (live CC)");
          },
        });
        activeVideoId = videoId;
        if (!sourceIsTarget) {
          status.set(`running live-CC (${videoId}) — enable CC`, "ok");
          window.setTimeout(() => {
            if (activeVideoId === videoId) status.clear();
          }, 6000);
        }
        log("session running (live CC mode)");
      } catch (err) {
        if (isStale()) return;
        const msg = err instanceof Error ? err.message : String(err);
        status.set(msg, "err");
        log("failed to start:", msg);
        stop();
      } finally {
        starting = false;
        if (generation !== startGeneration) void startIfNeeded();
      }
    };

    status.set(`extension loaded (${RST_BUILD})`, "info");
    log("content script", RST_BUILD);
    void startIfNeeded();
    document.addEventListener("yt-navigate-finish", () => {
      void startIfNeeded();
    });
    let lastHref = location.href;
    window.setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        void startIfNeeded();
      }
    }, 1000);

    onStorageChanged((changes, area) => {
      if (area !== "local") return;
      if (!("rst.settings" in changes)) return;
      stop();
      void startIfNeeded();
    });
  },
});
