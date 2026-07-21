/**
 * Small fixed status chip so the user can see extension state without DevTools.
 */

export type StatusKind = "info" | "ok" | "err";

export interface StatusBanner {
  set(text: string, kind?: StatusKind): void;
  clear(): void;
  detach(): void;
}

const CSS = `
:host {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 2147483647;
  pointer-events: none;
  max-width: min(420px, 92vw);
  font: 600 12px/1.35 system-ui, sans-serif;
}
[part="chip"] {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(20, 20, 20, 0.88);
  color: #fff;
  box-shadow: 0 2px 10px rgba(0,0,0,.35);
  white-space: pre-wrap;
  word-break: break-word;
}
:host([data-kind="ok"]) [part="chip"] { background: rgba(10, 120, 70, 0.92); }
:host([data-kind="err"]) [part="chip"] { background: rgba(160, 40, 40, 0.94); }
:host([data-kind="info"]) [part="chip"] { background: rgba(20, 20, 20, 0.88); }
`;

export function createStatusBanner(
  container: HTMLElement = document.documentElement,
): StatusBanner {
  const host = document.createElement("div");
  host.setAttribute("data-rst-status", "");
  host.dataset.kind = "info";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const chip = document.createElement("div");
  chip.setAttribute("part", "chip");
  chip.textContent = "";
  root.append(style, chip);
  container.append(host);

  return {
    set(text: string, kind: StatusKind = "info") {
      if (!host.isConnected) container.append(host);
      host.dataset.kind = kind;
      chip.textContent = text ? `RST: ${text}` : "";
      host.style.display = text ? "" : "none";
    },
    clear() {
      chip.textContent = "";
      host.style.display = "none";
    },
    detach() {
      host.remove();
    },
  };
}
