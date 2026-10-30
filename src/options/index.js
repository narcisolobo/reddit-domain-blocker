import { icon } from "../shared/icons.js";
import { recordsFromItems } from "../shared/records.js";
import { statsFromItems, STATS_PREFIX } from "../shared/stats.js";
import { buildExport, exportFilename, parseImport, planImport } from "../shared/transfer.js";
import { clearImportReview, MAX_IMPORT_BYTES, renderImportReview } from "./import-view.js";
import { messageFor, renderArchived, renderList, updateCounts } from "./view.js";

export async function init(env) {
  const { chrome, document } = env;
  const form = document.getElementById("add-form");
  const input = document.getElementById("domain-input");
  const addButton = document.getElementById("add-button");
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error");
  const actionErrorEl = document.getElementById("action-error");
  const listEl = document.getElementById("list");
  const archivedEl = document.getElementById("archived-list");
  const archivedHeading = document.getElementById("archived-heading");

  addButton.innerHTML = `${icon("plus")}<span>Add</span>`;
  errorEl.id = "error";
  const exportButton = document.getElementById("export-button");
  const importButton = document.getElementById("import-button");
  exportButton.setAttribute("aria-label", "Export list");
  exportButton.title = "Download your list as a JSON file";
  exportButton.innerHTML = `${icon("download")}<span>Export list</span>`;
  importButton.setAttribute("aria-label", "Import list…");
  importButton.title = "Load a list from an exported JSON file";
  importButton.innerHTML = `${icon("upload")}<span>Import list…</span>`;

  // One message shows at a time. The Add form's errors (`field`) sit under the
  // input and mark it invalid; everything else goes in the region under the title.
  function show(message, { field = false } = {}) {
    statusEl.textContent = "";
    errorEl.textContent = "";
    actionErrorEl.textContent = "";
    if (message.kind === "error" && field) {
      errorEl.textContent = message.text;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", errorEl.id);
      return;
    }
    clearInvalid();
    if (message.kind === "error") actionErrorEl.textContent = message.text;
    else statusEl.textContent = message.text;
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
          ? messageFor({ ok: true, domain, outcome: "deleted" })
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

  exportButton.addEventListener("click", async () => {
    try {
      // Read fresh rather than trusting the last render.
      const [syncItems, localItems] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]);
      const data = buildExport(recordsFromItems(syncItems), statsFromItems(localItems), {
        now: Date.now(),
        version: chrome.runtime.getManifest().version,
      });
      const { URL, Blob } = document.defaultView;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(Date.parse(data.exportedAt));
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      show(messageFor({ ok: true, outcome: "exported", count: data.domains.length }));
    } catch {
      show(messageFor(undefined));
    }
  });

  const fileInput = document.getElementById("import-file");
  const reviewEl = document.getElementById("import-review");

  let pickToken = 0;

  function closeReview() {
    pickToken++;
    clearImportReview(reviewEl);
    importButton.focus();
  }

  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = "";
    const mine = ++pickToken;
    clearImportReview(reviewEl);
    if (file.size > MAX_IMPORT_BYTES) return show(messageFor({ ok: false, reason: "file-too-big" }));
    let text;
    try {
      text = await file.text();
    } catch {
      if (mine !== pickToken) return;
      return show(messageFor({ ok: false, reason: "unreadable" }));
    }
    if (mine !== pickToken) return;
    const parsed = parseImport(text);
    const refusal = !parsed.ok ? parsed.reason : parsed.entries.length === 0 ? "nothing-to-import" : null;
    if (refusal) return show(messageFor({ ok: false, reason: refusal }));
    const plan = planImport(lastRecords, lastStats, parsed.entries, "larger");
    let sending = false;
    renderImportReview(reviewEl, { added: plan.added, merged: plan.merged, skipped: parsed.skipped }, {
      onCancel: closeReview,
      onImport: async (countMode) => {
        if (sending) return;
        sending = true;
        for (const b of reviewEl.querySelectorAll("button")) b.disabled = true;
        const result = await send({ type: "domain/import", text, countMode });
        sending = false;
        show(messageFor(result));
        if (mine !== pickToken) return;
        pickToken++;
        clearImportReview(reviewEl);
        importButton.focus();
      },
    });
    document.getElementById("import-heading").focus();
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
