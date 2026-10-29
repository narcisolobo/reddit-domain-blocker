import { icon } from "../shared/icons.js";
import { recordsFromItems } from "../shared/records.js";
import { messageFor, renderList } from "./view.js";

export async function init(env) {
  const { chrome, document } = env;
  const form = document.getElementById("add-form");
  const input = document.getElementById("domain-input");
  const addButton = document.getElementById("add-button");
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error");
  const listEl = document.getElementById("list");

  addButton.innerHTML = `${icon("plus")}<span>Add</span>`;
  errorEl.id = "error";

  function show(message) {
    if (message.kind === "error") {
      statusEl.textContent = "";
      errorEl.textContent = message.text;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", errorEl.id);
    } else {
      errorEl.textContent = "";
      statusEl.textContent = message.text;
      clearInvalid();
    }
  }

  function clearInvalid() {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      return undefined;
    }
  }

  let seq = 0;
  let latest = Promise.resolve();
  let lastDomains = [];
  let pendingFocus = null;

  function removeButtons() {
    return [...listEl.querySelectorAll(".btn-remove")];
  }

  function focusedDomain() {
    const active = document.activeElement;
    if (!active || !listEl.contains(active)) return null;
    const btn = active.closest(".btn-remove");
    return btn ? btn.dataset.domain : null;
  }

  // Render records, keeping focus on the same row's Remove button. If the
  // row is gone, fall back to the next row, else the previous row, else the
  // input. Focus outside the list is never touched.
  function render(records) {
    const before = lastDomains;
    // A pending removal only decides focus until a render has dropped that
    // row; later renders (e.g. the second of onChanged + awaited refresh)
    // keep whatever already has focus.
    const key =
      pendingFocus !== null && before.includes(pendingFocus) ? pendingFocus : focusedDomain();
    renderList(listEl, records, { onRemove });
    const buttons = removeButtons();
    const domains = buttons.map((b) => b.dataset.domain);
    lastDomains = domains;
    if (key === null) return;
    let target = buttons[domains.indexOf(key)];
    if (!target) {
      const at = before.indexOf(key);
      const later = at < 0 ? [] : before.slice(at + 1);
      const earlier = at < 0 ? [] : before.slice(0, at).reverse();
      const found = [...later, ...earlier].find((d) => domains.includes(d));
      target = found !== undefined ? buttons[domains.indexOf(found)] : input;
    }
    target.focus();
  }

  function refresh() {
    const mine = ++seq;
    const run = (async () => {
      let items = {};
      try {
        items = await chrome.storage.sync.get(null);
      } catch {
        items = {};
      }
      if (mine !== seq) return;
      render(recordsFromItems(items));
    })();
    latest = run;
    return run;
  }

  async function onRemove(domain) {
    pendingFocus = domain;
    try {
      const result = await send({ type: "domain/archive", domain });
      const message = messageFor(result);
      show(message);
      if (message.kind !== "status") return;
      await refresh();
      await latest;
    } finally {
      pendingFocus = null;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await send({ type: "domain/add", input: input.value, source: "options" });
    const message = messageFor(result);
    show(message);
    if (message.kind === "status") {
      input.value = "";
      input.focus();
    }
  });

  input.addEventListener("input", () => {
    clearInvalid();
  });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") refresh();
  });

  await refresh();
}

if (typeof globalThis.chrome !== "undefined" && typeof document !== "undefined") {
  init({ chrome: globalThis.chrome, document });
}
