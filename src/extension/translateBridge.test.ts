import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBackgroundTranslate,
  STREAM_IDLE_TIMEOUT_MS,
} from "./translateBridge";
import { DEFAULT_SETTINGS } from "./settings";
import type { RuntimePort } from "./chromeApi";
import {
  CANCEL_TRANSLATE_MESSAGE_TYPE,
  TRANSLATE_MESSAGE_TYPE,
  isStreamStart,
} from "./messages";

const settings = { ...DEFAULT_SETTINGS, apiKey: "sk", setupComplete: true };

function fakeConnect(
  script: (msg: unknown, reply: (event: unknown) => void) => void,
) {
  const connected: string[] = [];
  const connect = (name: string): RuntimePort => {
    connected.push(name);
    let onMessage: ((msg: unknown) => void) | undefined;
    return {
      postMessage: (msg) => {
        queueMicrotask(() => script(msg, (event) => onMessage?.(event)));
      },
      disconnect: () => {},
      onMessage: { addListener: (cb) => (onMessage = cb) },
      onDisconnect: { addListener: () => {} },
    };
  };
  return { connect, connected };
}

afterEach(() => vi.useRealTimers());

describe("createBackgroundTranslate", () => {
  it("disconnects and rejects when the stream goes idle", async () => {
    vi.useFakeTimers();
    let disconnected = false;
    const connect = (): RuntimePort => ({
      postMessage: () => {},
      disconnect: () => {
        disconnected = true;
      },
      onMessage: { addListener: () => {} },
      onDisconnect: { addListener: () => {} },
    });
    const translate = createBackgroundTranslate(settings, {
      sendMessage: async () => {
        throw new Error("unused");
      },
      connect,
    });

    const pending = translate("hung request", { onPartial: () => {} });
    const assertion = expect(pending).rejects.toThrow(/idle timeout/);
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS + 1);
    await assertion;
    expect(disconnected).toBe(true);
  });

  it("translates via the port with partials", async () => {
    const { connect, connected } = fakeConnect((msg, reply) => {
      expect(isStreamStart(msg)).toBe(true);
      const request = (msg as { request: { stream?: boolean } }).request;
      expect(request.stream).toBe(true);
      reply({ delta: "這" });
      reply({ delta: "這句" });
      reply({ done: true, data: { choices: [{ message: { content: "這句" } }] } });
    });
    const translate = createBackgroundTranslate(settings, {
      sendMessage: async () => {
        throw new Error("sendMessage must not be used for streaming");
      },
      connect,
    });

    const partials: string[] = [];
    const out = await translate("hello world", {
      onPartial: (text) => partials.push(text),
    });
    expect(out).toBe("這句");
    expect(partials).toEqual(["這", "這句"]);
    expect(connected).toEqual(["rst.translateStream"]);
  });

  it("rejects when the background reports a stream error", async () => {
    const { connect } = fakeConnect((_msg, reply) => reply({ error: "boom" }));
    const translate = createBackgroundTranslate(settings, {
      sendMessage: async () => {
        throw new Error("unused");
      },
      connect,
    });
    await expect(
      translate("x", { onPartial: () => {} }),
    ).rejects.toThrow("boom");
  });

  it("keeps using sendMessage for non-streaming calls", async () => {
    let sent: unknown;
    const translate = createBackgroundTranslate(settings, {
      sendMessage: async (msg) => {
        sent = msg;
        return {
          ok: true,
          data: { choices: [{ message: { content: "譯文" } }] },
        };
      },
      connect: () => {
        throw new Error("connect must not be used without onPartial");
      },
    });

    const out = await translate("plain call");
    expect(out).toBe("譯文");
    expect(sent).toMatchObject({
      type: TRANSLATE_MESSAGE_TYPE,
      id: expect.any(String),
    });
  });

  it("cancels the matching background request", async () => {
    let finishTranslation: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: unknown) => {
      if (
        message !== null &&
        typeof message === "object" &&
        (message as { type?: string }).type === TRANSLATE_MESSAGE_TYPE
      ) {
        return new Promise((resolve) => {
          finishTranslation = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const translate = createBackgroundTranslate(settings, { sendMessage });
    const controller = new AbortController();

    const pending = translate("hello", { signal: controller.signal });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const request = sendMessage.mock.calls[0][0] as { id?: string };
    controller.abort();

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: CANCEL_TRANSLATE_MESSAGE_TYPE,
        id: request.id,
      }),
    );
    finishTranslation?.({ ok: false, error: "cancelled" });
    await expect(pending).rejects.toThrow("cancelled");
  });
});
