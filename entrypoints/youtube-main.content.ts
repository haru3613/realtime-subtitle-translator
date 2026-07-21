/**
 * MAIN-world bridge:
 * - post ytInitialPlayerResponse
 * - page-cookie fetch for timedtext
 * - **intercept** player timedtext network (fetch/XHR) — direct timedtext URLs
 *   often return HTTP 200 + empty body without the player's anti-bot context
 * - optionally enable the captions module so the player issues that request
 */

const SOURCE = "rst-main";
const ISOLATED = "rst-isolated";

type TimedtextCapture = { url: string; text: string; at: number };

const captures: TimedtextCapture[] = [];
const MAX_CAPTURES = 8;

function readPlayerResponse(): unknown | null {
  const w = window as unknown as {
    ytInitialPlayerResponse?: unknown;
    ytplayer?: { config?: { args?: { player_response?: string } } };
  };
  if (w.ytInitialPlayerResponse != null) return w.ytInitialPlayerResponse;

  const raw = w.ytplayer?.config?.args?.player_response;
  if (typeof raw === "string" && raw.length > 0) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

function postPlayerResponse(): boolean {
  try {
    const data = readPlayerResponse();
    if (data == null) return false;
    window.postMessage(
      { source: SOURCE, type: "player-response", data },
      "*",
    );
    return true;
  } catch {
    return false;
  }
}

function isTimedtextUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length === 0) return false;
  return (
    url.includes("/api/timedtext") ||
    url.includes("timedtext?") ||
    url.includes("timedtext&")
  );
}

function noteTimedtext(url: string, text: string): void {
  if (typeof text !== "string" || text.trim() === "") return;
  captures.unshift({ url, text, at: Date.now() });
  if (captures.length > MAX_CAPTURES) captures.length = MAX_CAPTURES;
  window.postMessage(
    { source: SOURCE, type: "timedtext-capture", url, text },
    "*",
  );
}

function installNetworkInterceptors(): void {
  const g = window as unknown as {
    fetch: typeof fetch;
    XMLHttpRequest: typeof XMLHttpRequest;
  };

  const origFetch = g.fetch.bind(window);
  g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const res = await origFetch(input as RequestInfo, init);
    if (isTimedtextUrl(url)) {
      try {
        const text = await res.clone().text();
        noteTimedtext(url, text);
      } catch {
        /* ignore clone failures */
      }
    }
    return res;
  };

  const XHR = g.XMLHttpRequest;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;
  XHR.prototype.open = function (
    this: XMLHttpRequest & { __rstUrl?: string },
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.__rstUrl = String(url);
    return origOpen.apply(this, [method, url, ...rest] as never);
  };
  XHR.prototype.send = function (
    this: XMLHttpRequest & { __rstUrl?: string },
    ...args: unknown[]
  ) {
    this.addEventListener("load", () => {
      const u = this.__rstUrl;
      if (isTimedtextUrl(u) && this.responseText) {
        noteTimedtext(u, this.responseText);
      }
    });
    return origSend.apply(this, args as never);
  };
}

/** Ask the YouTube player to load a caption track so it hits timedtext itself. */
function enableCaptions(lang: string): void {
  try {
    const player = document.getElementById("movie_player") as null | {
      loadModule?: (name: string) => void;
      setOption?: (module: string, option: string, value: unknown) => void;
      unloadModule?: (name: string) => void;
    };
    if (!player) return;
    player.loadModule?.("captions");
    // Prefer preferred language; player may still pick ASR.
    player.setOption?.("captions", "track", { languageCode: lang });
    // Some builds use this toggle path.
    player.setOption?.("captions", "reload", true);
  } catch {
    /* player API is best-effort */
  }
}

async function fetchTextInPage(url: string): Promise<string> {
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "*/*",
      // Look more like the player.
      "Accept-Language": navigator.language || "en-US",
    },
  });
  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 120);
    throw new Error(`HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`);
  }
  const text = await res.text();
  if (text.trim() !== "") {
    noteTimedtext(url, text);
    return text;
  }
  // Empty body: wait briefly for an intercepted player request.
  const captured = await waitForAnyCapture(8000);
  if (captured) return captured;
  throw new Error(
    "timedtext empty body — turn on YouTube CC once so the player loads captions, then retry",
  );
}

