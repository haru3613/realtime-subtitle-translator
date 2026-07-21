/**
 * Live caption mode: when YouTube timedtext API returns empty bodies (common
 * 2025+), scrape the on-screen CC DOM the player already renders and translate
 * that text. Requires the user (or player API) to enable native CC.
 *
 * Latency design (SPEC §7.4): the rolling CC window is merged into a
 * transcript and split into sentences by `core/liveSegmenter`. Completed
 * sentences translate exactly once (bounded concurrency); the in-progress
 * tail retranslates with a streaming `onPartial` so 繁中 appears while the
 * provider is still generating. The previous translation stays visible until
 * a newer one lands — the overlay only clears when the native CC disappears.
 */

import type { SubtitleSink, Translate } from "../core/subtitleRenderer";
import {
  mergeRollingWindow,
  splitSentences,
  type SentenceSplit,
} from "../core/liveSegmenter";
import { isMostlyChinese, LANG_DECIDE_CHARS } from "../core/languageGuess";
import type { ExtensionSettings } from "./settings";
import type { CaptionSession } from "./session";

export interface LiveCaptionSessionDeps {
  settings: ExtensionSettings;
  createSink: (container: HTMLElement) => SubtitleSink & { detach(): void };
  createTranslate: (settings: ExtensionSettings) => Translate;
  container?: HTMLElement;
  /** Root to observe; defaults to .html5-video-player or documentElement. */
  observeRoot?: HTMLElement;
  onError?: (err: unknown) => void;
  /** Poll interval ms (MutationObserver + poll for robustness). */
  pollMs?: number;
  /** Optional: hide native CC chrome so only our bilingual overlay shows. */
  hideNative?: boolean;
  /** Fired once when captions are detected as already-Chinese; the session
   *  has already restored native CC and shut itself down. */
  onSourceIsTarget?: () => void;
}

