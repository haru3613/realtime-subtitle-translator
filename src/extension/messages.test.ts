import { describe, expect, it } from "vitest";
import {
  CANCEL_TRANSLATE_MESSAGE_TYPE,
  FETCH_TEXT_MESSAGE_TYPE,
  TRANSLATE_MESSAGE_TYPE,
  isCancelTranslateRequest,
  isFetchTextRequest,
  isFetchTextResponseOk,
  isStreamStart,
  isTranslateRequest,
  isTranslateResponseOk,
  parseStreamEvent,
  type StreamEventMessage,
  type TranslateRequestMessage,
} from "./messages";

describe("message guards", () => {
  it("accepts a well-formed translate request", () => {
    const msg: TranslateRequestMessage = {
      type: TRANSLATE_MESSAGE_TYPE,
      id: "request-1",
      request: {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
        ],
      },
    };
    expect(isTranslateRequest(msg)).toBe(true);
    expect(
      isTranslateRequest({ type: TRANSLATE_MESSAGE_TYPE, request: msg.request }),
    ).toBe(false);
    expect(isTranslateRequest({ type: "nope" })).toBe(false);
    expect(isTranslateRequest(null)).toBe(false);
  });

  it("distinguishes ok vs error translate responses", () => {
    expect(isTranslateResponseOk({ ok: true, data: { choices: [] } })).toBe(
      true,
    );
    expect(isTranslateResponseOk({ ok: false, error: "boom" })).toBe(false);
    expect(isTranslateResponseOk(null)).toBe(false);
  });

  it("accepts cancellation only with a request id", () => {
    expect(
      isCancelTranslateRequest({
        type: CANCEL_TRANSLATE_MESSAGE_TYPE,
        id: "request-1",
      }),
    ).toBe(true);
    expect(
      isCancelTranslateRequest({ type: CANCEL_TRANSLATE_MESSAGE_TYPE }),
    ).toBe(false);
  });

  it("accepts fetch-text request/response shapes", () => {
    expect(
      isFetchTextRequest({
        type: FETCH_TEXT_MESSAGE_TYPE,
        url: "https://www.youtube.com/api/timedtext?v=1",
      }),
    ).toBe(true);
    expect(isFetchTextRequest({ type: FETCH_TEXT_MESSAGE_TYPE })).toBe(false);
    expect(isFetchTextResponseOk({ ok: true, text: "body" })).toBe(true);
    expect(isFetchTextResponseOk({ ok: false, error: "x" })).toBe(false);
  });

  it("accepts a stream-start port message with a valid request", () => {
    const request = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    expect(isStreamStart({ request })).toBe(true);
    expect(isStreamStart({ request: { model: 1 } })).toBe(false);
    expect(isStreamStart({})).toBe(false);
    expect(isStreamStart(null)).toBe(false);
  });

  it("parses stream events by discriminator", () => {
    const delta: StreamEventMessage = { delta: "這" };
    const done: StreamEventMessage = { done: true, data: { choices: [] } };
    const error: StreamEventMessage = { error: "boom" };
    expect(parseStreamEvent(delta)).toEqual({ kind: "delta", delta: "這" });
    expect(parseStreamEvent(done)).toEqual({
      kind: "done",
      data: { choices: [] },
    });
    expect(parseStreamEvent(error)).toEqual({ kind: "error", error: "boom" });
    expect(parseStreamEvent({ nonsense: 1 })).toBeNull();
    expect(parseStreamEvent(null)).toBeNull();
  });
});
