import { describe, expect, it } from "vitest";
import { fetchCues, pickAudioLanguage, pickCaptionTrack } from "./captionSource";

const playerResponse = {
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: "https://video.example/timedtext?lang=en&kind=asr",
          languageCode: "en",
          kind: "asr",
        },
        {
          baseUrl: "https://video.example/timedtext?lang=ja",
          languageCode: "ja",
        },
        {
          baseUrl: "https://video.example/timedtext?lang=en",
          languageCode: "en",
        },
      ],
    },
  },
};

describe("pickCaptionTrack", () => {
  it("prefers the requested manual caption track over an ASR track", () => {
    expect(pickCaptionTrack(playerResponse, "en")).toEqual({
      baseUrl: "https://video.example/timedtext?lang=en",
    });
  });

  it("returns null when the player response has no caption tracks", () => {
    expect(pickCaptionTrack({ captions: {} }, "en")).toBeNull();
  });
});

describe("fetchCues", () => {
  it("fetches json3 timedtext and parses it into cues", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return {
        text: async () =>
          JSON.stringify({
            events: [
              {
                tStartMs: 1200,
                dDurationMs: 2300,
                segs: [{ utf8: "Hello" }],
              },
            ],
          }),
      };
    };

    await expect(
      fetchCues("https://video.example/timedtext?lang=en", fetchImpl),
    ).resolves.toEqual([{ start: 1.2, dur: 2.3, text: "Hello" }]);
    expect(urls).toEqual(["https://video.example/timedtext?lang=en&fmt=json3"]);
  });

  it("falls back to legacy XML timedtext when json3 parsing fails", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("fmt=json3") || url.includes("fmt=srv3")) {
        return { text: async () => "not-json" };
      }
      return {
        text: async () =>
          `<transcript><text start="1.5" dur="2">Hello &amp; welcome</text></transcript>`,
      };
    };

    await expect(
      fetchCues("https://video.example/timedtext", fetchImpl),
    ).resolves.toEqual([{ start: 1.5, dur: 2, text: "Hello & welcome" }]);
  });

  it("parses srv3 <p t d> timedtext", async () => {
    const { parseTimedTextSrv3 } = await import("./captionSource");
    expect(
      parseTimedTextSrv3(
        `<timedtext><body><p t="1500" d="2000">Hello &amp; hi</p></body></timedtext>`,
      ),
    ).toEqual([{ start: 1.5, dur: 2, text: "Hello & hi" }]);
  });

  it("skips empty bodies and surfaces a clear error", async () => {
    const fetchImpl = async () => ({
      text: async () => "",
    });
    await expect(
      fetchCues("https://video.example/timedtext", fetchImpl),
    ).rejects.toThrow(/empty body/i);
  });
});

describe("pickAudioLanguage", () => {
  it("reads the default audio track's language from audioTrackId", () => {
    expect(
      pickAudioLanguage({
        captions: {
          playerCaptionsTracklistRenderer: {
            audioTracks: [
              { audioTrackId: "zh-Hant.4", hasDefaultTrack: true },
              { audioTrackId: "en.3" },
            ],
          },
        },
      }),
    ).toBe("zh-Hant");
  });

  it("falls back to the first audio track when none is marked default", () => {
    expect(
      pickAudioLanguage({
        captions: {
          playerCaptionsTracklistRenderer: {
            audioTracks: [{ audioTrackId: "en.3" }],
          },
        },
      }),
    ).toBe("en");
  });

  it("falls back to videoDetails.defaultAudioLanguage", () => {
    expect(
      pickAudioLanguage({ videoDetails: { defaultAudioLanguage: "zh-TW" } }),
    ).toBe("zh-TW");
  });

  it("returns null when no audio-language signal exists", () => {
    expect(pickAudioLanguage(playerResponse)).toBeNull();
    expect(pickAudioLanguage({})).toBeNull();
    expect(pickAudioLanguage(null)).toBeNull();
    expect(
      pickAudioLanguage({
        captions: {
          playerCaptionsTracklistRenderer: { audioTracks: [{}] },
        },
      }),
    ).toBeNull();
  });
});
