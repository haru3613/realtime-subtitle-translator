// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  readYoutubeCaptionText,
  startLiveCaptionSession,
} from "./liveCaptions";
import type { ExtensionSettings } from "./settings";

const settings: ExtensionSettings = {
  providerId: "openai",
  endpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
  targetLanguage: "Traditional Chinese",
  sourceLang: "en",
  enabled: true,
  bilingual: false,
  setupComplete: true,
};

describe("readYoutubeCaptionText", () => {
  it("joins .ytp-caption-segment nodes", () => {
    document.body.innerHTML = `
      <div class="ytp-caption-window-container">
        <span class="ytp-caption-segment">Hello</span>
        <span class="ytp-caption-segment">world</span>
      </div>
    `;
    expect(readYoutubeCaptionText(document)).toBe("Hello world");
  });

  it("returns empty when no caption UI is present", () => {
    document.body.innerHTML = `<div class="player"></div>`;
    expect(readYoutubeCaptionText(document)).toBe("");
  });
});

type TranslateMock = ReturnType<typeof vi.fn> &
  ((
    source: string,
    options?: { onPartial?: (t: string) => void; signal?: AbortSignal },
  ) => Promise<string>);

function setup(opts?: {
  translate?: TranslateMock;
  pollMs?: number;
  onSourceIsTarget?: () => void;
  hideNative?: boolean;
}) {
  document.body.innerHTML = `<div class="html5-video-player"></div>`;
  const sink = { render: vi.fn(), clear: vi.fn(), detach: vi.fn() };
  const translate =
    opts?.translate ??
    (vi.fn(async (s: string) => `譯:${s}`) as TranslateMock);

  const session = startLiveCaptionSession({
    settings,
    createSink: () => sink,
    createTranslate: () => translate,
    observeRoot: document.body,
    hideNative: opts?.hideNative ?? false,
    onSourceIsTarget: opts?.onSourceIsTarget,
    pollMs: opts?.pollMs ?? 10_000, // rely on MutationObserver by default
  });

  const player = document.querySelector(".html5-video-player")!;
  const cap = document.createElement("div");
  cap.className = "ytp-caption-window-container";
  const seg = document.createElement("span");
  seg.className = "ytp-caption-segment";
  cap.append(seg);
  player.append(cap);

  const setCaption = (text: string) => {
    seg.textContent = text;
  };

  return { sink, translate, session, setCaption };
}

