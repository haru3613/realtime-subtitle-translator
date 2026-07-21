// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  extractBalancedJsonObject,
  extractVideoIdFromUrl,
  extractYtInitialPlayerResponse,
  findPrimaryVideo,
} from "./youtubePlayer";

describe("extractBalancedJsonObject", () => {
  it("extracts a nested object starting at a brace", () => {
    const src = 'prefix={"a":1,"b":{"c":"}x"}}; tail';
    const start = src.indexOf("{");
    expect(JSON.parse(extractBalancedJsonObject(src, start))).toEqual({
      a: 1,
      b: { c: "}x" },
    });
  });

  it("throws when braces are unbalanced", () => {
    expect(() => extractBalancedJsonObject("{", 0)).toThrow(/unbalanced/i);
  });
});

describe("extractYtInitialPlayerResponse", () => {
  it("returns null when the document has no player payload", () => {
    document.body.innerHTML = "<div></div>";
    expect(extractYtInitialPlayerResponse(document)).toBeNull();
  });

  it("parses ytInitialPlayerResponse from an inline script tag", () => {
    const payload = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ baseUrl: "https://example.test/tt", languageCode: "en" }],
        },
      },
    };
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    const script = document.createElement("script");
    script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify(payload)}; var x = 1;`;
    document.head.append(script);

    expect(extractYtInitialPlayerResponse(document)).toEqual(payload);
  });
});

describe("extractVideoIdFromUrl", () => {
  it("reads v= from watch URLs and returns null otherwise", () => {
    expect(
      extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"),
    ).toBe("dQw4w9WgXcQ");
    expect(extractVideoIdFromUrl("https://www.youtube.com/")).toBeNull();
    expect(extractVideoIdFromUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });
});

describe("findPrimaryVideo", () => {
  it("prefers .html5-main-video when present", () => {
    document.body.innerHTML = `
      <video class="other"></video>
      <video class="html5-main-video" id="main"></video>
    `;
    const v = findPrimaryVideo(document);
    expect(v?.id).toBe("main");
  });

  it("falls back to the first video element", () => {
    document.body.innerHTML = `<video id="only"></video>`;
    expect(findPrimaryVideo(document)?.id).toBe("only");
  });
});
