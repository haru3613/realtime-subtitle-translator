import type { Cue } from "./captions";

export interface SubtitleOverlayContent {
  source: string;
  translated: string;
}

export function pickActiveCue(cues: readonly Cue[], currentTime: number): Cue | null {
  return (
    cues.find((cue) => currentTime >= cue.start && currentTime < cue.start + cue.dur) ??
    null
  );
}

/**
 * YouTube-like bilingual subtitle chrome: centered bottom, large 繁中 primary
 * line, smaller source line, semi-opaque pill backgrounds.
 */
const OVERLAY_CSS = `
:host {
  position: fixed;
  left: 50%;
  bottom: max(10%, 72px);
  transform: translateX(-50%);
  z-index: 2147483647;
  pointer-events: none;
  width: max-content;
  max-width: min(92vw, 1100px);
  font-family:
    "YouTube Noto", Roboto, "Helvetica Neue", Arial,
    "Noto Sans TC", "PingFang TC", "Microsoft JhengHei",
    system-ui, sans-serif;
  color: #fff;
  text-align: center;
}

[part="stack"] {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

[part="source"],
[part="translated"] {
  box-sizing: border-box;
  max-width: min(92vw, 1100px);
  margin: 0 auto;
  padding: 0.28em 0.7em;
  border-radius: 0.28em;
  background: rgba(8, 8, 8, 0.78);
  color: #fff;
  text-align: center;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

/* Source (EN) secondary — readable but smaller than 繁中. */
[part="source"] {
  font-size: clamp(16px, 2.2vw, 24px);
  font-weight: 500;
  opacity: 0.95;
  order: 1;
}

/* Translated (繁中) primary — large, easy to read while watching. */
[part="translated"] {
  font-size: clamp(24px, 3.6vw, 40px);
  font-weight: 700;
  letter-spacing: 0.01em;
  order: 2;
}

[part="source"]:empty,
[part="translated"]:empty {
  display: none;
  padding: 0;
  margin: 0;
}
`;

export class SubtitleOverlay {
  private readonly host: HTMLElement;
  private readonly sourceLine: HTMLElement;
  private readonly translatedLine: HTMLElement;

  constructor(private readonly container: HTMLElement) {
    this.host = document.createElement("div");
    this.host.setAttribute("data-rst-subtitle-overlay", "");

    const root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = OVERLAY_CSS;
    const stack = document.createElement("div");
    stack.setAttribute("part", "stack");

    this.sourceLine = document.createElement("div");
    this.sourceLine.setAttribute("part", "source");
    this.translatedLine = document.createElement("div");
    this.translatedLine.setAttribute("part", "translated");

    // 繁中 primary below EN secondary (flex order also set in CSS).
    stack.append(this.sourceLine, this.translatedLine);
    root.append(style, stack);
    this.container.append(this.host);
  }

  render(content: SubtitleOverlayContent): void {
    if (!this.host.isConnected) {
      this.container.append(this.host);
    }
    this.sourceLine.textContent = content.source;
    this.translatedLine.textContent = content.translated;
  }

  clear(): void {
    this.sourceLine.textContent = "";
    this.translatedLine.textContent = "";
  }

  detach(): void {
    this.host.remove();
  }
}