describe("startLiveCaptionSession", () => {
  it("translates a completed sentence once and renders it", async () => {
    const { sink, translate, session, setCaption } = setup();
    setCaption("Hello there everyone. How are");

    await vi.waitFor(() => {
      expect(translate).toHaveBeenCalledWith("Hello there everyone.");
      expect(sink.render).toHaveBeenCalledWith({
        source: "Hello there everyone. How are",
        translated: "譯:Hello there everyone.",
      });
    });
    // Same sentence appearing again in later window snapshots → no retranslate.
    setCaption("Hello there everyone. How are you");
    await vi.waitFor(() => {
      expect(readYoutubeCaptionText(document)).toBe(
        "Hello there everyone. How are you",
      );
    });
    const sentenceCalls = translate.mock.calls.filter(
      (c: unknown[]) => c[0] === "Hello there everyone.",
    );
    expect(sentenceCalls).toHaveLength(1);
    session.stop();
  });

  it("keeps the previous translation visible when a new line arrives (no clear)", async () => {
    const { sink, session, setCaption } = setup();
    setCaption("First full sentence is done.");
    await vi.waitFor(() => {
      expect(sink.render).toHaveBeenCalledWith({
        source: "First full sentence is done.",
        translated: "譯:First full sentence is done.",
      });
    });

    setCaption("First full sentence is done. And now");
    await vi.waitFor(() => {
      expect(readYoutubeCaptionText(document)).toBe(
        "First full sentence is done. And now",
      );
    });
    expect(sink.clear).not.toHaveBeenCalled();
    session.stop();
  });

  it("streams tail partials into the overlay as they arrive", async () => {
    const partialEmitters = new Map<string, (t: string) => void>();
    const resolvers = new Map<string, (t: string) => void>();
    const translate = vi.fn(
      (
        source: string,
        options?: { onPartial?: (t: string) => void },
      ) =>
        new Promise<string>((resolve) => {
          if (options?.onPartial) {
            partialEmitters.set(source, options.onPartial);
          }
          resolvers.set(source, resolve);
        }),
    ) as TranslateMock;

    const { sink, session, setCaption } = setup({ translate });
    setCaption("the natural flow of thinking");

    await vi.waitFor(() => {
      expect(translate).toHaveBeenCalledWith(
        "the natural flow of thinking",
        expect.objectContaining({ onPartial: expect.any(Function) }),
      );
    });

    partialEmitters.get("the natural flow of thinking")!("思考的");
    await vi.waitFor(() => {
      expect(sink.render).toHaveBeenCalledWith({
        source: "the natural flow of thinking",
        translated: "思考的",
      });
    });

    resolvers.get("the natural flow of thinking")!("思考的自然流程");
    await vi.waitFor(() => {
      expect(sink.render).toHaveBeenCalledWith({
        source: "the natural flow of thinking",
        translated: "思考的自然流程",
      });
    });
    session.stop();
  });

  it("does not fire a tail request for very short fragments", async () => {
    const { translate, session, setCaption } = setup();
    setCaption("hello");
    await new Promise((r) => setTimeout(r, 20));
    expect(translate).not.toHaveBeenCalled();
    session.stop();
  });

  it("translates only the new sentence when the window slides", async () => {
    const { translate, session, setCaption } = setup();
    setCaption("An opening sentence right here.");
    await vi.waitFor(() => {
      expect(translate).toHaveBeenCalledWith("An opening sentence right here.");
    });

    // Window slid: start of old sentence gone, new sentence completed.
    setCaption("right here. A second sentence appears now.");
    await vi.waitFor(() => {
      expect(translate).toHaveBeenCalledWith("A second sentence appears now.");
    });
    // The old sentence was NOT retranslated as part of the slid window.
    const sources = translate.mock.calls.map((c: unknown[]) => c[0]);
    expect(sources).toEqual([
      "An opening sentence right here.",
      "A second sentence appears now.",
    ]);
    session.stop();
  });

  it("clears the overlay and resets when captions disappear", async () => {
    const { sink, translate, session, setCaption } = setup();
    setCaption("A finished sentence right here.");
    await vi.waitFor(() => expect(sink.render).toHaveBeenCalled());

    setCaption("");
    await vi.waitFor(() => expect(sink.clear).toHaveBeenCalled());

    // New utterance after silence starts a fresh transcript (no merge with old).
    setCaption("Something completely different now.");
    await vi.waitFor(() => {
      expect(translate).toHaveBeenCalledWith("Something completely different now.");
    });
    session.stop();
  });

  it("retranslates a tail that grew while a request was in flight, even if the window then stays static", async () => {
    const resolvers = new Map<string, (t: string) => void>();
    const translate = vi.fn(
      (source: string) =>
        new Promise<string>((resolve) => resolvers.set(source, resolve)),
    ) as TranslateMock;
    const { session, setCaption } = setup({ translate });

    setCaption("the natural flow of thinking");
    await vi.waitFor(() =>
      expect(translate).toHaveBeenCalledWith(
        "the natural flow of thinking",
        expect.objectContaining({ onPartial: expect.any(Function) }),
      ),
    );

    // Tail grows while the request is in flight; window then never changes.
    setCaption("the natural flow of thinking about things");
    await vi.waitFor(() =>
      expect(readYoutubeCaptionText(document)).toBe(
        "the natural flow of thinking about things",
      ),
    );
    resolvers.get("the natural flow of thinking")!("思考的自然流程");

    await vi.waitFor(() =>
      expect(translate).toHaveBeenCalledWith(
        "the natural flow of thinking about things",
        expect.objectContaining({ onPartial: expect.any(Function) }),
      ),
    );
    session.stop();
  });

  it("retries a failed sentence translation on a later poll tick", async () => {
    let calls = 0;
    const translate = vi.fn(async (s: string) => {
      calls += 1;
      if (calls === 1) throw new Error("429");
      return `譯:${s}`;
    }) as TranslateMock;
    const { sink, session, setCaption } = setup({ translate, pollMs: 20 });

    setCaption("A complete sentence right here.");
    await vi.waitFor(() => {
      expect(sink.render).toHaveBeenCalledWith({
        source: "A complete sentence right here.",
        translated: "譯:A complete sentence right here.",
      });
    });
    expect(
      translate.mock.calls.filter(
        (c: unknown[]) => c[0] === "A complete sentence right here.",
      ).length,
    ).toBeGreaterThanOrEqual(2);
    session.stop();
  });

  it("drops a stale tail translation that resolves after CC vanished", async () => {
    const resolvers = new Map<string, (t: string) => void>();
    const translate = vi.fn(
      (source: string) =>
        new Promise<string>((resolve) => resolvers.set(source, resolve)),
    ) as TranslateMock;
    const { sink, session, setCaption } = setup({ translate });

    setCaption("And the market is going");
    await vi.waitFor(() =>
      expect(translate).toHaveBeenCalledWith(
        "And the market is going",
        expect.objectContaining({ onPartial: expect.any(Function) }),
      ),
    );

    setCaption(""); // utterance ended
    await vi.waitFor(() => expect(sink.clear).toHaveBeenCalled());

    setCaption("And the market never sleeps ok");
    await vi.waitFor(() =>
      expect(translate).toHaveBeenCalledWith(
        "And the market never sleeps ok",
        expect.objectContaining({ onPartial: expect.any(Function) }),
      ),
    );

    // Old utterance's translation resolves late — must NOT render under the
    // new source line even though both tails share the "And the" prefix.
    sink.render.mockClear();
    resolvers.get("And the market is going")!("市場正在走");
    await new Promise((r) => setTimeout(r, 20));
    expect(sink.render).not.toHaveBeenCalled();

    resolvers.get("And the market never sleeps ok")!("市場永不眠");
    await vi.waitFor(() =>
      expect(sink.render).toHaveBeenCalledWith({
        source: "And the market never sleeps ok",
        translated: "市場永不眠",
      }),
    );
    session.stop();
  });

  it("stop() detaches the sink", async () => {
    const { sink, session } = setup();
    session.stop();
    expect(sink.detach).toHaveBeenCalled();
  });

  it("skips translation and self-stops when captions are already Chinese", async () => {
    const onSourceIsTarget = vi.fn();
    const { sink, translate, setCaption } = setup({ onSourceIsTarget });
    setCaption("大家好,歡迎回到我們的頻道。");

    await vi.waitFor(() => {
      expect(onSourceIsTarget).toHaveBeenCalledTimes(1);
    });
    expect(translate).not.toHaveBeenCalled();
    expect(sink.detach).toHaveBeenCalled();
  });

  it("removes the hide-native style when Chinese is detected", async () => {
    const onSourceIsTarget = vi.fn();
    const { setCaption } = setup({ onSourceIsTarget, hideNative: true });
    expect(
      document.querySelector("style[data-rst-hide-native-cc]"),
    ).not.toBeNull();

    setCaption("這支影片本來就有中文字幕了。");
    await vi.waitFor(() => {
      expect(onSourceIsTarget).toHaveBeenCalled();
    });
    expect(
      document.querySelector("style[data-rst-hide-native-cc]"),
    ).toBeNull();
  });

  it("keeps translating English after the language decision is made", async () => {
    const onSourceIsTarget = vi.fn();
    const { translate, sink, setCaption } = setup({ onSourceIsTarget });
    // > LANG_DECIDE_CHARS of English locks the decision to "not Chinese".
    setCaption(
      "This is a fairly long English caption that keeps going and going " +
        "until the sampler has definitely seen more than eighty characters.",
    );
    await vi.waitFor(() => {
      expect(translate).toHaveBeenCalled();
    });

    // A later Chinese quote must NOT kill the session.
    setCaption("然後他用中文說了一整句話出來讓大家都嚇了一跳。");
    await new Promise((r) => setTimeout(r, 50));
    expect(onSourceIsTarget).not.toHaveBeenCalled();
    expect(sink.detach).not.toHaveBeenCalled();
  });
});
