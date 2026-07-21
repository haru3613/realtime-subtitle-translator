/**
 * Caption-translation playback session (SPEC §14 v0 Mode A).
 * Composes core `renderSubtitleAt` with injected video clock + caption load +
 * translate + overlay sink. Framework-free so vitest can drive it; the content
 * script supplies real DOM / chrome messaging implementations.
 */

import type { Cue } from "../core/captions";
import {
  renderSubtitleAt,
  type SubtitleSink,
  type Translate,
} from "../core/subtitleRenderer";
import { isMostlyChinese } from "../core/languageGuess";
import type { ExtensionSettings } from "./settings";

export interface CaptionSession {
  stop(): void;
}

export interface CaptionSessionDeps {
  settings: ExtensionSettings;
  video: HTMLVideoElement;
  loadCues: () => Promise<Cue[]>;
  createSink: (container: HTMLElement) => SubtitleSink & { detach(): void };
  createTranslate: (settings: ExtensionSettings) => Translate;
  /** Playback time in seconds (defaults to video.currentTime). */
  now?: () => number;
  schedule?: (tick: () => void) => number;
  cancel?: (handle: number) => void;
  /** Overlay mount point; defaults to document.documentElement. */
  container?: HTMLElement;
  /** Optional error sink for translate / render failures (content UI). */
  onError?: (err: unknown) => void;
}

/** User-facing copy shared by the error below and the content-script banner. */
export const SOURCE_IS_TARGET_MESSAGE =
  "captions already Chinese — translation skipped";

/** Thrown when captions are already in the target language (Chinese). */
export class SourceIsTargetError extends Error {
  constructor() {
    super(SOURCE_IS_TARGET_MESSAGE);
    this.name = "SourceIsTargetError";
  }
}

export async function startCaptionSession(
  deps: CaptionSessionDeps,
): Promise<CaptionSession> {
  const cues = await deps.loadCues();
  if (cues.length === 0) {
    throw new Error("startCaptionSession: no captions available for this video");
  }

  // Already-Chinese captions: bail before creating the sink or translate
  // bridge so a zh video costs zero tokens (SPEC §7.4).
  const sample = cues
    .slice(0, 10)
    .map((c) => c.text)
    .join(" ");
  if (isMostlyChinese(sample)) {
    throw new SourceIsTargetError();
  }

  const container = deps.container ?? document.documentElement;
  const sink = deps.createSink(container);
  const translate = deps.createTranslate(deps.settings);
  const translations = new Map<string, Promise<string>>();
  let translating = 0;

  const translateOnce = (source: string): Promise<string> => {
    const cached = translations.get(source);
    if (cached) return cached;

    const pending = (async () => {
      translating += 1;
      try {
        return await translate(source);
      } finally {
        translating -= 1;
      }
    })();
    translations.set(source, pending);
    void pending.catch(() => translations.delete(source));
    return pending;
  };
  const now = deps.now ?? (() => deps.video.currentTime);
  const schedule =
    deps.schedule ??
    ((cb: () => void) => requestAnimationFrame(cb) as unknown as number);
  const cancel =
    deps.cancel ?? ((handle: number) => cancelAnimationFrame(handle));

  let stopped = false;
  let handle: number | null = null;
  let inFlight = false;
  let lastCueKey = "";

  const tick = () => {
    if (stopped) return;
    handle = schedule(asyncTick);
  };

  const asyncTick = async () => {
    if (stopped || inFlight) {
      if (!stopped) tick();
      return;
    }
    inFlight = true;
    try {
      const t = now();
      const activeIndex = cues.findIndex(
        (c) => t >= c.start && t < c.start + c.dur,
      );
      const active = cues[activeIndex];
      const key = active ? `${active.start}:${active.text}` : "";
      if (key !== lastCueKey) {
        if (active) {
          const activeTranslation = translateOnce(active.text);
          const next = cues[activeIndex + 1];
          if (next && translating < 2) {
            void translateOnce(next.text).catch(() => {});
          }
          await renderSubtitleAt(
            cues,
            t,
            () => activeTranslation,
            sink,
          );
        } else {
          const next = cues.find((cue) => cue.start > t);
          if (next && translating < 2) {
            void translateOnce(next.text).catch(() => {});
          }
          await renderSubtitleAt(cues, t, translateOnce, sink);
        }
        // Only advance lastCueKey after a successful render so a failed
        // translate is retried on the next frame instead of stuck silent.
        lastCueKey = key;
      }
    } catch (err) {
      deps.onError?.(err);
    } finally {
      inFlight = false;
      if (!stopped) tick();
    }
  };

  tick();

  return {
    stop() {
      stopped = true;
      if (handle !== null) cancel(handle);
      sink.clear();
      sink.detach();
    },
  };
}
