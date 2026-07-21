// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Cue } from "../core/captions";
import {
  SourceIsTargetError,
  startCaptionSession,
  type CaptionSessionDeps,
} from "./session";
import type { ExtensionSettings } from "./settings";

const settings: ExtensionSettings = {
  providerId: "openai",
  endpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
  targetLanguage: "Traditional Chinese",
  sourceLang: "en",
  enabled: true,
  bilingual: true,
  setupComplete: true,
};

function makeVideo(currentTime = 0.5): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: (v: number) => {
      currentTime = v;
    },
  });
  document.body.append(video);
  return video;
}

describe("startCaptionSession", () => {
  it("prefetches the next cue without rendering it early", async () => {
    const cues: Cue[] = [
      { start: 0, dur: 2, text: "first" },
      { start: 2, dur: 2, text: "second" },
      { start: 4, dur: 2, text: "third" },
    ];
    const sink = {
      render: vi.fn(),
      clear: vi.fn(),
      detach: vi.fn(),
    };
    const translate = vi.fn(async (s: string) => `譯:${s}`);
    let currentTime = 0.5;
    let scheduled = () => {};

    const session = await startCaptionSession({
      settings,
      video: makeVideo(),
      loadCues: async () => cues,
      createSink: () => sink,
      createTranslate: () => translate,
      now: () => currentTime,
      schedule: (fn) => {
        scheduled = fn;
        return 1;
      },
    });

    await scheduled();
    expect(translate).toHaveBeenCalledTimes(2);
    expect(translate).toHaveBeenNthCalledWith(1, "first");
    expect(translate).toHaveBeenNthCalledWith(2, "second");
    expect(sink.render).toHaveBeenCalledTimes(1);
    expect(sink.render).toHaveBeenLastCalledWith({
      source: "first",
      translated: "譯:first",
    });

    currentTime = 2.5;
    await scheduled();
    expect(translate).toHaveBeenCalledTimes(3);
    expect(translate).toHaveBeenNthCalledWith(3, "third");
    expect(sink.render).toHaveBeenLastCalledWith({
      source: "second",
      translated: "譯:second",
    });

    session.stop();
  });

  it("loads cues, renders active cue translation, and stops cleanly", async () => {
    const cues: Cue[] = [{ start: 0, dur: 2, text: "hello world" }];
    const sink = {
      render: vi.fn(),
      clear: vi.fn(),
      detach: vi.fn(),
    };
    const translate = vi.fn(async (s: string) => `譯:${s}`);
    const deps: CaptionSessionDeps = {
      settings,
      video: makeVideo(0.5),
      loadCues: vi.fn(async () => cues),
      createSink: () => sink,
      createTranslate: () => translate,
      now: () => 0.5,
      schedule: (() => {
        let scheduled = false;
        return (fn: () => void) => {
          // One tick only — infinite microtask loops starve vitest.
          if (scheduled) return 1;
          scheduled = true;
          queueMicrotask(() => fn());
          return 1;
        };
      })(),
      cancel: vi.fn(),
    };

    const session = await startCaptionSession(deps);
    // allow the scheduled tick + async translate
    await vi.waitFor(() => {
      expect(sink.render).toHaveBeenCalled();
    });
    expect(deps.loadCues).toHaveBeenCalledOnce();
    expect(translate).toHaveBeenCalledWith("hello world");
    expect(sink.render).toHaveBeenCalledWith({
      source: "hello world",
      translated: "譯:hello world",
    });

    session.stop();
    expect(deps.cancel).toHaveBeenCalled();
    expect(sink.detach).toHaveBeenCalled();
  });

  it("throws when loadCues returns empty", async () => {
    const deps: CaptionSessionDeps = {
      settings,
      video: makeVideo(),
      loadCues: vi.fn(async () => []),
      createSink: () => ({
        render: vi.fn(),
        clear: vi.fn(),
        detach: vi.fn(),
      }),
      createTranslate: () => vi.fn(async (s) => s),
      now: () => 0,
      schedule: (fn) => {
        fn();
        return 1;
      },
      cancel: vi.fn(),
    };
    await expect(startCaptionSession(deps)).rejects.toThrow(/no captions/i);
  });

  it("throws SourceIsTargetError for Chinese cues without translating", async () => {
    const cues: Cue[] = [
      { start: 0, dur: 2, text: "大家好" },
      { start: 2, dur: 2, text: "歡迎回到我們的頻道" },
    ];
    const sink = { render: vi.fn(), clear: vi.fn(), detach: vi.fn() };
    const translate = vi.fn(async (s: string) => `譯:${s}`);

    await expect(
      startCaptionSession({
        settings,
        video: makeVideo(),
        loadCues: async () => cues,
        createSink: () => sink,
        createTranslate: () => translate,
      }),
    ).rejects.toBeInstanceOf(SourceIsTargetError);

    expect(translate).not.toHaveBeenCalled();
    expect(sink.detach).not.toHaveBeenCalled(); // sink was never created
  });
});
