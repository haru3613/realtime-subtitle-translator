import { describe, expect, it } from "vitest";
import {
  fetchTextViaMainWorld,
  type BridgePort,
} from "./loadYoutubeCues";

function memoryPort(): BridgePort & { handlers: Set<(msg: unknown) => void> } {
  const handlers = new Set<(msg: unknown) => void>();
  return {
    handlers,
    post(msg) {
      // Fan-out to current subscribers (sync, like a reliable bus).
      for (const h of [...handlers]) h(msg);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

describe("fetchTextViaMainWorld", () => {
  it("pairs request id and returns text from MAIN", async () => {
    const port = memoryPort();
    let requestId: string | null = null;

    port.subscribe((data) => {
      const msg = data as {
        source?: string;
        type?: string;
        id?: string;
      };
      if (msg.source !== "rst-isolated" || msg.type !== "fetch-text") return;
      requestId = msg.id ?? null;
      port.post({
        source: "rst-main",
        type: "fetch-text-result",
        id: msg.id,
        ok: true,
        text: "cue-body",
      });
    });

    await expect(
      fetchTextViaMainWorld("https://www.youtube.com/api/timedtext?v=1", 2000, port),
    ).resolves.toBe("cue-body");
    expect(requestId).toEqual(expect.stringMatching(/^ft-/));
  });

  it("rejects on MAIN error result", async () => {
    const port = memoryPort();
    port.subscribe((data) => {
      const msg = data as { source?: string; type?: string; id?: string };
      if (msg.source !== "rst-isolated" || msg.type !== "fetch-text") return;
      port.post({
        source: "rst-main",
        type: "fetch-text-result",
        id: msg.id,
        ok: false,
        error: "HTTP 403",
      });
    });

    await expect(
      fetchTextViaMainWorld("https://example.test/x", 2000, port),
    ).rejects.toThrow(/HTTP 403/);
  });
});