function waitForAnyCapture(timeoutMs: number): Promise<string | null> {
  if (captures[0]?.text) return Promise.resolve(captures[0].text);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { source?: string; type?: string; text?: string };
      if (
        data?.source === SOURCE &&
        data.type === "timedtext-capture" &&
        typeof data.text === "string" &&
        data.text.trim()
      ) {
        finish(data.text);
      }
    };
    window.addEventListener("message", onMessage);
    // Also poll cache (capture may have arrived before listener).
    const poll = window.setInterval(() => {
      if (captures[0]?.text) {
        window.clearInterval(poll);
        finish(captures[0].text);
      }
    }, 200);
    const timer = window.setTimeout(() => {
      window.clearInterval(poll);
      finish(captures[0]?.text ?? null);
    }, timeoutMs);
  });
}

export default defineContentScript({
  matches: ["*://*.youtube.com/*", "*://youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installNetworkInterceptors();

    const boot = () => {
      captures.length = 0;
      postPlayerResponse();
    };
    boot();
    document.addEventListener("yt-navigate-finish", boot);

    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const msg = data as {
        source?: unknown;
        type?: unknown;
        id?: unknown;
        url?: unknown;
        lang?: unknown;
      };
      if (msg.source !== ISOLATED) return;

      if (msg.type === "request-player-response") {
        postPlayerResponse();
        return;
      }

      if (msg.type === "enable-captions") {
        const lang = typeof msg.lang === "string" ? msg.lang : "en";
        enableCaptions(lang);
        // Also poke after a short delay — player may not be ready yet.
        window.setTimeout(() => enableCaptions(lang), 500);
        window.setTimeout(() => enableCaptions(lang), 1500);
        return;
      }

      if (
        msg.type === "fetch-text" &&
        typeof msg.id === "string" &&
        typeof msg.url === "string"
      ) {
        const id = msg.id;
        const url = msg.url;
        void (async () => {
          try {
            // Kick the player so intercept can succeed if direct fetch is empty.
            enableCaptions("en");
            const text = await fetchTextInPage(url);
            window.postMessage(
              { source: SOURCE, type: "fetch-text-result", id, ok: true, text },
              "*",
            );
          } catch (err) {
            // Last resort: any recent capture for this session.
            const fallback = captures[0]?.text;
            if (fallback) {
              window.postMessage(
                {
                  source: SOURCE,
                  type: "fetch-text-result",
                  id,
                  ok: true,
                  text: fallback,
                },
                "*",
              );
              return;
            }
            window.postMessage(
              {
                source: SOURCE,
                type: "fetch-text-result",
                id,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              },
              "*",
            );
          }
        })();
      }

      if (msg.type === "wait-timedtext-capture" && typeof msg.id === "string") {
        const id = msg.id;
        const timeoutMs =
          typeof (msg as { timeoutMs?: unknown }).timeoutMs === "number"
            ? ((msg as { timeoutMs: number }).timeoutMs)
            : 12000;
        void (async () => {
          enableCaptions(
            typeof msg.lang === "string" ? msg.lang : "en",
          );
          const text = await waitForAnyCapture(timeoutMs);
          if (text) {
            window.postMessage(
              { source: SOURCE, type: "fetch-text-result", id, ok: true, text },
              "*",
            );
          } else {
            window.postMessage(
              {
                source: SOURCE,
                type: "fetch-text-result",
                id,
                ok: false,
                error:
                  "No timedtext captured. Click CC on the YouTube player once, then reload.",
              },
              "*",
            );
          }
        })();
      }
    });

    let tries = 0;
    const id = window.setInterval(() => {
      postPlayerResponse();
      tries += 1;
      if (tries >= 40) window.clearInterval(id);
    }, 250);
  },
});
