import { describe, expect, it } from "vitest";
import { isChineseLangCode, isMostlyChinese } from "./languageGuess";

describe("isMostlyChinese", () => {
  it("detects Traditional Chinese captions", () => {
    expect(isMostlyChinese("大家好,歡迎回到我們的頻道")).toBe(true);
  });

  it("detects Simplified Chinese captions", () => {
    expect(isMostlyChinese("欢迎收看今天的节目内容")).toBe(true);
  });

  it("detects Chinese with embedded English tech terms", () => {
    // Han 7 / letters 20 ≈ 0.35 — must clear the 0.3 threshold.
    expect(isMostlyChinese("我們今天來聊 Rollup 跟 zk proof")).toBe(true);
  });

  it("rejects English captions", () => {
    expect(isMostlyChinese("Welcome back to the channel everyone")).toBe(false);
  });

  it("rejects English with a short Chinese quote", () => {
    // Han 2 / letters 12 ≈ 0.17 — must stay below threshold.
    expect(isMostlyChinese("and he said 你好 to everyone")).toBe(false);
  });

  it("rejects Japanese captions despite kanji (kana guard)", () => {
    expect(isMostlyChinese("今日は東京タワーへ行きます")).toBe(false);
  });

  it("rejects Korean captions", () => {
    expect(isMostlyChinese("오늘은 서울에 갑니다")).toBe(false);
  });

  it("stays false on short or letterless samples", () => {
    expect(isMostlyChinese("好的")).toBe(false); // < 4 letters: undecided
    expect(isMostlyChinese("123 !!!")).toBe(false);
    expect(isMostlyChinese("")).toBe(false);
  });
});

describe("isChineseLangCode", () => {
  it("matches Chinese language codes of any region", () => {
    expect(isChineseLangCode("zh")).toBe(true);
    expect(isChineseLangCode("zh-Hant")).toBe(true);
    expect(isChineseLangCode("zh-TW")).toBe(true);
    expect(isChineseLangCode("ZH-CN")).toBe(true);
  });

  it("rejects non-Chinese codes", () => {
    expect(isChineseLangCode("en")).toBe(false);
    expect(isChineseLangCode("ja")).toBe(false);
    expect(isChineseLangCode("und")).toBe(false);
    expect(isChineseLangCode("")).toBe(false);
  });
});
