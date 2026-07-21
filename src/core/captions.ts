/**
 * YouTube timedtext (json3) caption payload parser.
 *
 * v0 Mode A extracts YouTube page captions and translates them. The network
 * fetch + DOM extraction stays in the browser shell; this module is the pure,
 * dependency-free slice: turn a timedtext payload into a normalized `Cue[]` that
 * `segmentation.ts` can chunk. Two payload shapes are supported — YouTube's
 * modern json3 (`parseTimedTextJson3`) and the legacy XML transcript
 * (`parseTimedTextXml`, `<transcript><text start dur>…`). The XML parser is
 * regex-based on purpose: no DOMParser, no new deps. The caller decides which
 * to call (no auto-detection here).
 */

/** A single caption cue. `start`/`dur` are in seconds. */
export interface Cue {
  start: number;
  dur: number;
  text: string;
}

interface Json3Seg {
  utf8?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
}

interface Json3Payload {
  events: Json3Event[];
}

function isJson3Payload(value: unknown): value is Json3Payload {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { events?: unknown }).events)
  );
}

/**
 * Parse a YouTube timedtext json3 payload into `Cue[]`.
 *
 * Accepts either a parsed object or a JSON string. For each event, `segs[].utf8`
 * are joined and ms fields converted to seconds. Events with no `segs` or
 * whitespace-only text (json3's formatting / append-only events) are dropped
 * rather than emitted as empty cues.
 *
 * @throws if the string is not valid JSON, or the payload is not json3-shaped
 *   (missing an `events` array).
 */
export function parseTimedTextJson3(payload: unknown): Cue[] {
  let data = payload;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (err) {
      throw new Error(
        `parseTimedTextJson3: invalid JSON string: ${(err as Error).message}`,
      );
    }
  }

  if (!isJson3Payload(data)) {
    throw new Error(
      "parseTimedTextJson3: payload is not YouTube timedtext json3 (expected an object with an `events` array)",
    );
  }

  const cues: Cue[] = [];
  for (const event of data.events) {
    if (!Array.isArray(event?.segs)) continue;
    const text = event.segs.map((seg) => seg?.utf8 ?? "").join("");
    if (text.trim() === "") continue;
    cues.push({
      start: (event.tStartMs ?? 0) / 1000,
      dur: (event.dDurationMs ?? 0) / 1000,
      text,
    });
  }
  return cues;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Decode the HTML entities legacy timedtext escapes in inner text: the five
 * named refs plus numeric decimal (`&#39;`) and hex (`&#x263A;`). Done in a
 * single regex pass so an already-escaped ampersand isn't decoded twice
 * (`&amp;lt;` → `&lt;`, never `<`).
 */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (whole, ref: string) => {
      if (ref[0] === "#") {
        const code =
          ref[1] === "x" || ref[1] === "X"
            ? parseInt(ref.slice(2), 16)
            : parseInt(ref.slice(1), 10);
        return Number.isNaN(code) ? whole : String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[ref] ?? whole;
    },
  );
}

// ponytail: double-quoted attrs only — that's the format YouTube emits. Add a
// single-quote branch if a real payload ever needs it.
function getAttr(attrs: string, name: string): number {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return match ? Number(match[1]) : 0;
}

/**
 * Parse a legacy YouTube timedtext XML transcript into `Cue[]`.
 *
 * Shape/semantics match `parseTimedTextJson3`: `start`/`dur` in seconds, inner
 * text entity-decoded, and empty / whitespace-only `<text>` events dropped
 * rather than emitted as blank cues. Regex-based (no DOMParser / no deps);
 * missing `start`/`dur` attributes default to 0 (mirrors json3's `?? 0`).
 *
 * @throws if the payload contains no `<text>` elements (not timedtext XML),
 *   mirroring the json3 parser throwing on a non-json3 shape.
 */
export function parseTimedTextXml(payload: string): Cue[] {
  if (typeof payload !== "string") {
    throw new Error("parseTimedTextXml: payload must be an XML string");
  }

  const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  const cues: Cue[] = [];
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = textRe.exec(payload)) !== null) {
    found = true;
    const text = decodeEntities(match[2]);
    if (text.trim() === "") continue;
    cues.push({
      start: getAttr(match[1], "start"),
      dur: getAttr(match[1], "dur"),
      text,
    });
  }

  if (!found) {
    throw new Error(
      "parseTimedTextXml: payload is not YouTube timedtext XML (no <text> elements found)",
    );
  }
  return cues;
}