/** Read currently visible YouTube CC text from the player DOM. */
export function readYoutubeCaptionText(root: ParentNode = document): string {
  const segmentNodes = root.querySelectorAll(
    ".ytp-caption-segment, .caption-visual-line .ytp-caption-segment",
  );
  if (segmentNodes.length > 0) {
    return Array.from(segmentNodes)
      .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  // Fallback: whole caption window (may include duplicates).
  const windowEl = root.querySelector(
    ".ytp-caption-window-container, .caption-window",
  );
  if (windowEl) {
    return (windowEl.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  return "";
}

function injectHideNativeStyle(): () => void {
  const style = document.createElement("style");
  style.setAttribute("data-rst-hide-native-cc", "");
  // Hide every common YouTube caption chrome so only RST overlay is visible.
  // Keep nodes in DOM (visibility/opacity) so we can still scrape textContent.
  style.textContent = `
    .ytp-caption-window-container,
    .ytp-caption-window-rollup,
    .ytp-caption-window,
    .caption-window,
    .captions-text,
    .ytp-caption-segment {
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  (document.head ?? document.documentElement).append(style);
  return () => style.remove();
}

/** Sentences whose translation to keep around (transcript cap ≈ 20 sentences). */
const MAX_TRANSLATION_ENTRIES = 100;
/** Dedup-set cap so an hours-long stream cannot grow it unbounded. */
const MAX_REQUESTED_ENTRIES = 300;
/** Only the newest completed sentences are (re)enqueued each tick. */
const ENQUEUE_WINDOW = 3;
const MAX_SENTENCE_CONCURRENCY = 2;
/** Don't burn a request on a tail shorter than ~2 words. */
const MIN_TAIL_CHARS = 12;
/** A hung provider must not hold a translation slot forever. */
const TRANSLATE_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("translate timed out")),
      TRANSLATE_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Start a live session that translates whatever native CC is currently shown.
 * Does not require timedtext network access.
 */
export function startLiveCaptionSession(
  deps: LiveCaptionSessionDeps,
): CaptionSession {
  const container = deps.container ?? document.documentElement;
  const sink = deps.createSink(container);
  const translate = deps.createTranslate(deps.settings);
  const pollMs = deps.pollMs ?? 250;
  const observeRoot =
    deps.observeRoot ??
    (document.querySelector(".html5-video-player") as HTMLElement | null) ??
    document.documentElement;

  let stopped = false;
  const unhide = deps.hideNative === false ? () => {} : injectHideNativeStyle();

  let transcript = "";
  let lastWindow = "";
  let lastRenderKey = "";
  // Bumped when CC vanishes; in-flight callbacks from the previous utterance
  // check it and drop their (now stale) results.
  let generation = 0;
  // Set when async work finishes while the CC window is static, so the next
  // poll tick reprocesses (retry failed sentence / retranslate grown tail).
  let needsReprocess = false;
  // Already-Chinese detection: sample transcript growth across utterances
  // until LANG_DECIDE_CHARS, then stop checking (SPEC §7.4).
  let langSample = "";
  let langDecided = false;
  let sampledTranscriptLen = 0;

  // Completed-sentence path: translate each sentence exactly once.
  const translations = new Map<string, string>(); // sentence → 繁中
  const requested = new Set<string>(); // queued or in flight
  const queue: string[] = [];
  let running = 0;

  // In-progress tail path: one streaming request at a time.
  let tailZh: { source: string; text: string } | null = null;
  let tailInFlight = false;
  let lastRequestedTail = "";

  const refreshRender = (split?: SentenceSplit) => {
    if (stopped || transcript === "") return;
    const { complete, tail } = split ?? splitSentences(transcript);
    const lastSentence = complete[complete.length - 1];

    const zhParts: string[] = [];
    let tailZhUsedForSentence = false;
    if (lastSentence) {
      const zh = translations.get(lastSentence);
      if (zh) {
        zhParts.push(zh);
      } else if (tailZh && lastSentence.startsWith(tailZh.source)) {
        // The sentence just completed and its own translation is still in
        // flight — keep showing the tail partial that covered it until then.
        zhParts.push(tailZh.text);
        tailZhUsedForSentence = true;
      }
    }
    if (
      tail !== "" &&
      tailZh &&
      !tailZhUsedForSentence &&
      tail.startsWith(tailZh.source)
    ) {
      zhParts.push(tailZh.text);
    }
    if (zhParts.length === 0) return; // nothing translated yet — keep display

    const source = [lastSentence ?? "", tail].filter(Boolean).join(" ");
    const translated = zhParts.join(" ");
    const key = `${source}|${translated}`;
    if (key === lastRenderKey) return;
    lastRenderKey = key;
    sink.render({ source, translated });
  };

  const pump = () => {
    while (!stopped && running < MAX_SENTENCE_CONCURRENCY && queue.length > 0) {
      const sentence = queue.shift()!;
      running += 1;
      withTimeout(translate(sentence))
        .then((zh) => {
          translations.set(sentence, zh);
          if (translations.size > MAX_TRANSLATION_ENTRIES) {
            const oldest = translations.keys().next().value;
            if (oldest !== undefined) translations.delete(oldest);
          }
          refreshRender();
        })
        .catch((err) => {
          requested.delete(sentence);
          // ponytail: retries every poll tick (~250ms) while the window is
          // static — same pacing the old line-based code had; add capped
          // backoff if a persistently failing provider ever becomes a storm.
          needsReprocess = true;
          deps.onError?.(err);
        })
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  const enqueueSentence = (sentence: string) => {
    if (translations.has(sentence) || requested.has(sentence)) return;
    requested.add(sentence);
    if (requested.size > MAX_REQUESTED_ENTRIES) {
      const oldest = requested.values().next().value;
      if (oldest !== undefined) requested.delete(oldest);
    }
    queue.push(sentence);
    pump();
  };

  const maybeTranslateTail = (tail: string) => {
    if (tail.length < MIN_TAIL_CHARS) return;
    if (tailInFlight || tail === lastRequestedTail) return;
    tailInFlight = true;
    lastRequestedTail = tail;
    const gen = generation;
    withTimeout(
      translate(tail, {
        onPartial: (partial) => {
          if (stopped || gen !== generation) return;
          tailZh = { source: tail, text: partial };
          refreshRender();
        },
      }),
    )
      .then((zh) => {
        if (gen !== generation) return; // utterance ended while in flight
        tailZh = { source: tail, text: zh };
        refreshRender();
      })
      .catch((err) => {
        if (gen === generation) lastRequestedTail = ""; // allow retry
        deps.onError?.(err);
      })
      .finally(() => {
        // Only release the slot we still own — after a CC-vanish reset the
        // new utterance's tail request may already hold it.
        if (gen === generation) tailInFlight = false;
        if (stopped || gen !== generation) return;
        // The tail may have grown while this request was in flight and the
        // window can stay static afterwards (speaker paused), so re-fire
        // directly instead of waiting for a DOM change.
        const { tail: currentTail } = splitSentences(transcript);
        if (currentTail !== tail) maybeTranslateTail(currentTail);
      });
  };

  const tick = () => {
    if (stopped) return;
    const windowText = readYoutubeCaptionText(document);
    if (windowText === lastWindow && !needsReprocess) return;
    needsReprocess = false;
    lastWindow = windowText;

    if (windowText === "") {
      // Native CC vanished (speech pause / CC off) — mirror it and reset the
      // transcript so the next utterance does not merge across the silence.
      generation += 1;
      transcript = "";
      sampledTranscriptLen = 0;
      tailZh = null;
      tailInFlight = false; // stale in-flight request belongs to the old gen
      lastRequestedTail = "";
      lastRenderKey = "";
      sink.clear();
      return;
    }

    transcript = mergeRollingWindow(transcript, windowText);
    if (!langDecided) {
      if (transcript.length > sampledTranscriptLen) {
        langSample += transcript.slice(sampledTranscriptLen);
        sampledTranscriptLen = transcript.length;
      }
      if (isMostlyChinese(langSample)) {
        // Native CC is already Chinese: restore it and go fully idle —
        // zero further DOM polling, zero provider calls.
        deps.onSourceIsTarget?.();
        shutdown();
        return;
      }
      if (langSample.length >= LANG_DECIDE_CHARS) langDecided = true;
    }
    const split = splitSentences(transcript);
    for (const sentence of split.complete.slice(-ENQUEUE_WINDOW)) {
      enqueueSentence(sentence);
    }
    maybeTranslateTail(split.tail);
    refreshRender(split);
  };

  const observer = new MutationObserver(() => tick());
  observer.observe(observeRoot, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const interval = window.setInterval(tick, pollMs);

  const shutdown = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    window.clearInterval(interval);
    unhide();
    sink.clear();
    sink.detach();
  };

  tick();

  return { stop: shutdown };
}
