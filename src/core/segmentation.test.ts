import { describe, expect, it } from "vitest";
import { chunkCues, recentContext, type Cue } from "./segmentation";

describe("chunkCues", () => {
  it("merges cues under the duration cap without sentence endings", () => {
    const cues: Cue[] = [
      { text: "Raw", start: 0, end: 1.5 },
      { text: "caption", start: 1.5, end: 3 },
      { text: "fragments", start: 3, end: 4 },
    ];

    expect(chunkCues(cues, { maxChunkSeconds: 8 })).toEqual([
      { text: "Raw caption fragments", start: 0, end: 4 },
    ]);
  });

  it("starts a new chunk after the duration cap or a sentence-ending cue", () => {
    const cues: Cue[] = [
      { text: "One", start: 0, end: 2 },
      { text: "small", start: 2, end: 4 },
      { text: "chunk", start: 4, end: 6 },
      { text: "Next", start: 6, end: 7 },
      { text: "sentence.", start: 7, end: 8 },
      { text: "Tail", start: 8, end: 9 },
    ];

    expect(chunkCues(cues, { maxChunkSeconds: 5 })).toEqual([
      { text: "One small chunk", start: 0, end: 6 },
      { text: "Next sentence.", start: 6, end: 8 },
      { text: "Tail", start: 8, end: 9 },
    ]);
  });

  it("returns an empty list for empty input and preserves every cue text once", () => {
    expect(chunkCues([])).toEqual([]);

    const chunks = chunkCues(
      [
        { text: "Alpha", start: 0, end: 1 },
        { text: "Beta", start: 1, end: 2 },
        { text: "Gamma!", start: 2, end: 3 },
        { text: "Delta", start: 3, end: 4 },
      ],
      { maxChunkSeconds: 8 },
    );

    expect(chunks.map((chunk) => chunk.text).join(" ")).toBe(
      "Alpha Beta Gamma! Delta",
    );
  });
});

describe("recentContext", () => {
  it("returns the last n items, defaulting to three", () => {
    expect(recentContext(["one", "two", "three", "four"])).toEqual([
      "two",
      "three",
      "four",
    ]);
    expect(recentContext(["one", "two", "three", "four"], 2)).toEqual([
      "three",
      "four",
    ]);
  });

  it("returns all items when history is shorter than the requested context", () => {
    expect(recentContext(["one", "two"], 3)).toEqual(["one", "two"]);
  });
});
