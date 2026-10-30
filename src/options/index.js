import { icon } from "../shared/icons.js";
import { recordsFromItems } from "../shared/records.js";
import { statsFromItems, STATS_PREFIX } from "../shared/stats.js";
import { messageFor, renderArchived, renderList, updateCounts } from "./view.js";

export async function init(env) {
  const { chrome, document } = env;
  const form = document.getElementById("add-form");
  const input = document.getElementById("domain-input");
  const addButton = document.getElementById("add-button");
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error");
  const listEl = document.getElementById("list");
  const archivedEl = document.getElementById("archived-list");
  const archivedHeading = document.getElementById("archived-heading");

  addButton.innerHTML = `${icon("plus")}<span>Add</span>`;
  errorEl.id = "error";

  // Only the Add form's errors (`field`) mark the domain input invalid.
  function show(message, { field = false } = {}) {
    if (message.kind === "error") {
      statusEl.textContent = "";
      errorEl.textContent = message.text;
      if (field) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", errorEl.id);
      }
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
  let statsSeq = 0;
  let latest = Promise.resolve();
  let lastRows = { remove: [], restore: [], delete: [] };
  let pendingFocus = null;
  let confirming = null;
  // Domains with a row action awaiting its response; repeats are ignored.
  const inFlight = new Set();
  let lastRecords = [];
  let lastStats = new Map();

  const FALLBACK = {
    remove: () => input,
    restore: () => archivedHeading,
    delete: () => archivedHeading,
    confirm: () => archivedHeading,
    cancel: () => archivedHeading,
  };

  function buttonsFor(action) {
    const root = action === "remove" ? listEl : archivedEl;
    return [...root.querySelectorAll(`button[data-action="${action}"]`)];
  }

  function currentRows() {
    const rows = {};
    for (const action of ["remove", "restore", "delete"]) {
      rows[action] = buttonsFor(action).map((b) => b.dataset.domain);
    }
    return rows;
  }

  function focusedPair() {
    const active = document.activeElement;
    if (!active || !(listEl.contains(active) || archivedEl.contains(active))) return null;
    const btn = active.closest("button[data-action]");
    return btn ? { domain: btn.dataset.domain, action: btn.dataset.action } : null;
  }

  // Render both tables, keeping focus on the same (domain, action) button. If
  // that row is gone, fall back to the same action in the next row, then the
  // previous row, then the section default. Focus outside the tables is never
  // touched.
  function render(records, nextStats) {
    const before = lastRows;
    lastRecords = records;
    lastStats = nextStats;
    if (confirming !== null && !records.some((r) => r.domain === confirming && r.status === "archived")) {
      confirming = null;
    }
    // A pending action only decides focus until a render has dropped that
    // row; later renders (e.g. the second of onChanged + awaited refresh)
    // keep whatever already has focus.
    const key =
      pendingFocus !== null && (before[pendingFocus.action] ?? []).includes(pendingFocus.domain)
        ? pendingFocus
        : focusedPair();
    renderList(listEl, records, nextStats, { onRemove });
    renderArchived(archivedEl, records, nextStats, { onRestore, onDelete, onConfirm, onCancel }, confirming);
    lastRows = currentRows();
    if (key === null) return;
    const buttons = buttonsFor(key.action);
    const domains = buttons.map((b) => b.dataset.domain);
    let target = buttons[domains.indexOf(key.domain)];
    if (!target) {
      const prior = before[key.action] ?? [];
      const at = prior.indexOf(key.domain);
      const later = at < 0 ? [] : prior.slice(at + 1);
      const earlier = at < 0 ? [] : prior.slice(0, at).reverse();
      const found = [...later, ...earlier].find((d) => domains.includes(d));
      target = found !== undefined ? buttons[domains.indexOf(found)] : (FALLBACK[key.action] ?? FALLBACK.restore)();
    }
    target.focus();
  }

  async function readArea(area) {
    try {
      return await area.get(null);
    } catch {
      return {};
    }
  }

  function refresh() {
    const mine = ++seq;
    ++statsSeq;
    const run = (async () => {
      const [syncItems, localItems] = await Promise.all([
        readArea(chrome.storage.sync),
        readArea(chrome.storage.local),
      ]);
      if (mine !== seq) return;
      const fresh = statsFromItems(localItems);
      render(recordsFromItems(syncItems), fresh);
    })();
    latest = run;
    return run;
  }

  async function refreshCounts() {
    const mine = ++statsSeq;
    const items = await readArea(chrome.storage.local);
    if (mine !== statsSeq) return;
    lastStats = statsFromItems(items);
    updateCounts(document, lastStats);
  }

  async function act(domain, action, type) {
    if (inFlight.has(domain)) return;
    inFlight.add(domain);
    pendingFocus = { domain, action };
    try {
      const result = await send({ type, domain });
      const message = messageFor(result);
      show(message);
      if (message.kind !== "status") return;
      await refresh();
      await latest;
    } finally {
      inFlight.delete(domain);
      pendingFocus = null;
    }
  }

  const onRemove = (domain) => act(domain, "remove", "domain/archive");
  const onRestore = (domain) => act(domain, "restore", "domain/restore");

  function focusDelete(domain) {
    buttonsFor("delete").find((b) => b.dataset.domain === domain)?.focus();
  }

  function onDelete(domain) {
    confirming = domain;
    render(lastRecords, lastStats);
    buttonsFor("confirm").find((b) => b.dataset.domain === domain)?.focus();
  }

  function onCancel(domain) {
    if (inFlight.has(domain)) return;
    confirming = null;
    render(lastRecords, lastStats);
    focusDelete(domain);
  }

  async function onConfirm(domain) {
    if (inFlight.has(domain)) return;
    inFlight.add(domain);
    // On success the row disappears and focus moves via the Restore chain.
    pendingFocus = { domain, action: "restore" };
    try {
      const result = await send({ type: "domain/delete", domain });
      // Already gone (e.g. deleted from another tab) is the outcome we wanted.
      const message =
        result?.ok === false && result.reason === "not-found"
          ? { kind: "status", text: `Deleted ${domain} permanently` }
          : messageFor(result);
      confirming = null;
      show(message);
      if (message.kind !== "status") {
        render(lastRecords, lastStats);
        focusDelete(domain);
        return;
      }
      await refresh();
      await latest;
    } finally {
      inFlight.delete(domain);
      pendingFocus = null;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await send({ type: "domain/add", input: input.value, source: "options" });
    const message = messageFor(result);
    show(message, { field: true });
    if (message.kind === "status") {
      input.value = "";
      input.focus();
    }
  });

  input.addEventListener("input", () => {
    clearInvalid();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") refresh();
    else if (area === "local" && Object.keys(changes ?? {}).some((k) => k.startsWith(STATS_PREFIX))) {
      refreshCounts();
    }
  });

  await refresh();
}

if (typeof globalThis.chrome !== "undefined" && typeof document !== "undefined") {
  init({ chrome: globalThis.chrome, document });
}
