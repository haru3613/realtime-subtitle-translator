/**
 * Background side of the streaming translation port (SPEC §7.2 / §10 latency
 * path). One port = one `stream: true` request: validate settings, run the
 * streaming transport, forward accumulated deltas, close with done/error.
 * Kept out of `entrypoints/background.ts` so vitest can drive it with a fake
 * port and transport.
 */

import {
  streamingHttpTransport,
  type HttpTransportConfig,
} from "../core/transport";
import type { OpenAICompatibleRequest } from "../core/provider";
import type { RuntimePort } from "./chromeApi";
import { isStreamStart, type StreamEventMessage } from "./messages";
import { originPatternFromEndpoint } from "./hostPermission";
import type { ExtensionSettings } from "./settings";

/** Shared config gate for both the sendMessage and the port translate paths. */
export function providerConfigError(settings: ExtensionSettings): string | null {
  if (!settings.apiKey.trim() || !settings.endpoint.trim()) {
    return "尚未設定 API key — 請打開擴充功能選項完成設定精靈";
  }
  if (!originPatternFromEndpoint(settings.endpoint)) {
    return "Endpoint must use HTTPS (plain HTTP is allowed only for localhost).";
  }
  return null;
}

export type StreamTransportFactory = (
  config: HttpTransportConfig,
) => (
  req: OpenAICompatibleRequest,
  onDelta: (accumulated: string) => void,
) => Promise<unknown>;

export interface StreamBridgeDeps {
  loadSettings: () => Promise<ExtensionSettings>;
  /** Injectable for tests; defaults to the real SSE transport. */
  createTransport?: StreamTransportFactory;
}

export function attachTranslateStreamPort(
  port: RuntimePort,
  deps: StreamBridgeDeps,
): void {
  const createTransport = deps.createTransport ?? streamingHttpTransport;
  const abort = new AbortController();
  let disconnected = false;
  let started = false;

  port.onDisconnect.addListener(() => {
    disconnected = true;
    // Stop the provider stream too — nobody is listening anymore.
    abort.abort();
  });

  const post = (msg: StreamEventMessage) => {
    if (disconnected) return;
    try {
      port.postMessage(msg);
    } catch {
      disconnected = true; // port died between events; drop the rest
    }
  };

  port.onMessage.addListener((msg) => {
    if (!isStreamStart(msg) || started) return;
    started = true;

    void (async () => {
      try {
        const settings = await deps.loadSettings();
        const configError = providerConfigError(settings);
        if (configError) {
          post({ error: configError });
          return;
        }
        const transport = createTransport({
          endpoint: settings.endpoint,
          apiKey: settings.apiKey,
          signal: abort.signal,
        });
        const data = await transport(msg.request, (accumulated) =>
          post({ delta: accumulated }),
        );
        post({ done: true, data });
      } catch (err) {
        post({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
}
