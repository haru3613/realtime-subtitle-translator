/**
 * Resolve the extension API surface reliably in content scripts.
 *
 * WXT compiles `browser` to roughly:
 *   globalThis.browser?.runtime?.id ? browser : chrome
 * Some environments expose a partial `browser` (has runtime.id, no storage),
 * which then throws "Cannot read properties of undefined (reading 'local')".
 * Prefer whichever object actually has the API we need.
 */

type StorageLocal = {
  get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  // callback forms still exist on older chrome typings
  get(
    keys: string | string[] | Record<string, unknown> | null,
    cb: (items: Record<string, unknown>) => void,
  ): void;
  set(items: Record<string, unknown>, cb: () => void): void;
};

/** Structural subset of chrome.runtime.Port used by the stream bridge. */
export type RuntimePort = {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
};

type RuntimeLike = {
  sendMessage: (message: unknown) => Promise<unknown>;
  connect?: (connectInfo: { name: string }) => RuntimePort;
  lastError?: { message?: string };
  id?: string;
};

type StorageLike = {
  local: StorageLocal;
  onChanged: {
    addListener: (
      cb: (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        area: string,
      ) => void,
    ) => void;
  };
};

type ExtensionApi = {
  storage: StorageLike;
  runtime: RuntimeLike;
};

function asApi(value: unknown): ExtensionApi | null {
  if (value === null || typeof value !== "object") return null;
  return value as ExtensionApi;
}

/** Prefer chrome when it has storage; fall back to browser. */
export function getExtensionApi(): ExtensionApi {
  const chromeApi = asApi(
    (globalThis as { chrome?: unknown }).chrome,
  );
  const browserApi = asApi(
    (globalThis as { browser?: unknown }).browser,
  );

  if (chromeApi?.storage?.local) return chromeApi;
  if (browserApi?.storage?.local) return browserApi;
  if (chromeApi?.runtime) return chromeApi;
  if (browserApi?.runtime) return browserApi;

  throw new Error(
    "Extension API unavailable (chrome/browser). Reload the extension on chrome://extensions.",
  );
}

export function getStorageLocal(): StorageLocal {
  const api = getExtensionApi();
  const local = api.storage?.local;
  if (!local) {
    throw new Error(
      "chrome.storage.local unavailable — ensure the extension has the 'storage' permission and reload it",
    );
  }
  return local;
}

/** Promise-wrap storage.get (handles both MV3 promise and callback forms). */
export async function storageGet(
  keys: string | string[],
): Promise<Record<string, unknown>> {
  const area = getStorageLocal();
  const result = (area as StorageLocal).get(keys) as unknown;
  if (result !== undefined && result !== null && typeof (result as Promise<unknown>).then === "function") {
    return result as Promise<Record<string, unknown>>;
  }
  return new Promise((resolve, reject) => {
    (area as StorageLocal).get(keys, (items) => {
      const err = getExtensionApi().runtime?.lastError;
      if (err?.message) reject(new Error(err.message));
      else resolve((items ?? {}) as Record<string, unknown>);
    });
  });
}

export async function storageSet(
  items: Record<string, unknown>,
): Promise<void> {
  const area = getStorageLocal();
  const result = (area as StorageLocal).set(items) as unknown;
  if (result !== undefined && result !== null && typeof (result as Promise<unknown>).then === "function") {
    await (result as Promise<void>);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    (area as StorageLocal).set(items, () => {
      const err = getExtensionApi().runtime?.lastError;
      if (err?.message) reject(new Error(err.message));
      else resolve();
    });
  });
}

export async function runtimeSendMessage(message: unknown): Promise<unknown> {
  const api = getExtensionApi();
  if (!api.runtime?.sendMessage) {
    throw new Error("chrome.runtime.sendMessage unavailable");
  }
  return api.runtime.sendMessage(message);
}

export function runtimeConnect(name: string): RuntimePort {
  const api = getExtensionApi();
  if (!api.runtime?.connect) {
    throw new Error("chrome.runtime.connect unavailable");
  }
  return api.runtime.connect({ name });
}

export function onStorageChanged(
  cb: (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area: string,
  ) => void,
): void {
  const api = getExtensionApi();
  if (!api.storage?.onChanged?.addListener) {
    throw new Error("chrome.storage.onChanged unavailable");
  }
  api.storage.onChanged.addListener(cb);
}
