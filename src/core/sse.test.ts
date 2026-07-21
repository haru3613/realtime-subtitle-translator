import { describe, expect, it } from "vitest";
import { createSseAccumulator } from "./sse";

function collect() {
  const deltas: string[] = [];
  const acc = createSseAccumulator((text) => deltas.push(text));
  return { acc, deltas };
}

const event = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe("createSseAccumulator", () => {
  it("emits accumulated text per delta event in a single chunk", () => {
    const { acc, deltas } = collect();
    acc.feed(event("你") + event("好"));
    expect(deltas).toEqual(["你", "你好"]);
    expect(acc.text()).toBe("你好");
  });

  it("handles an event split across chunk boundaries", () => {
    const { acc, deltas } = collect();
    const whole = event("hello");
    acc.feed(whole.slice(0, 12));
    expect(deltas).toEqual([]);
    acc.feed(whole.slice(12));
    expect(deltas).toEqual(["hello"]);
  });

  it("stops at [DONE] and ignores anything after", () => {
    const { acc, deltas } = collect();
    acc.feed(event("a") + "data: [DONE]\n\n" + event("b"));
    expect(deltas).toEqual(["a"]);
    expect(acc.text()).toBe("a");
  });

  it("ignores malformed data lines and non-data lines", () => {
    const { acc, deltas } = collect();
    acc.feed("data: {not json}\n\n: keep-alive comment\n\n" + event("x"));
    expect(deltas).toEqual(["x"]);
  });

  it("ignores events without delta content (role-only first chunk)", () => {
    const { acc, deltas } = collect();
    acc.feed(
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n` +
        event("ok"),
    );
    expect(deltas).toEqual(["ok"]);
  });

  it("handles CRLF line endings", () => {
    const { acc, deltas } = collect();
    acc.feed(event("a").replace(/\n/g, "\r\n"));
    expect(deltas).toEqual(["a"]);
  });

  it("flush() emits a final event missing its trailing blank line", () => {
    const { acc, deltas } = collect();
    acc.feed(event("a") + event("b").trimEnd()); // last event unterminated
    expect(deltas).toEqual(["a"]);
    acc.flush();
    expect(deltas).toEqual(["a", "ab"]);
    expect(acc.text()).toBe("ab");
  });

  it("flush() after [DONE] is a no-op", () => {
    const { acc, deltas } = collect();
    acc.feed(event("a") + "data: [DONE]\n\n");
    acc.flush();
    expect(deltas).toEqual(["a"]);
  });
});
