import { describe, expect, it } from "vitest";
import { parseTimedTextJson3, parseTimedTextXml, type Cue } from "./captions";

// A representative YouTube timedtext json3 payload. Real payloads interleave
// caption events with formatting/append-only events that carry no `segs` or
// only whitespace `utf8` (e.g. the trailing "\n" auto-generated captions emit).
const json3Payload = {
  events: [
    // pen/window formatting event — no segs at all, must be dropped.
    { tStartMs: 0, dDurationMs: 0 },
    // real caption line, split across multiple segs — must be joined.
    {
      tStartMs: 1200,
      dDurationMs: 2300,
      segs: [{ utf8: "Hello" }, { utf8: " " }, { utf8: "world" }],
    },
    // append-only whitespace event — must be dropped, not emitted as "".
    { tStartMs: 3500, dDurationMs: 10, segs: [{ utf8: "\n" }] },
    // second caption line.
    { tStartMs: 3600, dDurationMs: 1400, segs: [{ utf8: "Second line" }] },
  ],
};

describe("parseTimedTextJson3", () => {
  it("parses a representative json3 payload into Cue[] (ms→seconds, segs joined)", () => {
    const cues = parseTimedTextJson3(json3Payload);

    const expected: Cue[] = [
      { start: 1.2, dur: 2.3, text: "Hello world" },
      { start: 3.6, dur: 1.4, text: "Second line" },
    ];
    expect(cues).toEqual(expected);
  });

  it("drops events with no segs or whitespace-only text instead of emitting empty cues", () => {
    const cues = parseTimedTextJson3({
      events: [
        { tStartMs: 0, dDurationMs: 100 }, // no segs
        { tStartMs: 100, dDurationMs: 100, segs: [] }, // empty segs
        { tStartMs: 200, dDurationMs: 100, segs: [{ utf8: "   " }] }, // whitespace only
        { tStartMs: 300, dDurationMs: 100, segs: [{}] }, // seg with no utf8
        { tStartMs: 400, dDurationMs: 100, segs: [{ utf8: "keep" }] },
      ],
    });

    expect(cues).toEqual([{ start: 0.4, dur: 0.1, text: "keep" }]);
  });

  it("accepts a JSON string payload as well as a parsed object", () => {
    expect(parseTimedTextJson3(JSON.stringify(json3Payload))).toEqual(
      parseTimedTextJson3(json3Payload),
    );
  });

  it("throws a clear error on an invalid JSON string", () => {
    expect(() => parseTimedTextJson3("{not json")).toThrow(/json/i);
  });

  it("throws a clear error when the payload is not json3-shaped", () => {
    expect(() => parseTimedTextJson3({ foo: 1 })).toThrow(/json3/i);
    expect(() => parseTimedTextJson3(null)).toThrow(/json3/i);
  });
});

// A representative legacy YouTube timedtext XML payload. Whitespace between the
// <text> elements (indentation) must not leak into cues, and empty / whitespace
// -only events are dropped exactly like the json3 parser drops append-only ones.
const xmlPayload = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
  <text start="1.23" dur="4.5">Hello &amp; welcome</text>
  <text start="6" dur="0"></text>
  <text start="7.1" dur="2.2">   </text>
  <text start="9.3" dur="1.8">Second line</text>
</transcript>`;

describe("parseTimedTextXml", () => {
  it("parses a representative legacy XML payload into Cue[] (seconds, entity-decoded)", () => {
    const cues = parseTimedTextXml(xmlPayload);

    const expected: Cue[] = [
      { start: 1.23, dur: 4.5, text: "Hello & welcome" },
      { start: 9.3, dur: 1.8, text: "Second line" },
    ];
    expect(cues).toEqual(expected);
  });

  it("drops empty and whitespace-only <text> events instead of emitting empty cues", () => {
    const cues = parseTimedTextXml(
      `<transcript>` +
        `<text start="0" dur="1"></text>` +
        `<text start="1" dur="1">   </text>` +
        `<text start="2" dur="1">keep</text>` +
        `</transcript>`,
    );
    expect(cues).toEqual([{ start: 2, dur: 1, text: "keep" }]);
  });

  it("decodes named and numeric HTML entities in the inner text", () => {
    const cues = parseTimedTextXml(
      `<transcript><text start="0" dur="1">` +
        `a &amp; b &lt;tag&gt; &quot;q&quot; it&#39;s &#8364;10 &#x263A;` +
        `</text></transcript>`,
    );
    expect(cues).toEqual([
      { start: 0, dur: 1, text: 'a & b <tag> "q" it\'s €10 ☺' },
    ]);
  });

  it("does not double-decode an escaped entity (&amp;lt; stays &lt;)", () => {
    const cues = parseTimedTextXml(
      `<transcript><text start="0" dur="1">&amp;lt;</text></transcript>`,
    );
    expect(cues).toEqual([{ start: 0, dur: 1, text: "&lt;" }]);
  });

  it("throws a clear error on malformed / non-XML input", () => {
    expect(() => parseTimedTextXml("not xml at all")).toThrow(/xml/i);
    expect(() => parseTimedTextXml("<foo>bar</foo>")).toThrow(/xml/i);
    expect(() => parseTimedTextXml("")).toThrow(/xml/i);
  });
});
