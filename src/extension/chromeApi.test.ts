import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getExtensionApi,
  getStorageLocal,
  runtimeSendMessage,
  storageGet,
  storageSet,
} from "./chromeApi";

describe("chromeApi resolution", () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const originalBrowser = (globalThis as { browser?: unknown }).browser;

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
    (globalThis as { browser?: unknown }).browser = originalBrowser;
    vi.restoreAllMocks();
  });

  it("prefers chrome.storage when browser is a partial stub with runtime.id", async () => {
    const get = vi.fn(async () => ({ "rst.settings": { apiKey: "x" } }));
    const set = vi.fn(async () => undefined);
    (globalThis as { browser?: unknown }).browser = {
      runtime: { id: "fake-ext-id", sendMessage: vi.fn() },
      // intentionally NO storage — the bug we hit in production
    };
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { id: "real", sendMessage: vi.fn(async () => ({ ok: true })) },
      storage: {
        local: { get, set },
        onChanged: { addListener: vi.fn() },
      },
    };

    expect(getStorageLocal()).toBeDefined();
    await expect(storageGet("rst.settings")).resolves.toEqual({
      "rst.settings": { apiKey: "x" },
    });
    expect(get).toHaveBeenCalledWith("rst.settings");

    await storageSet({ "rst.settings": { apiKey: "y" } });
    expect(set).toHaveBeenCalled();

    await expect(runtimeSendMessage({ type: "ping" })).resolves.toEqual({
      ok: true,
    });
    expect(getExtensionApi().storage.local).toBeDefined();
  });

  it("throws a clear error when neither API has storage", () => {
    (globalThis as { chrome?: unknown }).chrome = undefined;
    (globalThis as { browser?: unknown }).browser = {
      runtime: { id: "only-runtime" },
    };
    expect(() => getStorageLocal()).toThrow(/storage\.local unavailable/i);
  });
});
