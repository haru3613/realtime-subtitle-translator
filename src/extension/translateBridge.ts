/**
 * Content-script → background translation bridge.
 * Builds a core TranslationPipeline whose transport is chrome.runtime
 * messaging (avoids page CORS on provider endpoints). Non-streaming calls use
 * one-shot sendMessage; calls with `onPartial` open a dedicated runtime Port
 * and receive SSE deltas relayed by the background (see streamBridge.ts).
 */

import { AI_CRYPTO_GLOSSARY } from "../core/glossary";
import {
  createTranslationPipeline,
  type Transport,
} from "../core/pipeline";
import type { Translate } from "../core/subtitleRenderer";
import {
  runtimeConnect,
  runtimeSendMessage,
  type RuntimePort,
} from "./chromeApi";
import {
  CANCEL_TRANSLATE_MESSAGE_TYPE,
  TRANSLATE_MESSAGE_TYPE,
  TRANSLATE_STREAM_PORT_NAME,
  isTranslateResponseOk,
  parseStreamEvent,
} from "./messages";
import type { ExtensionSettings } from "./settings";
import type { OpenAICompatibleRequest } from "../core/provider";

export interface TranslateBridgeDeps {
  sendMessage?: (message: unknown) => Promise<unknown>;
  connect?: (name: string) => RuntimePort;
}

function sendOnce(
  sendMessage: (message: unknown) => Promise<unknown>,
): Transport {
  return async (request, options) => {
    const id = crypto.randomUUID();
    const signal = options?.signal;
    signal?.throwIfAborted();
    const cancel = () => {
      void sendMessage({
        type: CANCEL_TRANSLATE_MESSAGE_TYPE,
        id,
      }).catch(() => {});
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const res: unknown = await sendMessage({
        type: TRANSLATE_MESSAGE_TYPE,
        id,
        request,
      });
      if (!isTranslateResponseOk(res)) {
        const err =
          res !== null &&
          typeof res === "object" &&
          "error" in res &&
          typeof (res as { error: unknown }).error === "string"
            ? (res as { error: string }).error
            : "translate bridge failed";
        throw new Error(err);
      }
      return res.data;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  };
}

/**
 * No delta for this long → treat the stream as hung, disconnect the port
 * (which aborts the provider fetch in the background) and reject. Prevents
 * orphaned streams from accumulating when a provider stalls.
 */
export const STREAM_IDLE_TIMEOUT_MS = 30_000;

function streamOnce(
  connect: (name: string) => RuntimePort,
): (
  request: OpenAICompatibleRequest,
  onDelta: (accumulated: string) => void,
  signal?: AbortSignal,
) => Promise<unknown> {
  return (request, onDelta, signal) =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const port = connect(TRANSLATE_STREAM_PORT_NAME);
      let settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        signal?.removeEventListener("abort", onAbort);
        fn();
        port.disconnect();
      };
      const onAbort = () =>
        settle(() => reject(signal?.reason ?? new Error("translate aborted")));
      const armIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => settle(() => reject(new Error("translate stream idle timeout"))),
          STREAM_IDLE_TIMEOUT_MS,
        );
      };
      port.onMessage.addListener((msg) => {
        const event = parseStreamEvent(msg);
        if (event === null) return;
        if (event.kind === "delta") {
          armIdleTimer(); // healthy stream keeps itself alive
          onDelta(event.delta);
        } else if (event.kind === "done") settle(() => resolve(event.data));
        else settle(() => reject(new Error(event.error)));
      });
      port.onDisconnect.addListener(() => {
        if (!settled) {
          settled = true;
          clearTimeout(idleTimer);
          reject(new Error("translate stream disconnected"));
        }
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      armIdleTimer();
      port.postMessage({ request });
    });
}

export function createBackgroundTranslate(
  settings: ExtensionSettings,
  deps: TranslateBridgeDeps = {},
): Translate {
  const send = sendOnce(deps.sendMessage ?? runtimeSendMessage);
  const stream = streamOnce(deps.connect ?? runtimeConnect);

  const transport: Transport = (request, options) =>
    options?.onDelta
      ? stream(request, options.onDelta, options.signal)
      : send(request, options);

  const pipeline = createTranslationPipeline(
    {
      model: settings.model,
      targetLanguage: settings.targetLanguage,
      provider: "openai-compatible",
      glossaryProfile: "ai_crypto",
      glossary: AI_CRYPTO_GLOSSARY,
    },
    transport,
  );

  return (source, options) => pipeline.translateCue(source, options);
}
