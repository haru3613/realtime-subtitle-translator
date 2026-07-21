/**
 * Extension settings persistence via chrome.storage.local.
 * Normalization lives in settings.ts; this file only reads/writes.
 */

import { storageGet, storageSet } from "./chromeApi";
import {
  SETTINGS_STORAGE_KEY,
  normalizeSettings,
  type ExtensionSettings,
} from "./settings";

export async function loadSettings(): Promise<ExtensionSettings> {
  const bag = await storageGet(SETTINGS_STORAGE_KEY);
  return normalizeSettings(bag[SETTINGS_STORAGE_KEY]);
}

export async function saveSettings(
  settings: ExtensionSettings,
): Promise<void> {
  await storageSet({
    [SETTINGS_STORAGE_KEY]: normalizeSettings(settings),
  });
}
