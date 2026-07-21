import { describe, expect, it } from "vitest";
import {
  attachTranslateStreamPort,
  providerConfigError,
  type StreamTransportFactory,
} from "./streamBridge";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "./settings";
import type { RuntimePort } from "./chromeApi";

const settings: ExtensionSettings = {
  ...DEFAULT_SETTINGS,
  apiKey: "sk-test",
  endpoint: "https://api.example.com/v1/chat/completions",
  setupComplete: true,
};

const request = {
  model: "gpt-4o-mini",
  messages: [{ role: "user" as const, content: "hi" }],
  stream: true,
};

function fakePort() {
  const posted: unknown[] = [];
  let onMessage: ((msg: unknown) => void) | undefined;
  let onDisconnect: (() => void) | undefined;
  const port: RuntimePort = {
    postMessage: (msg) => posted.push(msg),
    disconnect: () => {},
    onMessage: { addListener: (cb) => (onMessage = cb) },
    onDisconnect: { addListener: (cb) => (onDisconnect = cb) },
  };
  return {
    port,
    posted,
    send: (msg: unknown) => onMessage?.(msg),
    dropConnection: () => onDisconnect?.(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("providerConfigError", () => {
  it("flags missing key, missing endpoint, and non-HTTPS endpoints", () => {
    expect(providerConfigError(settings)).toBeNull();
    expect(providerConfigError({ ...settings, apiKey: " " })).toMatch(/API key/);
    expect(providerConfigError({ ...settings, endpoint: " " })).toMatch(/API key/);
    expect(
      providerConfigError({ ...settings, endpoint: "http://evil.example.com" }),
    ).toMatch(/HTTPS/);
  });
});

describe("attachTranslateStreamPort", () => {
  it("streams deltas then done for a valid request", async () => {
    const { port, posted, send } = fakePort();
    const transport: StreamTransportFactory = (cfg) => {
      expect(cfg.apiKey).toBe("sk-test");
      return async (req, onDelta) => {
        expect(req).toEqual(request);
        onDelta("這");
        onDelta("這句");
        return { choices: [{ message: { content: "這句" } }] };
      };
    };
    attachTranslateStreamPort(port, {
      loadSettings: async () => settings,
      createTransport: transport,
    });

    send({ request });
    await flush();

    expect(posted).toEqual([
      { delta: "這" },
      { delta: "這句" },
      { done: true, data: { choices: [{ message: { content: "這句" } }] } },
    ]);
  });

  it("posts an error for unconfigured settings", async () => {
    const { port, posted, send } = fakePort();
    attachTranslateStreamPort(port, {
      loadSettings: async () => ({ ...settings, apiKey: "" }),
      createTransport: () => async () => ({}),
    });

    send({ request });
    await flush();

    expect(posted).toHaveLength(1);
    expect(posted[0]).toHaveProperty("error");
  });

  it("posts an error when the transport throws", async () => {
    const { port, posted, send } = fakePort();
    attachTranslateStreamPort(port, {
      loadSettings: async () => settings,
      createTransport: () => async () => {
        throw new Error("provider exploded");
      },
    });

    send({ request });
    await flush();

    expect(posted).toEqual([{ error: "provider exploded" }]);
  });

  it("ignores malformed start messages", async () => {
    const { port, posted, send } = fakePort();
    attachTranslateStreamPort(port, {
      loadSettings: async () => settings,
      createTransport: () => async () => ({}),
    });

    send({ nonsense: true });
    await flush();
    expect(posted).toEqual([]);
  });

  it("stops posting and aborts the provider stream after the port disconnects", async () => {
    const { port, posted, send, dropConnection } = fakePort();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let seenSignal: AbortSignal | undefined;
    attachTranslateStreamPort(port, {
      loadSettings: async () => settings,
      createTransport: (cfg) => async (_req, onDelta) => {
        seenSignal = cfg.signal;
        onDelta("early");
        await gate;
        onDelta("late");
        return { choices: [{ message: { content: "late" } }] };
      },
    });

    send({ request });
    await flush();
    expect(seenSignal?.aborted).toBe(false);
    dropConnection();
    expect(seenSignal?.aborted).toBe(true);
    release();
    await flush();

    expect(posted).toEqual([{ delta: "early" }]);
  });
});
