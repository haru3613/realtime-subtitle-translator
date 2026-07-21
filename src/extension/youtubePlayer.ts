/**
 * YouTube page helpers for the content-script shell (SPEC §5.4 / §7.1 / §14).
 * Pure DOM string parsing so unit tests can drive them under happy-dom without
 * a real player. Isolated-world content scripts cannot read page `window`
 * globals; we recover `ytInitialPlayerResponse` from inline script text (and
 * the MAIN-world bridge can also stash a fresher copy via postMessage).
 */

/** Extract a balanced `{...}` JSON object starting at `start` (must be `{`). */
export function extractBalancedJsonObject(text: string, start: number): string {
  if (text[start] !== "{") {
    throw new Error("extractBalancedJsonObject: start must point at '{'");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("extractBalancedJsonObject: unbalanced braces");
}

/**
 * Best-effort parse of `ytInitialPlayerResponse` from document script tags.
 * Returns null when nothing parseable is found.
 */
export function extractYtInitialPlayerResponse(doc: Document): unknown | null {
  const scripts = Array.from(doc.scripts);
  for (const script of scripts) {
    const text = script.textContent ?? "";
    if (!text.includes("ytInitialPlayerResponse")) continue;
    const marker = "ytInitialPlayerResponse";
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(marker, from);
      if (idx < 0) break;
      const eq = text.indexOf("=", idx + marker.length);
      if (eq < 0) break;
      let brace = eq + 1;
      while (brace < text.length && /\s/.test(text[brace]!)) brace++;
      if (text[brace] !== "{") {
        from = idx + marker.length;
        continue;
      }
      try {
        const json = extractBalancedJsonObject(text, brace);
        return JSON.parse(json) as unknown;
      } catch {
        from = idx + marker.length;
      }
    }
  }
  return null;
}

/** Pull a YouTube video id from watch / youtu.be / shorts URLs. */
export function extractVideoIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id && id.length > 0 ? id : null;
    }
    if (u.pathname.startsWith("/shorts/")) {
      const id = u.pathname.split("/")[2];
      return id && id.length > 0 ? id : null;
    }
    const v = u.searchParams.get("v");
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Prefer the YouTube main player video; else first <video> on the page. */
export function findPrimaryVideo(doc: Document): HTMLVideoElement | null {
  const main = doc.querySelector("video.html5-main-video");
  if (main instanceof HTMLVideoElement) return main;
  const any = doc.querySelector("video");
  return any instanceof HTMLVideoElement ? any : null;
}
