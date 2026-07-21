import { describe, expect, it } from "vitest";
import {
  mergeRollingWindow,
  splitSentences,
  TRANSCRIPT_MAX_CHARS,
} from "./liveSegmenter";

describe("mergeRollingWindow", () => {
  it("starts a transcript from an empty one", () => {
    expect(mergeRollingWindow("", "Let me pass")).toBe("Let me pass");
  });

  it("keeps the transcript when the window is empty", () => {
    expect(mergeRollingWindow("Let me pass", "")).toBe("Let me pass");
  });

  it("appends only the new suffix when the window extends the line", () => {
    expect(mergeRollingWindow("Let me pass", "Let me pass it to")).toBe(
      "Let me pass it to",
    );
  });

  it("merges via word overlap when the window has slid past the start", () => {
    expect(
      mergeRollingWindow(
        "loud. Let me pass it to Constance",
        "pass it to Constance to tell you",
      ),
    ).toBe("loud. Let me pass it to Constance to tell you");
  });

  it("keeps the transcript unchanged when the window is already contained", () => {
    expect(
      mergeRollingWindow("Let me pass it to Constance", "it to Constance"),
    ).toBe("Let me pass it to Constance");
  });

  it("resets to the window when there is no overlap (ASR correction)", () => {
    // Live ASR rewrote a recent word — appending would duplicate the window.
    expect(
      mergeRollingWindow("we are going their", "we are going there fast"),
    ).toBe("we are going there fast");
  });

  it("normalizes whitespace in the incoming window", () => {
    expect(mergeRollingWindow("a b", "a   b\n c")).toBe("a b c");
  });

  it("caps the transcript length by dropping the oldest text", () => {
    const old = "word ".repeat(600).trim(); // 2999 chars
    const merged = mergeRollingWindow(old, "word brand new tail");
    expect(merged.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS);
    expect(merged.endsWith("brand new tail")).toBe(true);
  });
});

describe("splitSentences", () => {
  it("splits completed sentences from the in-progress tail", () => {
    expect(splitSentences("Hello there. How are")).toEqual({
      complete: ["Hello there."],
      tail: "How are",
    });
  });

  it("returns everything as tail when nothing is terminated", () => {
    expect(splitSentences("the natural flow of thinking")).toEqual({
      complete: [],
      tail: "the natural flow of thinking",
    });
  });

  it("handles multiple sentences and ? ! terminators", () => {
    expect(splitSentences("Really? Yes! Let me pass it")).toEqual({
      complete: ["Really?", "Yes!"],
      tail: "Let me pass it",
    });
  });

  it("treats CJK terminators as sentence ends", () => {
    expect(splitSentences("你好。接下來")).toEqual({
      complete: ["你好。"],
      tail: "接下來",
    });
  });

  it("finalizes an unterminated fragment when a >> speaker switch follows", () => {
    expect(splitSentences("tell you more >> Hello everyone")).toEqual({
      complete: ["tell you more"],
      tail: "Hello everyone",
    });
  });

  it("strips >> from the current speaker's tail", () => {
    expect(
      splitSentences("to spend a month over there. >> That sounds like"),
    ).toEqual({
      complete: ["to spend a month over there."],
      tail: "That sounds like",
    });
  });

  it("returns empty parts for empty input", () => {
    expect(splitSentences("")).toEqual({ complete: [], tail: "" });
  });

  it("does not split decimals or trailing digit-dots", () => {
    expect(splitSentences("GDP grew 3.5 percent this")).toEqual({
      complete: [],
      tail: "GDP grew 3.5 percent this",
    });
    // A digit-dot at the end may still be growing into a decimal.
    expect(splitSentences("GDP grew 3.")).toEqual({
      complete: [],
      tail: "GDP grew 3.",
    });
  });

  it("does not split single-letter abbreviations like U.S.", () => {
    expect(splitSentences("the U.S. economy is strong")).toEqual({
      complete: [],
      tail: "the U.S. economy is strong",
    });
  });

  it("keeps the remainder aligned when the chunk starts with a terminator", () => {
    expect(splitSentences("…so the market dropped. and then")).toEqual({
      // Leading ellipsis is consumed as a punctuation-only fragment; the
      // remainder must stay aligned (no duplicated/garbage tail).
      complete: ["so the market dropped."],
      tail: "and then",
    });
  });

  it("drops punctuation-only fragments instead of emitting them as sentences", () => {
    expect(splitSentences("... hello there. next")).toEqual({
      complete: ["hello there."],
      tail: "next",
    });
  });
});
