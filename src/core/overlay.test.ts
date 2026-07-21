// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { pickActiveCue, SubtitleOverlay } from "./overlay";
import type { Cue } from "./captions";

const cues: Cue[] = [
  { start: 1, dur: 2, text: "First" },
  { start: 4, dur: 1.5, text: "Second" },
];

describe("pickActiveCue", () => {
  it("returns the cue containing the current playback time", () => {
    expect(pickActiveCue(cues, 1)).toBe(cues[0]);
    expect(pickActiveCue(cues, 4.25)).toBe(cues[1]);
  });

  it("returns null when playback time is outside every cue", () => {
    expect(pickActiveCue(cues, 0.9)).toBeNull();
    expect(pickActiveCue(cues, 5.6)).toBeNull();
  });

  it("treats cue end times as exclusive so adjacent cues do not overlap", () => {
    const adjacent: Cue[] = [
      { start: 1, dur: 2, text: "First" },
      { start: 3, dur: 1, text: "Second" },
    ];

    expect(pickActiveCue(adjacent, 3)).toBe(adjacent[1]);
  });
});

describe("SubtitleOverlay", () => {
  it("renders bilingual subtitle lines inside an attached shadow root", () => {
    const container = document.createElement("div");
    const overlay = new SubtitleOverlay(container);

    overlay.render({
      source: "The rollup is EVM-compatible.",
      translated: "這個 Rollup 相容 EVM。",
    });

    const root = container.firstElementChild?.shadowRoot;
    expect(root?.textContent).toContain(
      "The rollup is EVM-compatible.",
    );
    expect(root?.textContent).toContain("這個 Rollup 相容 EVM。");
  });

  it("ships with bottom-centered, large-type overlay styles", () => {
    const container = document.createElement("div");
    new SubtitleOverlay(container);

    const style = container.firstElementChild?.shadowRoot?.querySelector("style");
    const css = style?.textContent ?? "";
    expect(style).not.toBeNull();
    expect(css).toContain("position: fixed");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("clamp(24px");
    expect(css).toContain('part="translated"');
  });

  it("can clear and detach the rendered subtitle UI", () => {
    const container = document.createElement("div");
    const overlay = new SubtitleOverlay(container);

    overlay.render({ source: "Source", translated: "Translated" });
    overlay.clear();
    const root = container.firstElementChild?.shadowRoot;
    expect(root?.querySelector('[part="source"]')?.textContent).toBe("");
    expect(root?.querySelector('[part="translated"]')?.textContent).toBe("");

    overlay.detach();
    expect(container.childElementCount).toBe(0);
  });
});
