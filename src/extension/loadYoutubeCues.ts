/**
 * Load Cue[] for the current YouTube watch page (SPEC §7.1 / §14).
 *
 * Strategy:
 * 1. Resolve caption track baseUrl from player response
 * 2. Direct MAIN-world fetch (often empty on modern YouTube)
 * 3. Wait for MAIN-world intercept of the *player's* timedtext request
 *    (player has anti-bot / pot context that bare fetch lacks)
 */

import {
  fetchCues,
  parseTimedTextBody,
  pickAudioLanguage,
  pickCaptionTrack,
} from "../core/captionSource";
import type { Cue } from "../core/captions";
import { isChineseLangCode } from "../core/languageGuess";
import { SourceIsTargetError } from "./session";
import type { ExtensionSettings } from "./settings";
import { extractYtInitialPlayerResponse } from "./youtubePlayer";

const MAIN_SOURCE = "rst-main";
const ISOLATED_SOURCE = "rst-isolated";
const PLAYER_RESPONSE_TYPE = "player-response";
const FETCH_TEXT_TYPE = "fetch-text";
const FETCH_TEXT_RESULT_TYPE = "fetch-text-result";
const TIMEDTEXT_CAPTURE_TYPE = "timedtext-capture";

/** Minimal same-page message bus (MAIN ↔ isolated). Injectable for tests. */
export interface BridgePort {
  post(msg: unknown): void;
  subscribe(handler: (msg: unknown) => void): () => void;
}

