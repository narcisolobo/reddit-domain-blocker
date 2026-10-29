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

  async function refresh() {
    let items = {};
    try {
      items = await chrome.storage.sync.get(null);
    } catch {
      items = {};
    }
    renderList(listEl, recordsFromItems(items), { onRemove });
  }

  async function onRemove(domain) {
    const buttons = [...listEl.querySelectorAll(".btn-remove")];
    const index = buttons.findIndex((b) => b.dataset.domain === domain);
    const result = await send({ type: "domain/archive", domain });
    const message = messageFor(result);
    show(message);
    if (message.kind !== "status") return;
    await refresh();
    const after = [...listEl.querySelectorAll(".btn-remove")];
    const target = after[index] ?? after[after.length - 1] ?? input;
    target.focus();
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
