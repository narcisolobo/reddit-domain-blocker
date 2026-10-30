import { icon } from "../shared/icons.js";
import { paletteCss } from "./palette.js";

const STYLE = `
:host {
  all: initial;
  display: block;
}
${paletteCss(".bar")}
.bar {
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 4px 0;
  padding: 8px 12px;
  background: var(--rdb-bg);
  color: var(--rdb-fg);
  border: 1px dashed var(--rdb-border);
  border-radius: 8px;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.label {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
.label svg {
  flex: none;
  margin-top: 2px;
}
.label-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
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
button:hover {
  background: var(--rdb-btn-hover);
}
button:focus-visible {
  outline: 2px solid var(--rdb-focus);
  outline-offset: 2px;
}
button svg {
  flex: none;
}
@media (max-width: 412px) {
  button {
    min-width: 44px;
    min-height: 44px;
    justify-content: center;
    padding: 8px;
  }
  button > span {
    display: none;
  }
}
.error {
  flex-basis: 100%;
  color: var(--rdb-error);
}
.error:empty {
  display: none;
}
@media (forced-colors: active) {
  .bar, button {
    border-color: CanvasText;
  }
  button:focus-visible {
    outline-color: Highlight;
  }
}
`;

export function createStub(document, { domain, theme, state, handlers }) {
  let currentDomain = domain;
  let currentState = state;

  const host = document.createElement("div");
  host.setAttribute("data-rdb-stub", "");
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLE;

  const group = document.createElement("div");
  group.className = "bar";
  group.setAttribute("role", "group");
  group.setAttribute("data-theme", theme);

  const label = document.createElement("span");
  label.className = "label";
  const labelText = document.createElement("span");
  labelText.className = "label-text";
  label.innerHTML = icon("ban", 16);
  label.append(labelText);

  const actions = document.createElement("div");
  actions.className = "actions";

  const alertRegion = document.createElement("div");
  alertRegion.className = "error";
  alertRegion.setAttribute("role", "alert");

  group.append(label, actions, alertRegion);
  root.append(style, group);

  function makeButton(iconName, text, name, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = name;
    button.setAttribute("aria-label", name);
    button.innerHTML = icon(iconName, 16);
    const span = document.createElement("span");
    span.textContent = text;
    button.append(span);
    button.addEventListener("click", () => onClick());
    return button;
  }

  function groupLabel() {
    return `${currentState === "hidden" ? "Hidden" : "Shown"} post from ${currentDomain}`;
  }

  let primary = null;
  let unblock = null;

  function render() {
    const hidden = currentState === "hidden";
    group.setAttribute("aria-label", groupLabel());
    labelText.textContent = `${hidden ? "Hidden" : "Shown"}: ${currentDomain}`;
    primary = hidden
      ? makeButton("eye", "Show post", "Show post", () => handlers.onShow())
      : makeButton("eye-off", "Hide post", "Hide post", () => handlers.onHide());
    unblock = makeButton("arrow-back-up", "Unblock domain", `Unblock domain ${currentDomain}`, () =>
      handlers.onUnblock(),
    );
    actions.replaceChildren(primary, unblock);
    alertRegion.textContent = "";
  }

  render();

  return {
    element: host,
    setState(s) {
      currentState = s;
      render();
    },
    setDomain(d) {
      currentDomain = d;
      group.setAttribute("aria-label", groupLabel());
      labelText.textContent = `${currentState === "hidden" ? "Hidden" : "Shown"}: ${d}`;
      unblock.setAttribute("aria-label", `Unblock domain ${d}`);
      unblock.title = `Unblock domain ${d}`;
    },
    setTheme(t) {
      group.setAttribute("data-theme", t);
    },
    showError(message) {
      try {
        alertRegion.textContent = String(message ?? "");
      } catch {
        // never let a failing error report break the page
      }
    },
    focusPrimary() {
      if (primary) primary.focus();
    },
  };
}
