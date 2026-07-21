import {
  parseTimedTextJson3,
  parseTimedTextXml,
  type Cue,
} from "./captions";

export interface CaptionTrack {
  baseUrl: string;
}

interface RawCaptionTrack {
  baseUrl?: unknown;
  languageCode?: unknown;
  vssId?: unknown;
  kind?: unknown;
}

interface FetchTextResponse {
  text(): Promise<string>;
}

export type FetchText = (url: string) => Promise<FetchTextResponse>;

function getCaptionTracks(playerResponse: unknown): RawCaptionTrack[] {
  const tracks = (
    playerResponse as {
      captions?: {
        playerCaptionsTracklistRenderer?: { captionTracks?: unknown };
      };
    }
  )?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  return Array.isArray(tracks) ? tracks : [];
}

function matchesLang(track: RawCaptionTrack, prefLang: string): boolean {
  return (
    track.languageCode === prefLang ||
    track.vssId === `.${prefLang}` ||
    track.vssId === `a.${prefLang}`
  );
}

function isManual(track: RawCaptionTrack): boolean {
  return track.kind !== "asr";
}

interface RawAudioTrack {
  audioTrackId?: unknown;
  hasDefaultTrack?: unknown;
}

/**
 * Best-effort audio language of the video (SPEC §7.4 成本控制): a zh-audio
 * video must skip translation even when its only caption track is English
 * (common for Chinese creators shipping English subs). audioTrackId looks
 * like "zh-Hant.4" — language code before the last dot.
 */
export function pickAudioLanguage(playerResponse: unknown): string | null {
  const tracks = (
    playerResponse as {
      captions?: {
        playerCaptionsTracklistRenderer?: { audioTracks?: unknown };
      };
    }
  )?.captions?.playerCaptionsTracklistRenderer?.audioTracks;

  if (Array.isArray(tracks) && tracks.length > 0) {
    const raw = tracks as RawAudioTrack[];
    const picked = raw.find((t) => t.hasDefaultTrack === true) ?? raw[0];
    if (typeof picked.audioTrackId === "string" && picked.audioTrackId !== "") {
      const lang = picked.audioTrackId.replace(/\.[^.]*$/, "");
      if (lang !== "") return lang;
    }
  }

  const fallback = (
    playerResponse as { videoDetails?: { defaultAudioLanguage?: unknown } }
  )?.videoDetails?.defaultAudioLanguage;
  return typeof fallback === "string" && fallback !== "" ? fallback : null;
}

export function pickCaptionTrack(
  playerResponse: unknown,
  prefLang?: string,
): CaptionTrack | null {
  const tracks = getCaptionTracks(playerResponse).filter(
    (track): track is RawCaptionTrack & { baseUrl: string } =>
      typeof track.baseUrl === "string" && track.baseUrl.length > 0,
  );
  if (tracks.length === 0) return null;

  const picked =
    (prefLang &&
      tracks.find((track) => isManual(track) && matchesLang(track, prefLang))) ||
    (prefLang && tracks.find((track) => matchesLang(track, prefLang))) ||
    tracks.find(isManual) ||
    tracks[0];

  return { baseUrl: picked.baseUrl };
}

/**
 * Append/replace `fmt=` without re-encoding the rest of the signed URL.
 * `new URL().searchParams` re-serialization can invalidate YouTube signatures.
 */
export function withTimedTextFmt(baseUrl: string, fmt: string): string {
  if (new RegExp(`[?&]fmt=${fmt}(?:&|$)`).test(baseUrl)) return baseUrl;
  if (/[?&]fmt=/.test(baseUrl)) {
    return baseUrl.replace(/([?&])fmt=[^&]*/, `$1fmt=${encodeURIComponent(fmt)}`);
  }
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=${encodeURIComponent(fmt)}`;
}

function previewBody(body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return "<empty>";
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
}

/**
 * Parse a timedtext body: json3 first, then legacy XML `<text>`, then srv3 `<p t d>`.
 */
export function parseTimedTextBody(body: string): Cue[] {
  if (typeof body !== "string" || body.trim() === "") {
    throw new Error("parseTimedTextBody: empty payload");
  }
  try {
    return parseTimedTextJson3(body);
  } catch {
    /* try XML shapes */
  }
  try {
    return parseTimedTextXml(body);
  } catch {
    /* try srv3 */
  }
  return parseTimedTextSrv3(body);
}

/**
 * YouTube srv3 / modern timedtext: `<p t="ms" d="ms">…</p>` (ms, not seconds).
 */
export function parseTimedTextSrv3(payload: string): Cue[] {
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  const cues: Cue[] = [];
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = pRe.exec(payload)) !== null) {
    found = true;
    const attrs = match[1] ?? "";
    const inner = (match[2] ?? "")
      .replace(/<s\b[^>]*>/g, "")
      .replace(/<\/s>/g, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "");
    const text = decodeBasicEntities(inner).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const tMs = getAttrNumber(attrs, "t");
    const dMs = getAttrNumber(attrs, "d");
    cues.push({ start: tMs / 1000, dur: dMs / 1000, text });
  }
  if (!found) {
    throw new Error("parseTimedTextSrv3: no <p> elements found");
  }
  return cues;
}

function getAttrNumber(attrs: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? Number(m[1]) : 0;
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Fetch + parse YouTube timedtext into Cue[].
 * Tries fmt=json3, srv3, then the original baseUrl.
 * Empty bodies are treated as failures (YouTube often returns 200 + empty).
 */
export async function fetchCues(
  baseUrl: string,
  fetchImpl?: FetchText,
): Promise<Cue[]> {
  const fetcher =
    fetchImpl ?? (globalThis as { fetch?: FetchText }).fetch;
  if (!fetcher) {
    throw new Error("fetchCues: fetch implementation is required");
  }

  const candidates = [
    withTimedTextFmt(baseUrl, "json3"),
    withTimedTextFmt(baseUrl, "srv3"),
    baseUrl,
  ];
  const urls = [...new Set(candidates)];

  const errors: string[] = [];
  for (const url of urls) {
    let body: string;
    try {
      body = await (await fetcher(url)).text();
    } catch (err) {
      errors.push(
        `${url}: fetch failed (${err instanceof Error ? err.message : String(err)})`,
      );
      continue;
    }
    if (!body || body.trim() === "") {
      errors.push(`${url}: empty body (YouTube timedtext often needs player intercept)`);
      continue;
    }
    try {
      return parseTimedTextBody(body);
    } catch (err) {
      errors.push(
        `${url}: parse failed (${err instanceof Error ? err.message : String(err)}); body=${previewBody(body)}`,
      );
    }
  }

  throw new Error(`fetchCues: no usable timedtext\n${errors.join("\n")}`);
}
