import { icon } from "../shared/icons.js";
import { detectTheme } from "./theme.js";

// Palette values mirror the stub's (src/content/stub.js); duplicated rather
// than shared so the stub stays untouched.
const STYLE = `
:host {
  all: initial;
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 2147483647;
  max-width: min(560px, calc(100vw - 32px));
}
.box {
  --rdb-bg: #f6f7f8;
  --rdb-fg: #1c1c1c;
  --rdb-border: #6b7280;
  --rdb-btn-bg: #ffffff;
  --rdb-btn-hover: #e9ebed;
  --rdb-focus: #005fcc;
  --rdb-error: #b3261e;
}
.box[data-theme="dark"] {
  --rdb-bg: #1a1a1b;
  --rdb-fg: #e8eaed;
  --rdb-border: #8b949e;
  --rdb-btn-bg: #272729;
  --rdb-btn-hover: #343437;
  --rdb-focus: #4d90fe;
  --rdb-error: #ff8a80;
}
.box {
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 12px;
  background: var(--rdb-bg);
  color: var(--rdb-fg);
  border: 1px solid var(--rdb-border);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.messages {
  flex: 1 1 200px;
  min-width: 0;
  overflow-wrap: anywhere;
}
/* Hidden state keeps the live regions rendered (no display:none or
   visibility:hidden) so screen readers announce text written later. */
.box.off {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  border: 0;
  box-shadow: none;
  white-space: nowrap;
}
.error { color: var(--rdb-error); }
button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 4px 10px;
  background: var(--rdb-btn-bg);
  color: var(--rdb-fg);
  border: 1px solid var(--rdb-border);
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}
button[hidden] { display: none; }
button:hover { background: var(--rdb-btn-hover); }
button:focus-visible {
  outline: 2px solid var(--rdb-focus);
  outline-offset: 2px;
}
button svg { flex: none; }
@media (forced-colors: active) {
  .box, button { border-color: CanvasText; }
  button:focus-visible { outline-color: Highlight; }
}
`;

export function createNotice(document, { defer = (fn) => setTimeout(fn, 0) } = {}) {
  let host = null;
  let box = null;
  let statusRegion = null;
  let alertRegion = null;
  let button = null;
  let token = 0;

  function build() {
    host = document.createElement("div");
    host.setAttribute("data-rdb-notice", "");
    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLE;

    box = document.createElement("div");
    box.className = "box off";

    const messages = document.createElement("div");
    messages.className = "messages";
    statusRegion = document.createElement("div");
    statusRegion.setAttribute("role", "status");
    alertRegion = document.createElement("div");
    alertRegion.className = "error";
    alertRegion.setAttribute("role", "alert");
    messages.append(statusRegion, alertRegion);

    button = document.createElement("button");
    button.hidden = true;
    button.type = "button";
    button.title = "Dismiss message";
    button.setAttribute("aria-label", "Dismiss message");
    button.innerHTML = icon("x", 16);
    const span = document.createElement("span");
    span.textContent = "Dismiss";
    button.append(span);
    button.addEventListener("click", () => dismiss());

    box.append(messages, button);
    root.append(style, box);
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dismiss();
    });
    (document.body || document.documentElement).append(host);
  }

  function dismiss() {
    token += 1;
    if (!host) return;
    box.classList.add("off");
    button.hidden = true;
    statusRegion.textContent = "";
    alertRegion.textContent = "";
  }

  function show({ kind, text }) {
    if (!host) build();
    box.setAttribute("data-theme", detectTheme(document));
    const target = kind === "error" ? alertRegion : statusRegion;
    const other = kind === "error" ? statusRegion : alertRegion;
    other.textContent = "";
    // Make the box visible first; write the text on a later tick so the
    // already-rendered live region announces the change.
    box.classList.remove("off");
    button.hidden = false;
    const mine = ++token;
    defer(() => {
      if (mine === token) target.textContent = String(text ?? "");
    });
  }

  return { show, dismiss };
}
