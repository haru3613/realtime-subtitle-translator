import { describe, expect, it, vi } from "vitest";
import { renderSubtitleAt } from "./subtitleRenderer";
import type { Cue } from "./captions";

const cues: Cue[] = [
  { start: 1, dur: 2, text: "First" },
  { start: 4, dur: 1.5, text: "Second" },
];

function makeSink() {
  return { render: vi.fn(), clear: vi.fn() };
}

describe("renderSubtitleAt", () => {
  it("renders both source and translated text for the active cue", async () => {
    const sink = makeSink();
    const translate = vi.fn(async (source: string) => `翻譯:${source}`);

    await renderSubtitleAt(cues, 4.25, translate, sink);

    expect(translate).toHaveBeenCalledWith("Second");
    expect(sink.render).toHaveBeenCalledWith({
      source: "Second",
      translated: "翻譯:Second",
    });
    expect(sink.clear).not.toHaveBeenCalled();
  });

  it("clears the overlay and skips translation when no cue is active", async () => {
    const sink = makeSink();
    const translate = vi.fn(async (source: string) => source);

    await renderSubtitleAt(cues, 5.6, translate, sink);

    expect(sink.clear).toHaveBeenCalledTimes(1);
    expect(translate).not.toHaveBeenCalled();
    expect(sink.render).not.toHaveBeenCalled();
  });

  it("uses the newer cue at an adjacent boundary (half-open cue semantics)", async () => {
    const adjacent: Cue[] = [
      { start: 1, dur: 2, text: "First" },
      { start: 3, dur: 1, text: "Second" },
    ];
    const sink = makeSink();
    const translate = vi.fn(async (source: string) => `t:${source}`);

    await renderSubtitleAt(adjacent, 3, translate, sink);

    expect(translate).toHaveBeenCalledWith("Second");
    expect(sink.render).toHaveBeenCalledWith({
      source: "Second",
      translated: "t:Second",
    });
  });
});