export function createWindowBridgePort(): BridgePort {
  return {
    post(msg) {
      window.postMessage(msg, "*");
    },
    subscribe(handler) {
      const onMessage = (event: MessageEvent) => {
        if (event.source != null && event.source !== window) return;
        handler(event.data);
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    },
  };
}

export function waitForMainPlayerResponse(
  timeoutMs = 8000,
  port: BridgePort = createWindowBridgePort(),
): Promise<unknown | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: unknown | null) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearInterval(ping);
      clearTimeout(timer);
      resolve(value);
    };

    const unsubscribe = port.subscribe((data) => {
      if (
        data &&
        typeof data === "object" &&
        (data as { source?: unknown }).source === MAIN_SOURCE &&
        (data as { type?: unknown }).type === PLAYER_RESPONSE_TYPE
      ) {
        finish((data as { data?: unknown }).data ?? null);
      }
    });

    const request = () => {
      port.post({ source: ISOLATED_SOURCE, type: "request-player-response" });
    };
    request();
    const ping = setInterval(request, 300);
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/** Ask MAIN world to fetch a URL with page credentials. */
export function fetchTextViaMainWorld(
  url: string,
  timeoutMs = 12000,
  port: BridgePort = createWindowBridgePort(),
): Promise<string> {
  const id = `ft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      fn();
    };

    unsubscribe = port.subscribe((data) => {
      if (
        !data ||
        typeof data !== "object" ||
        (data as { source?: unknown }).source !== MAIN_SOURCE ||
        (data as { type?: unknown }).type !== FETCH_TEXT_RESULT_TYPE ||
        (data as { id?: unknown }).id !== id
      ) {
        return;
      }
      if ((data as { ok?: unknown }).ok === true) {
        const text = (data as { text?: unknown }).text;
        finish(() => {
          if (typeof text === "string") resolve(text);
          else reject(new Error("MAIN fetch-text-result missing text"));
        });
        return;
      }
      const error =
        typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "MAIN-world timedtext fetch failed";
      finish(() => reject(new Error(error)));
    });

    port.post({ source: ISOLATED_SOURCE, type: FETCH_TEXT_TYPE, id, url });
    timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            "MAIN-world timedtext fetch timed out (is the MAIN content script loaded?)",
          ),
        ),
      );
    }, timeoutMs);
  });
}

/**
 * Ask MAIN to enable captions and wait until the player’s timedtext request
 * is intercepted (non-empty body).
 */
export function waitForPlayerTimedtextCapture(
  lang: string,
  timeoutMs = 15000,
  port: BridgePort = createWindowBridgePort(),
): Promise<string> {
  const id = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      fn();
    };

    unsubscribe = port.subscribe((data) => {
      if (!data || typeof data !== "object") return;
      const msg = data as {
        source?: unknown;
        type?: unknown;
        id?: unknown;
        text?: unknown;
        ok?: unknown;
        error?: unknown;
      };

      // Live capture broadcast (player network intercept).
      if (
        msg.source === MAIN_SOURCE &&
        msg.type === TIMEDTEXT_CAPTURE_TYPE &&
        typeof msg.text === "string" &&
        msg.text.trim() !== ""
      ) {
        finish(() => resolve(msg.text as string));
        return;
      }

      // Explicit wait-timedtext-capture reply.
      if (
        msg.source === MAIN_SOURCE &&
        msg.type === FETCH_TEXT_RESULT_TYPE &&
        msg.id === id
      ) {
        if (msg.ok === true && typeof msg.text === "string") {
          finish(() => resolve(msg.text as string));
        } else {
          const err =
            typeof msg.error === "string"
              ? msg.error
              : "timedtext capture failed";
          finish(() => reject(new Error(err)));
        }
      }
    });

    port.post({
      source: ISOLATED_SOURCE,
      type: "enable-captions",
      lang,
    });
    port.post({
      source: ISOLATED_SOURCE,
      type: "wait-timedtext-capture",
      id,
      lang,
      timeoutMs,
    });

    timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            "Timed out waiting for player timedtext. Click the CC button on YouTube once, then hard-refresh.",
          ),
        ),
      );
    }, timeoutMs + 500);
  });
}

export async function loadYoutubeCues(
  settings: ExtensionSettings,
  doc: Document = document,
  port: BridgePort = createWindowBridgePort(),
): Promise<Cue[]> {
  let playerResponse: unknown | null = extractYtInitialPlayerResponse(doc);
  if (!playerResponse) {
    playerResponse = await waitForMainPlayerResponse(8000, port);
  }
  if (!playerResponse) {
    playerResponse = extractYtInitialPlayerResponse(doc);
  }
  if (!playerResponse) {
    throw new Error(
      "Could not read ytInitialPlayerResponse (open a /watch?v=… page and hard-refresh)",
    );
  }

  // zh-audio videos skip translation regardless of caption-track language —
  // a Chinese video with creator-supplied English subs must not burn tokens
  // (observed on zkpNM5rq3LI: audio zh-Hant, only caption track "en").
  const audioLang = pickAudioLanguage(playerResponse);
  if (audioLang && isChineseLangCode(audioLang)) {
    throw new SourceIsTargetError();
  }

  const track =
    pickCaptionTrack(playerResponse, settings.sourceLang) ??
    pickCaptionTrack(playerResponse);
  if (!track) {
    throw new Error(
      "No caption track on this video — pick a video with CC / English subtitles",
    );
  }

  // Path A: direct MAIN fetch of the signed baseUrl (+ fmt variants).
  try {
    return await fetchCues(track.baseUrl, async (url) => ({
      text: async () => fetchTextViaMainWorld(url, 10000, port),
    }));
  } catch (directErr) {
    // Path B: let the player load captions; intercept the network body.
    try {
      const body = await waitForPlayerTimedtextCapture(
        settings.sourceLang || "en",
        15000,
        port,
      );
      return parseTimedTextBody(body);
    } catch (captureErr) {
      const a =
        directErr instanceof Error ? directErr.message : String(directErr);
      const b =
        captureErr instanceof Error
          ? captureErr.message
          : String(captureErr);
      throw new Error(
        `Could not load captions.\nDirect fetch: ${a}\nPlayer intercept: ${b}`,
      );
    }
  }
}
