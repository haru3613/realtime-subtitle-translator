import { httpTransport } from "../src/core/transport";
import {
  isCancelTranslateRequest,
  isTranslateRequest,
  TRANSLATE_STREAM_PORT_NAME,
  type TranslateResponseMessage,
} from "../src/extension/messages";
import {
  attachTranslateStreamPort,
  providerConfigError,
} from "../src/extension/streamBridge";
import { needsSetupWizard } from "../src/extension/settings";
import { loadSettings } from "../src/extension/storage";

/**
 * Background:
 * - proxy translation HTTP (host_permissions, no page CORS)
 * - stream translations over a runtime Port (SSE deltas → content overlay)
 * - open setup wizard on first install / when still unconfigured
 */
export default defineBackground(() => {
  const activeTranslations = new Map<string, AbortController>();

  browser.runtime.onInstalled.addListener((details) => {
    void (async () => {
      if (details.reason !== "install" && details.reason !== "update") return;
      try {
        const settings = await loadSettings();
        // Always open on fresh install; on update only if still needs setup.
        if (details.reason === "install" || needsSetupWizard(settings)) {
          await browser.runtime.openOptionsPage();
        }
      } catch {
        await browser.runtime.openOptionsPage();
      }
    })();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (isCancelTranslateRequest(message)) {
      activeTranslations.get(message.id)?.abort();
      return;
    }
    if (!isTranslateRequest(message)) return;

    return (async (): Promise<TranslateResponseMessage> => {
      const controller = new AbortController();
      activeTranslations.set(message.id, controller);
      try {
        const settings = await loadSettings();
        const configError = providerConfigError(settings);
        if (configError) {
          return { ok: false, error: configError };
        }
        const transport = httpTransport({
          endpoint: settings.endpoint,
          apiKey: settings.apiKey,
        });
        const data = await transport(message.request, {
          signal: controller.signal,
        });
        return { ok: true, data };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        if (activeTranslations.get(message.id) === controller) {
          activeTranslations.delete(message.id);
        }
      }
    })();
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== TRANSLATE_STREAM_PORT_NAME) return;
    attachTranslateStreamPort(port, { loadSettings });
  });
});
