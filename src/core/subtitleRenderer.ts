/**
 * Pure playback-time subtitle controller (SPEC v0 Mode A). The last
 * gate-verifiable core piece between the caption/pipeline core and the
 * Shadow-DOM overlay (RST-12): at playback time T, pick the active cue,
 * translate its text, and render source + translated through the overlay —
 * or clear the overlay (and skip translation) when no cue is active.
 *
 * Framework- and DOM-free by design: `pickActiveCue` is reused for cue
 * selection (inheriting its half-open `[start, start+dur)` semantics, so an
 * adjacent boundary yields the newer cue), while `translate` and the overlay
 * `sink` are injected. The real content-script clock and YouTube mount stay in
 * the browser shell. `TranslationPipeline.translateCue` satisfies `Translate`
 * and `SubtitleOverlay` satisfies `SubtitleSink`, so this composes the two
 * existing seams without importing either.
 */

import { pickActiveCue, type SubtitleOverlayContent } from "./overlay";
import type { Cue } from "./captions";

/**
 * Injected translation seam: source cue text in, target-language text out.
 * `onPartial` streams accumulated text; `signal` cancels stale requests.
 */
export type Translate = (
  source: string,
  options?: {
    onPartial?: (accumulated: string) => void;
    signal?: AbortSignal;
  },
) => Promise<string>;

/** Minimal overlay seam the renderer drives — `SubtitleOverlay` satisfies it. */
export interface SubtitleSink {
  render(content: SubtitleOverlayContent): void;
  clear(): void;
}

/**
 * Render the subtitle for `currentTime`: translate + render the active cue's
 * source and translated text, or clear the sink when no cue is active (no
 * translate call on an empty tick).
 */
export async function renderSubtitleAt(
  cues: readonly Cue[],
  currentTime: number,
  translate: Translate,
  sink: SubtitleSink,
): Promise<void> {
  const cue = pickActiveCue(cues, currentTime);
  if (cue === null) {
    sink.clear();
    return;
  }
  const translated = await translate(cue.text);
  sink.render({ source: cue.text, translated });
}
