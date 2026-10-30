import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { messageFor, renderList, renderArchived } from "../src/options/view.js";
import { init } from "../src/options/index.js";
import { skipText, renderImportReview, MAX_IMPORT_BYTES } from "../src/options/import-view.js";
import { handleMessage } from "../src/background/blocklist.js";

const HTML = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");

// A data cell's value, without its stacked-layout label.
const cellValue = (td) => td.textContent.replace(td.querySelector(".cell-label")?.textContent ?? "", "");

function rec(domain, status = "active") {
  return {
    domain,
    status,
    addedAt: 1,
    updatedAt: 1,
    archivedAt: status === "archived" ? 2 : null,
    source: "options",
  };
}

function stored(status = "active") {
  return status === "active"
    ? { s: "a", c: 1, u: 1, o: "o" }
    : { s: "x", c: 1, u: 1, x: 2, o: "o" };
}

function page() {
  const dom = new JSDOM(HTML);
  return { dom, document: dom.window.document };
}

async function setup(items = {}, { changeDelay = 0 } = {}) {
  const chrome = createFakeChrome();
  if (changeDelay) {
    const add = chrome.storage.onChanged.addListener;
    chrome.storage.onChanged.addListener = (fn) =>
      add((changes, area) => setTimeout(() => fn(changes, area), changeDelay));
  }
  await chrome.storage.sync.set(items);
  chrome.runtime.setMessageHandler((msg) => handleMessage(msg, { sync: chrome.storage.sync, local: chrome.storage.local }));
  const { dom, document } = page();
  await init({ chrome, document });
  return { chrome, dom, document };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 5; i++) await tick();
}

test("messageFor covers every ok outcome", () => {
  assert.deepEqual(messageFor({ ok: true, domain: "thedailybeast.com", outcome: "added" }), { kind: "status", text: "Added thedailybeast.com" });
  assert.deepEqual(messageFor({ ok: true, domain: "example.com", outcome: "restored" }), { kind: "status", text: "Restored example.com" });
  assert.deepEqual(messageFor({ ok: true, domain: "example.com", outcome: "exists" }), { kind: "status", text: "example.com is already on the list" });
  assert.deepEqual(messageFor({ ok: true, domain: "example.com", outcome: "archived" }), { kind: "status", text: "Removed example.com" });
  assert.deepEqual(messageFor({ ok: true, domain: "example.com", outcome: "already-archived" }), { kind: "status", text: "Removed example.com" });
  assert.deepEqual(messageFor({ ok: true, domain: "example.com", outcome: "deleted" }), { kind: "status", text: "Deleted example.com permanently" });
});

test("messageFor covers every failure reason with kind error", () => {
  const expected = {
    invalid: "That doesn't look like a web address. Try something like example.com.",
    protected: "Reddit's own domains can't be blocked.",
    ip: "IP addresses can't be blocked. Use a domain name.",
    "single-label": "That needs a full domain, like example.com.",
    empty: "Type or paste a domain or web address.",
    quota: "The list is full. Remove some domains and try again.",
    error: "Something went wrong. Please try again.",
  };
  for (const [reason, text] of Object.entries(expected)) {
    assert.deepEqual(messageFor({ ok: false, reason }), { kind: "error", text });
  }
  assert.deepEqual(messageFor({ ok: false, reason: "not-found", domain: "example.com" }), { kind: "error", text: "example.com isn't on the list." });
  assert.deepEqual(messageFor({ ok: false, reason: "not-archived", domain: "example.com" }), { kind: "error", text: "example.com is blocked again, so it wasn't deleted." });
});

test("messageFor is total: unknown reason, missing reason, non-objects", () => {
  const generic = { kind: "error", text: "Something went wrong. Please try again." };
  assert.deepEqual(messageFor({ ok: false, reason: "weird" }), generic);
  assert.deepEqual(messageFor({ ok: false }), generic);
  assert.deepEqual(messageFor({ ok: false, reason: "toString" }), generic);
  assert.deepEqual(messageFor({ ok: true, outcome: "nope" }), generic);
  assert.deepEqual(messageFor(undefined), generic);
  assert.deepEqual(messageFor(null), generic);
  assert.deepEqual(messageFor("x"), generic);
});

test("renderList shows active domains only, sorted, named by heading and th scope=col", () => {
  const { document } = page();
  const root = document.getElementById("list");
  renderList(root, [rec("zeta.com"), rec("old.com", "archived"), rec("alpha.com")], new Map(), { onRemove() {} });
  const cells = [...root.querySelectorAll("td.domain")].map(cellValue);
  assert.deepEqual(cells, ["alpha.com", "zeta.com"]);
  assert.equal(root.querySelector("table").getAttribute("aria-labelledby"), "active-heading");
  const ths = [...root.querySelectorAll("th")];
  assert.equal(ths.length, 3);
  assert.ok(ths.every((th) => th.getAttribute("scope") === "col"));
  assert.equal(ths[0].textContent, "Domain");
  assert.equal(ths[1].textContent, "Posts hidden");
  assert.equal(ths[2].textContent, "Actions");
  assert.ok(ths[2].querySelector(".visually-hidden"));
});

test("Remove button has text, aria-label, title, hidden svg, and calls onRemove", () => {
  const { document } = page();
  const root = document.getElementById("list");
  const removed = [];
  renderList(root, [rec("example.com")], new Map(), { onRemove: (d) => removed.push(d) });
  const btn = root.querySelector("button");
  assert.equal(btn.textContent.trim(), "Remove");
  assert.equal(btn.getAttribute("aria-label"), "Remove example.com");
  assert.equal(btn.getAttribute("title"), "Remove example.com");
  assert.equal(btn.querySelector("svg").getAttribute("aria-hidden"), "true");
  btn.click();
  assert.deepEqual(removed, ["example.com"]);
});

test("empty list shows the empty state and no table", () => {
  const { document } = page();
  const root = document.getElementById("list");
  renderList(root, [rec("old.com", "archived")], new Map(), { onRemove() {} });
  assert.equal(root.querySelector("table"), null);
  assert.match(root.textContent, /No blocked domains yet\. Paste one above, or right-click an outgoing link on Reddit/);
});

test("page shell: lang, title, one h1, main, label for input, live regions", () => {
  const { document } = page();
  assert.equal(document.documentElement.lang, "en");
  assert.equal(document.title, "Reddit Domain Blocker options");
  assert.equal(document.querySelectorAll("h1").length, 1);
  assert.ok(document.querySelector("main form"));
  const label = document.querySelector('label[for="domain-input"]');
  assert.equal(label.textContent, "Domain or URL");
  assert.ok(document.getElementById("domain-input"));
  assert.ok(document.querySelector('[role="status"]'));
  assert.ok(document.querySelector('[role="alert"]'));
  assert.equal(document.querySelectorAll("script[src]").length, 1);
  assert.equal(document.querySelectorAll("script:not([src])").length, 0);
});

test("page messages sit between the title and the form; field errors stay under the input", () => {
  const { document } = page();
  const h1 = document.querySelector("h1");
  const form = document.getElementById("add-form");
  const notices = document.querySelector(".notices");
  assert.equal(h1.nextElementSibling, notices);
  assert.equal(notices.nextElementSibling, form);
  assert.equal(document.getElementById("status").getAttribute("role"), "status");
  assert.equal(document.getElementById("action-error").getAttribute("role"), "alert");
  assert.equal(document.getElementById("status").parentElement, notices);
  assert.equal(document.getElementById("action-error").parentElement, notices);
  assert.equal(document.getElementById("error").getAttribute("role"), "alert");
  assert.equal(form.nextElementSibling, document.getElementById("error"));
});

test("submitting sends domain/add with source options; success clears input and keeps focus", async () => {
  const { chrome, dom, document } = await setup();
  const sent = [];
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m) => (sent.push(m), original(m));
  const input = document.getElementById("domain-input");
  document.body.append(); // keep document alive
  input.value = "https://TheDailyBeast.com/story";
  input.focus();
  document.querySelector("form button[type=submit]").click();
  await settle();
  assert.deepEqual(sent, [{ type: "domain/add", input: "https://TheDailyBeast.com/story", source: "options" }]);
  assert.equal(document.getElementById("status").textContent, "Added thedailybeast.com");
  assert.equal(document.getElementById("error").textContent, "");
  assert.equal(input.value, "");
  assert.equal(document.activeElement, input);
  assert.deepEqual([...document.querySelectorAll("td.domain")].map(cellValue), ["thedailybeast.com"]);
  dom.window.close();
});

test("Enter in the input submits the form", async () => {
  const { chrome, document, dom } = await setup();
  const sent = [];
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m) => (sent.push(m), original(m));
  const input = document.getElementById("domain-input");
  input.value = "example.com";
  input.focus();
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const form = document.getElementById("add-form");
  // jsdom has no implicit submission; the form must have a submit button so browsers do.
  assert.ok(form.querySelector('button[type="submit"]'));
  form.requestSubmit();
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "domain/add");
});

test("a rejected input sets aria-invalid and aria-describedby, announced in role=alert; status empty", async () => {
  const { document } = await setup();
  const input = document.getElementById("domain-input");
  input.value = "localhost";
  document.querySelector("form button[type=submit]").click();
  await settle();
  const alert = document.getElementById("error");
  assert.equal(alert.textContent, "That needs a full domain, like example.com.");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(input.getAttribute("aria-describedby"), alert.id);
  assert.ok(alert.id);
  assert.equal(document.querySelector('[role="status"]').textContent, "");
  assert.equal(input.value, "localhost");

  input.value = "localhos";
  input.dispatchEvent(new input.ownerDocument.defaultView.Event("input", { bubbles: true }));
  assert.equal(input.hasAttribute("aria-invalid"), false);
  assert.equal(input.hasAttribute("aria-describedby"), false);
});

test("a later success clears invalid state and empties the alert region", async () => {
  const { document } = await setup();
  const input = document.getElementById("domain-input");
  input.value = "localhost";
  document.querySelector("form button[type=submit]").click();
  await settle();
  input.value = "example.com";
  document.querySelector("form button[type=submit]").click();
  await settle();
  assert.equal(input.hasAttribute("aria-invalid"), false);
  assert.equal(document.getElementById("error").textContent, "");
  assert.equal(document.querySelector('[role="status"]').textContent, "Added example.com");
});

test("a rejected sendMessage shows the generic error, no uncaught exception", async () => {
  const { chrome, document } = await setup();
  chrome.runtime.sendMessage = async () => {
    throw new Error("Could not establish connection.");
  };
  document.getElementById("domain-input").value = "example.com";
  document.querySelector("form button[type=submit]").click();
  await settle();
  assert.equal(document.getElementById("error").textContent, "Something went wrong. Please try again.");
  assert.equal(document.getElementById("domain-input").getAttribute("aria-invalid"), "true");
});

test("clicking Remove sends domain/archive, announces Removed, focuses next Remove button", async () => {
  const { chrome, document } = await setup({
    "d:a.com": stored(),
    "d:b.com": stored(),
    "d:c.com": stored(),
  });
  const sent = [];
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m) => (sent.push(m), original(m));
  document.querySelector('button[aria-label="Remove a.com"]').click();
  await settle();
  assert.deepEqual(sent, [{ type: "domain/archive", domain: "a.com" }]);
  assert.equal(document.querySelector('[role="status"]').textContent, "Removed a.com");
  assert.equal(document.activeElement.getAttribute("aria-label"), "Remove b.com");
});

test("removing the last row focuses the previous Remove button; removing the only row focuses the input", async () => {
  const { document } = await setup({ "d:a.com": stored(), "d:b.com": stored() });
  document.querySelector('button[aria-label="Remove b.com"]').click();
  await settle();
  assert.equal(document.activeElement.getAttribute("aria-label"), "Remove a.com");
  document.querySelector('button[aria-label="Remove a.com"]').click();
  await settle();
  assert.equal(document.activeElement, document.getElementById("domain-input"));
  assert.match(document.getElementById("list").textContent, /No blocked domains yet/);
});

test("an external storage change re-renders the list without a reload", async () => {
  const { chrome, document } = await setup();
  assert.equal(document.querySelector("table"), null);
  await chrome.storage.sync.set({ "d:elsewhere.com": stored() });
  await settle();
  assert.deepEqual([...document.querySelectorAll("td.domain")].map(cellValue), ["elsewhere.com"]);
});

test("a malformed record in storage is ignored", async () => {
  const { document } = await setup({
    "d:good.com": stored(),
    "d:bad.com": { nonsense: true },
    "d:worse.com": "string",
    "d:nul.com": null,
    "other": { s: "a" },
  });
  assert.deepEqual([...document.querySelectorAll("td.domain")].map(cellValue), ["good.com"]);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("delayed onChanged after Remove ends with focus on the right Remove button", async () => {
  const { document } = await setup({ "d:a.com": stored(), "d:b.com": stored(), "d:c.com": stored() }, { changeDelay: 20 });
  const btn = document.querySelector('button[aria-label="Remove a.com"]');
  btn.focus();
  btn.click();
  await sleep(80);
  assert.equal(document.activeElement.getAttribute("aria-label"), "Remove b.com");
  document.querySelector('button[aria-label="Remove c.com"]').focus();
  document.querySelector('button[aria-label="Remove c.com"]').click();
  await sleep(80);
  assert.equal(document.activeElement.getAttribute("aria-label"), "Remove b.com");
  document.querySelector('button[aria-label="Remove b.com"]').click();
  await sleep(80);
  assert.equal(document.activeElement, document.getElementById("domain-input"));
});

test("an external storage change keeps focus on the focused Remove button", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored(), "d:c.com": stored() });
  document.querySelector('button[aria-label="Remove c.com"]').focus();
  await chrome.storage.sync.set({ "d:b.com": stored() });
  await settle();
  assert.equal(document.querySelectorAll("td.domain").length, 3);
  assert.equal(document.activeElement.getAttribute("aria-label"), "Remove c.com");
});

test("an external storage change does not steal focus or clear typed text in the input", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored() });
  const input = document.getElementById("domain-input");
  input.focus();
  input.value = "partial.co";
  await chrome.storage.sync.set({ "d:b.com": stored() });
  await settle();
  assert.equal(document.querySelectorAll("td.domain").length, 2);
  assert.equal(document.activeElement, input);
  assert.equal(input.value, "partial.co");
});

test("an externally removed focused row moves focus to the next row", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored(), "d:b.com": stored() });
  document.querySelector('button[aria-label="Remove a.com"]').focus();
  await chrome.storage.sync.remove("d:a.com");
  await settle();
  assert.equal(document.activeElement.getAttribute("aria-label"), "Remove b.com");
});

test("a slower earlier storage read does not overwrite a newer one", async () => {
  const chrome = createFakeChrome();
  await chrome.storage.sync.set({ "d:old.com": stored() });
  const realGet = chrome.storage.sync.get.bind(chrome.storage.sync);
  let calls = 0;
  let releaseSlow;
  chrome.storage.sync.get = async (keys) => {
    calls += 1;
    const snapshot = await realGet(keys);
    if (calls === 2) await new Promise((r) => (releaseSlow = r));
    return snapshot;
  };
  const { document } = page();
  await init({ chrome, document }); // call 1
  const set = chrome.storage.sync.set({ "d:slow.com": stored() }); // onChanged -> call 2 (stuck)
  await set;
  await settle();
  await chrome.storage.sync.set({ "d:fast.com": stored() }); // call 3 (newer, completes)
  await settle();
  releaseSlow();
  await settle();
  const domains = [...document.querySelectorAll("td.domain")].map(cellValue);
  assert.deepEqual(domains, ["fast.com", "old.com", "slow.com"]);
});

// ---- M2 Task 4: counts, Archived section, Restore ----

const stat = (n) => ({ blockedCount: n, lastBlockedAt: 5 });
const countOf = (document, d) => document.querySelector(`[data-count-for="${d}"] .count-value`).textContent;

test("active table shows Posts hidden from local stats, 0 when missing", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored(), "d:b.com": stored() });
  await chrome.storage.local.set({ "stats:a.com": stat(12) });
  await settle();
  assert.equal(countOf(document, "a.com"), "12");
  assert.equal(countOf(document, "b.com"), "0");
  assert.equal(document.querySelector('td.count[data-count-for="a.com"]').className, "count");
});

test("archived table: heading name, th scope=col, time datetime, counts, Restore button names", async () => {
  const { document } = await setup({ "d:old.com": stored("archived") });
  const root = document.getElementById("archived-list");
  assert.equal(root.querySelector("table").getAttribute("aria-labelledby"), "archived-heading");
  const ths = [...root.querySelectorAll("th")];
  assert.deepEqual(ths.map((t) => t.textContent), ["Domain", "Archived", "Posts hidden", "Actions"]);
  assert.ok(ths.every((t) => t.getAttribute("scope") === "col"));
  const time = root.querySelector("time");
  assert.equal(time.getAttribute("datetime"), new Date(2).toISOString());
  assert.equal(time.textContent, new Date(2).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
  assert.equal(countOf(document, "old.com"), "0");
  const btn = root.querySelector('button[data-action="restore"]');
  assert.equal(btn.dataset.domain, "old.com");
  assert.equal(btn.textContent.trim(), "Restore");
  assert.equal(btn.getAttribute("aria-label"), "Restore old.com");
  assert.equal(btn.getAttribute("title"), "Restore old.com");
  assert.equal(btn.querySelector("svg").getAttribute("aria-hidden"), "true");
  assert.ok(root.querySelector('button[data-action="delete"]'));
});

test("renderArchived sorts by domain and wires handlers", () => {
  const { document } = page();
  const root = document.getElementById("archived-list");
  const calls = [];
  renderArchived(root, [rec("z.com", "archived"), rec("a.com", "archived"), rec("live.com")], new Map(), {
    onRestore: (d) => calls.push(["restore", d]),
    onDelete: (d) => calls.push(["delete", d]),
  }, null);
  assert.deepEqual([...root.querySelectorAll("td.domain")].map(cellValue), ["a.com", "z.com"]);
  root.querySelector('button[data-action="restore"]').click();
  root.querySelector('button[data-action="delete"]').click();
  assert.deepEqual(calls, [["restore", "a.com"], ["delete", "a.com"]]);
});

test("no archived records shows 'No archived domains.' and keeps the Archived heading", async () => {
  const { document } = await setup({ "d:a.com": stored() });
  const root = document.getElementById("archived-list");
  assert.equal(root.querySelector("p.empty").textContent, "No archived domains.");
  assert.equal(root.querySelector("table"), null);
  assert.ok(document.getElementById("archived-heading"));
});

test("page shell has h1 then two h2s, Archived heading is focusable with tabindex -1", () => {
  const { document } = page();
  const heads = [...document.querySelectorAll("h1, h2")].map((h) => [h.tagName, h.textContent]);
  assert.deepEqual(heads, [["H1", "Reddit Domain Blocker"], ["H2", "Blocked domains"], ["H2", "Archived"]]);
  const h = document.getElementById("archived-heading");
  assert.equal(h.getAttribute("tabindex"), "-1");
  assert.equal(document.querySelector('section[aria-labelledby="archived-heading"]').contains(h), true);
  assert.equal(document.querySelector('section[aria-labelledby="active-heading"]').contains(document.getElementById("list")), true);
});

test("Restore sends domain/restore, announces Restored, row moves to the active table", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  const sent = [];
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m) => (sent.push(m), original(m));
  document.querySelector('button[aria-label="Restore old.com"]').click();
  await settle();
  assert.deepEqual(sent, [{ type: "domain/restore", domain: "old.com" }]);
  assert.equal(document.querySelector('[role="status"]').textContent, "Restored old.com");
  assert.deepEqual([...document.querySelectorAll("#list td.domain")].map(cellValue), ["old.com"]);
  assert.equal(document.querySelector("#archived-list table"), null);
});

test("after Restore focus goes to the next archived Restore, else previous, else the Archived heading", async () => {
  const { document } = await setup({
    "d:a.com": stored("archived"),
    "d:b.com": stored("archived"),
    "d:c.com": stored("archived"),
  });
  const restore = (d) => document.querySelector(`button[aria-label="Restore ${d}"]`);
  restore("a.com").focus();
  restore("a.com").click();
  await settle();
  assert.equal(document.activeElement.getAttribute("aria-label"), "Restore b.com");
  restore("c.com").focus();
  restore("c.com").click();
  await settle();
  assert.equal(document.activeElement.getAttribute("aria-label"), "Restore b.com");
  restore("b.com").focus();
  restore("b.com").click();
  await settle();
  assert.equal(document.activeElement, document.getElementById("archived-heading"));
});

test("a stats change updates count cells in place: same table nodes, focus unchanged", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored(), "d:old.com": stored("archived") });
  const active = document.querySelector("#list table");
  const archived = document.querySelector("#archived-list table");
  const btn = document.querySelector('button[aria-label="Remove a.com"]');
  btn.focus();
  await chrome.storage.local.set({ "stats:a.com": stat(3), "stats:old.com": stat(9) });
  await settle();
  assert.equal(document.querySelector("#list table"), active);
  assert.equal(document.querySelector("#archived-list table"), archived);
  assert.equal(document.activeElement, btn);
  assert.equal(countOf(document, "a.com"), "3");
  assert.equal(countOf(document, "old.com"), "9");
});

test("a local change with no stats: keys does nothing", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored() });
  const table = document.querySelector("#list table");
  const cell = document.querySelector("td.count");
  let reads = 0;
  const realGet = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = (k) => (reads++, realGet(k));
  await chrome.storage.local.set({ "d:local.com": stored(), other: 1 });
  await settle();
  assert.equal(reads, 0);
  assert.equal(document.querySelector("#list table"), table);
  assert.equal(document.querySelector("td.count"), cell);
  assert.equal(document.querySelectorAll("td.domain").length, 1);
});

test("a malformed stats value shows 0 and does not throw", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored(), "d:b.com": stored(), "d:c.com": stored() });
  await chrome.storage.local.set({
    "stats:a.com": { blockedCount: -4, lastBlockedAt: null },
    "stats:b.com": "lots",
    "stats:c.com": { blockedCount: 1.5, lastBlockedAt: 1 },
  });
  await settle();
  for (const d of ["a.com", "b.com", "c.com"]) assert.equal(countOf(document, d), "0");
});

// ---- Two-step Delete permanently ----
const q = (document, label) => document.querySelector(`button[aria-label="${label}"]`);
const recordKeys = async (chrome) => Object.keys(await chrome.storage.sync.get(null)).sort();

function spySend(chrome) {
  const sent = [];
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m) => (sent.push(m), original(m));
  return sent;
}

test("first Delete click shows the confirm group, writes nothing, focuses Confirm", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  const sent = spySend(chrome);
  const before = await chrome.storage.sync.get(null);
  q(document, "Delete permanently: old.com").click();
  await settle();
  assert.deepEqual(sent, []);
  assert.deepEqual(await chrome.storage.sync.get(null), before);
  assert.equal(q(document, "Delete permanently: old.com"), null);
  const group = document.querySelector('[role="group"][aria-label="Confirm deleting old.com"]');
  assert.ok(group);
  assert.match(group.textContent, /Really delete\?/);
  const confirm = q(document, "Confirm delete of old.com");
  assert.equal(confirm.title, "Confirm delete of old.com");
  assert.equal(confirm.className.includes("btn-remove"), true);
  assert.match(confirm.textContent, /Confirm/);
  const cancel = q(document, "Cancel delete of old.com");
  assert.equal(cancel.title, "Cancel delete of old.com");
  assert.match(cancel.textContent, /Cancel/);
  assert.equal(confirm.classList.contains("btn-small"), true);
  assert.equal(cancel.classList.contains("btn-small"), true);
  assert.equal(document.activeElement, confirm);
  assert.ok(q(document, "Restore old.com"));
});

test("Confirm deletes: record and stats gone, 'Deleted x permanently' in role=status", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  await chrome.storage.local.set({ "stats:old.com": stat(4) });
  await settle();
  const sent = spySend(chrome);
  q(document, "Delete permanently: old.com").click();
  await settle();
  q(document, "Confirm delete of old.com").click();
  await settle();
  assert.deepEqual(sent, [{ type: "domain/delete", domain: "old.com" }]);
  assert.deepEqual(await recordKeys(chrome), []);
  assert.equal("stats:old.com" in (await chrome.storage.local.get(null)), false);
  assert.equal(document.querySelector('[role="status"]').textContent, "Deleted old.com permanently");
  assert.equal(document.querySelector("#archived-list table"), null);
});

test("Cancel and Escape restore the Delete button and focus it; nothing written", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  const sent = spySend(chrome);
  const before = await chrome.storage.sync.get(null);
  q(document, "Delete permanently: old.com").click();
  await settle();
  q(document, "Cancel delete of old.com").click();
  await settle();
  assert.equal(document.activeElement, q(document, "Delete permanently: old.com"));
  assert.equal(document.querySelector('[role="group"]'), null);

  q(document, "Delete permanently: old.com").click();
  await settle();
  const Ev = document.defaultView.KeyboardEvent;
  q(document, "Confirm delete of old.com").dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true }));
  await settle();
  assert.equal(document.activeElement, q(document, "Delete permanently: old.com"));

  q(document, "Delete permanently: old.com").click();
  await settle();
  q(document, "Cancel delete of old.com").dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true }));
  await settle();
  assert.equal(document.activeElement, q(document, "Delete permanently: old.com"));
  assert.deepEqual(sent, []);
  assert.deepEqual(await chrome.storage.sync.get(null), before);
});

test("after a confirmed delete focus goes to the next row's Restore, else previous, else the Archived heading", async () => {
  const { document } = await setup({
    "d:a.com": stored("archived"),
    "d:b.com": stored("archived"),
    "d:c.com": stored("archived"),
  });
  const del = async (d) => {
    q(document, `Delete permanently: ${d}`).click();
    await settle();
    q(document, `Confirm delete of ${d}`).click();
    await settle();
  };
  await del("a.com");
  assert.equal(document.activeElement.getAttribute("aria-label"), "Restore b.com");
  await del("c.com");
  assert.equal(document.activeElement.getAttribute("aria-label"), "Restore b.com");
  await del("b.com");
  assert.equal(document.activeElement, document.getElementById("archived-heading"));
});

test("only one row confirms at a time: Delete on row B closes row A's confirm", async () => {
  const { document } = await setup({ "d:a.com": stored("archived"), "d:b.com": stored("archived") });
  q(document, "Delete permanently: a.com").click();
  await settle();
  q(document, "Delete permanently: b.com").click();
  await settle();
  assert.equal(document.querySelectorAll('[role="group"]').length, 1);
  assert.ok(q(document, "Delete permanently: a.com"));
  assert.equal(document.activeElement, q(document, "Confirm delete of b.com"));
});

test("an open confirmation survives a stats update and an unrelated sync change", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored(), "d:old.com": stored("archived") });
  q(document, "Delete permanently: old.com").click();
  await settle();
  const confirm = q(document, "Confirm delete of old.com");
  await chrome.storage.local.set({ "stats:old.com": stat(7) });
  await settle();
  assert.equal(q(document, "Confirm delete of old.com"), confirm);
  assert.equal(document.activeElement, confirm);
  assert.equal(countOf(document, "old.com"), "7");
  await chrome.storage.sync.set({ "d:other.com": stored() });
  await settle();
  assert.ok(document.querySelector('[role="group"][aria-label="Confirm deleting old.com"]'));
  assert.equal(document.activeElement, q(document, "Confirm delete of old.com"));
});

test("a confirming domain restored elsewhere closes the confirmation without throwing", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  q(document, "Delete permanently: old.com").click();
  await settle();
  await chrome.storage.sync.set({ "d:old.com": stored() });
  await settle();
  assert.equal(document.querySelector('[role="group"]'), null);
  assert.ok(document.querySelector("#list td.domain"));
  // Archiving it again must show a plain Delete button, not a stale confirmation.
  await chrome.storage.sync.set({ "d:old.com": stored("archived") });
  await settle();
  assert.ok(q(document, "Delete permanently: old.com"));
  assert.equal(document.querySelector('[role="group"]'), null);
});

test("a failed delete shows role=alert and returns focus to Delete", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  q(document, "Delete permanently: old.com").click();
  await settle();
  chrome.runtime.sendMessage = async () => ({ ok: false, domain: "old.com", reason: "error" });
  q(document, "Confirm delete of old.com").click();
  await settle();
  assert.ok(document.getElementById("action-error").textContent.length > 0);
  assert.equal(document.querySelector('[role="group"]'), null);
  assert.equal(document.activeElement, q(document, "Delete permanently: old.com"));
});

test("a row-action error shows at the top, not under the input", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored("active") });
  chrome.runtime.sendMessage = async () => ({ ok: false, reason: "error" });
  q(document, "Remove a.com").click();
  await settle();
  assert.equal(document.getElementById("action-error").textContent, "Something went wrong. Please try again.");
  assert.equal(document.getElementById("error").textContent, "");
  assert.equal(document.getElementById("status").textContent, "");
});

test("a row-action error replaces a field error and clears the input's invalid state", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored("active") });
  const input = document.getElementById("domain-input");
  input.value = "localhost";
  document.querySelector("form button[type=submit]").click();
  await settle();
  assert.equal(input.getAttribute("aria-invalid"), "true");
  chrome.runtime.sendMessage = async () => ({ ok: false, reason: "error" });
  q(document, "Remove a.com").click();
  await settle();
  assert.equal(document.getElementById("error").textContent, "");
  assert.equal(input.hasAttribute("aria-invalid"), false);
  assert.equal(input.hasAttribute("aria-describedby"), false);
  assert.ok(document.getElementById("action-error").textContent.length > 0);
});

test("a field error clears an earlier row-action error", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored("active") });
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = async () => ({ ok: false, reason: "error" });
  q(document, "Remove a.com").click();
  await settle();
  chrome.runtime.sendMessage = original;
  document.getElementById("domain-input").value = "localhost";
  document.querySelector("form button[type=submit]").click();
  await settle();
  assert.equal(document.getElementById("action-error").textContent, "");
  assert.equal(document.getElementById("error").textContent, "That needs a full domain, like example.com.");
});

test("no window.confirm is called", async () => {
  const { dom, document } = await setup({ "d:old.com": stored("archived") });
  dom.window.confirm = () => {
    throw new Error("window.confirm used");
  };
  q(document, "Delete permanently: old.com").click();
  await settle();
  q(document, "Confirm delete of old.com").click();
  await settle();
  assert.equal(document.querySelector('[role="status"]').textContent, "Deleted old.com permanently");
});

test("counts patched by a stats update survive the Delete and Cancel re-renders", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  await chrome.storage.local.set({ "stats:old.com": stat(7) });
  await settle();
  q(document, "Delete permanently: old.com").click();
  await settle();
  assert.equal(countOf(document, "old.com"), "7");
  q(document, "Cancel delete of old.com").click();
  await settle();
  assert.equal(countOf(document, "old.com"), "7");
});

// ---- Final-review fixes ----
const slowDelete = (chrome) => {
  const sent = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = async (m) => {
    sent.push(m);
    await gate;
    return original(m);
  };
  return { sent, release };
};

test("a second Confirm click while the delete is in flight is ignored", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  const { sent, release } = slowDelete(chrome);
  q(document, "Delete permanently: old.com").click();
  await settle();
  const confirm = q(document, "Confirm delete of old.com");
  confirm.click();
  confirm.click();
  release();
  await settle();
  assert.equal(sent.filter((m) => m.type === "domain/delete").length, 1);
  assert.equal(document.querySelector('[role="status"]').textContent, "Deleted old.com permanently");
  assert.equal(document.getElementById("action-error").textContent, "");
  assert.equal(document.getElementById("domain-input").hasAttribute("aria-invalid"), false);
});

test("Cancel and Escape while the delete is in flight are ignored", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  const { sent, release } = slowDelete(chrome);
  q(document, "Delete permanently: old.com").click();
  await settle();
  q(document, "Confirm delete of old.com").click();
  q(document, "Cancel delete of old.com").click();
  q(document, "Confirm delete of old.com").dispatchEvent(
    new document.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.ok(document.querySelector('[role="group"]'));
  release();
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(document.querySelector('[role="status"]').textContent, "Deleted old.com permanently");
});

test("a not-found delete result is treated as already gone", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  q(document, "Delete permanently: old.com").click();
  await settle();
  chrome.runtime.sendMessage = async () => ({ ok: false, domain: "old.com", reason: "not-found" });
  q(document, "Confirm delete of old.com").click();
  await settle();
  assert.equal(document.querySelector('[role="status"]').textContent, "Deleted old.com permanently");
  assert.equal(document.getElementById("action-error").textContent, "");
});

test("a double Restore sends one message", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  const { sent, release } = slowDelete(chrome);
  const restore = q(document, "Restore old.com");
  restore.click();
  restore.click();
  release();
  await settle();
  assert.equal(sent.length, 1);
});

test("a failed Remove, Restore or Delete leaves the domain input valid", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored("active"), "d:old.com": stored("archived") });
  const input = document.getElementById("domain-input");
  chrome.runtime.sendMessage = async () => ({ ok: false, reason: "error" });
  const check = () => {
    assert.ok(document.getElementById("action-error").textContent.length > 0);
    assert.equal(input.hasAttribute("aria-invalid"), false);
    assert.equal(input.hasAttribute("aria-describedby"), false);
  };
  q(document, "Remove a.com").click();
  await settle();
  check();
  q(document, "Restore old.com").click();
  await settle();
  check();
  q(document, "Delete permanently: old.com").click();
  await settle();
  q(document, "Confirm delete of old.com").click();
  await settle();
  check();
});

test("held Enter or Space (auto-repeat) on Confirm does not delete", async () => {
  const { chrome, document } = await setup({ "d:old.com": stored("archived") });
  const sent = spySend(chrome);
  q(document, "Delete permanently: old.com").click();
  await settle();
  const Ev = document.defaultView.KeyboardEvent;
  for (const key of ["Enter", " "]) {
    for (const label of ["Confirm delete of old.com", "Cancel delete of old.com"]) {
      const ev = new Ev("keydown", { key, repeat: true, bubbles: true, cancelable: true });
      q(document, label).dispatchEvent(ev);
      assert.equal(ev.defaultPrevented, true);
    }
  }
  const first = new Ev("keydown", { key: "Enter", bubbles: true, cancelable: true });
  q(document, "Confirm delete of old.com").dispatchEvent(first);
  assert.equal(first.defaultPrevented, false);
  await settle();
  assert.deepEqual(sent, []);
});

test("a stored record with an out-of-range timestamp does not break the Archived section", async () => {
  const { document } = await setup({
    "d:bad.com": { s: "x", c: 1, u: 1, x: 1e20, o: "o" },
    "d:old.com": stored("archived"),
  });
  assert.ok(q(document, "Restore old.com"));
  assert.equal(q(document, "Restore bad.com"), null);
});

test("Export list and Import list… buttons are grey outlined with icons, labels and tooltips", async () => {
  const { document } = await setup();
  const exp = document.getElementById("export-button");
  const imp = document.getElementById("import-button");
  for (const b of [exp, imp]) {
    assert.equal(b.type, "button");
    assert.ok(b.classList.contains("btn") && b.classList.contains("btn-restore"));
    assert.ok(b.querySelector("svg[aria-hidden='true']"));
  }
  assert.equal(exp.getAttribute("aria-label"), "Export list");
  assert.equal(exp.title, "Export list");
  assert.equal(exp.textContent.trim(), "Export list");
  assert.equal(imp.getAttribute("aria-label"), "Import list…");
  assert.equal(imp.title, "Import list…");
  assert.equal(imp.textContent.trim(), "Import list…");
  const file = document.getElementById("import-file");
  assert.equal(file.type, "file");
  assert.ok(file.hidden);
});

test("Export downloads every record as JSON and announces it", async () => {
  const { chrome, dom, document } = await setup({ "d:a.com": stored(), "d:b.com": stored("archived") });
  await chrome.storage.local.set({ "stats:a.com": { blockedCount: 3, lastBlockedAt: 5 } });
  const win = dom.window;
  let blob = null;
  const revoked = [];
  win.URL.createObjectURL = (b) => {
    blob = b;
    return "blob:fake-1";
  };
  win.URL.revokeObjectURL = (u) => revoked.push(u);
  const anchors = [];
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[download]");
    if (a) {
      anchors.push(a);
      e.preventDefault();
    }
  });
  const button = document.getElementById("export-button");
  button.focus();
  button.click();
  await settle();
  assert.equal(anchors.length, 1);
  assert.match(anchors[0].download, /^reddit-domain-blocker-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(blob.type, "application/json");
  const data = JSON.parse(
    await new Promise((resolve, reject) => {
      const reader = new win.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(blob);
    }),
  );
  assert.equal(data.extensionVersion, "0.1.0");
  assert.deepEqual(data.domains.map((d) => d.domain), ["a.com", "b.com"]);
  assert.equal(data.domains[0].blockedCount, 3);
  assert.equal(document.getElementById("status").textContent, "Exported 2 domains");
  await settle();
  assert.deepEqual(revoked, ["blob:fake-1"]);
  assert.equal(document.activeElement, button);
  assert.equal(document.querySelector("a[download]"), null);
});

test("Export shows the generic error when storage cannot be read", async () => {
  const { chrome, document } = await setup();
  chrome.storage.sync.get = async () => {
    throw new Error("boom");
  };
  document.getElementById("export-button").click();
  await settle();
  assert.equal(document.getElementById("action-error").textContent, "Something went wrong. Please try again.");
  assert.equal(document.getElementById("status").textContent, "");
});

test("messageFor exported pluralizes", () => {
  assert.deepEqual(messageFor({ ok: true, outcome: "exported", count: 1 }), { kind: "status", text: "Exported 1 domain" });
  assert.deepEqual(messageFor({ ok: true, outcome: "exported", count: 3 }), { kind: "status", text: "Exported 3 domains" });
  assert.deepEqual(messageFor({ ok: true, outcome: "exported", count: 0 }), { kind: "status", text: "Exported 0 domains" });
});

// ---- Import review ----

const D = "2024-01-01T00:00:00.000Z";
function entry(domain, extra = {}) {
  return { domain, status: "active", addedAt: D, updatedAt: D, archivedAt: null, blockedCount: 0, lastBlockedAt: null, source: "options", ...extra };
}
function exportJson(domains) {
  return JSON.stringify({ schemaVersion: 1, exportedAt: D, extensionVersion: "0.1.0", domains });
}
function pick(document, json, size = json.length) {
  const input = document.getElementById("import-file");
  const file = { name: "list.json", size, text: async () => json };
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new document.defaultView.Event("change"));
}
const importBtn = (document) => document.getElementById("import-button");
const review = (document) => document.getElementById("import-review");

test("picking a file shows the review with counts and skips, and focuses its heading", async () => {
  const { document } = await setup({ "d:a.com": stored() });
  importBtn(document).click();
  pick(document, exportJson([entry("a.com"), entry("b.com"), entry("reddit.com"), entry("not a domain")]));
  await settle();
  const root = review(document);
  const heading = root.querySelector("#import-heading");
  assert.equal(heading.textContent, "Review import");
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.equal(document.activeElement, heading);
  assert.equal(root.querySelector("section").getAttribute("aria-labelledby"), "import-heading");
  assert.equal(root.querySelector("section").getAttribute("aria-describedby"), "import-summary");
  assert.equal(root.querySelector("#import-summary").textContent, "1 new, 1 merged, 2 skipped");
  assert.equal(root.querySelector("p").textContent, "1 new, 1 merged, 2 skipped");
  const lines = [...root.querySelectorAll("li")].map((li) => li.textContent);
  assert.deepEqual(lines, ["reddit.com is a Reddit domain", "not a domain isn't a valid domain"]);
  assert.equal(document.getElementById("import-file").value, "");
  assert.equal(q(document, "Import").title, "Import");
  assert.equal(q(document, "Cancel import").title, "Cancel import");
  assert.ok(q(document, "Import").classList.contains("btn-restore"));
  assert.equal(root.querySelector("[role=status],[role=alert],[aria-live]"), null);
});

test("the count choice appears only when a domain is on both sides, larger by default", async () => {
  const { document } = await setup({ "d:a.com": stored() });
  pick(document, exportJson([entry("b.com")]));
  await settle();
  assert.equal(review(document).querySelector("fieldset"), null);
  pick(document, exportJson([entry("a.com")]));
  await settle();
  const fs = review(document).querySelector("fieldset");
  assert.equal(fs.querySelector("legend").textContent, "Counts for domains already on your list");
  const radios = [...fs.querySelectorAll("input[type=radio]")];
  assert.deepEqual(radios.map((r) => [r.name, r.value, r.checked]), [["count-mode", "larger", true], ["count-mode", "sum", false]]);
  assert.deepEqual([...fs.querySelectorAll("label")].map((l) => l.textContent.trim()), ["Use the larger count", "Add the two counts together"]);
});

test("Import sends domain/import with the text and the chosen mode, then announces the result", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored() });
  await chrome.storage.local.set({ "stats:a.com": { blockedCount: 2, lastBlockedAt: null } });
  const sent = [];
  chrome.runtime.setMessageHandler((msg) => {
    sent.push(msg);
    return handleMessage(msg, { sync: chrome.storage.sync, local: chrome.storage.local });
  });
  const json = exportJson([entry("a.com", { blockedCount: 3 }), entry("b.com")]);
  pick(document, json);
  await settle();
  review(document).querySelector("input[value=sum]").click();
  q(document, "Import").click();
  await settle();
  assert.deepEqual(sent, [{ type: "domain/import", text: json, countMode: "sum" }]);
  assert.equal(document.getElementById("status").textContent, "Imported: 1 new, 1 merged, 0 skipped.");
  assert.equal(review(document).innerHTML, "");
  assert.equal(document.activeElement, importBtn(document));
  assert.equal((await chrome.storage.local.get("stats:a.com"))["stats:a.com"].blockedCount, 5);
});

test("picking a new file clears the previous result from the page messages", async () => {
  const { document } = await setup();
  pick(document, exportJson([entry("b.com")]));
  await settle();
  q(document, "Import").click();
  await settle();
  assert.equal(document.getElementById("status").textContent, "Imported: 1 new, 0 merged, 0 skipped.");
  pick(document, exportJson([entry("c.com")]));
  await settle();
  assert.ok(review(document).querySelector("section"));
  assert.equal(document.getElementById("status").textContent, "");
  assert.equal(document.getElementById("action-error").textContent, "");
});

test("imported domains and counts appear without a reload", async () => {
  const { document } = await setup();
  pick(document, exportJson([entry("b.com", { blockedCount: 7 })]));
  await settle();
  q(document, "Import").click();
  await settle();
  assert.equal(countOf(document, "b.com"), "7");
  assert.ok(q(document, "Remove b.com"));
});

test("Cancel and Escape close the review, write nothing, and return focus to Import list…", async () => {
  const { chrome, document } = await setup();
  const before = JSON.stringify(await chrome.storage.sync.get(null));
  pick(document, exportJson([entry("b.com")]));
  await settle();
  q(document, "Cancel import").click();
  assert.equal(review(document).innerHTML, "");
  assert.equal(document.activeElement, importBtn(document));
  pick(document, exportJson([entry("b.com")]));
  await settle();
  q(document, "Import").focus();
  q(document, "Import").dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(review(document).innerHTML, "");
  assert.equal(document.activeElement, importBtn(document));
  assert.equal(JSON.stringify(await chrome.storage.sync.get(null)), before);
});

test("an unreadable or wrong-version file shows an alert and no review", async () => {
  const { document } = await setup();
  for (const json of ["", "{}", "[]", '{"schemaVersion":2,"domains":[]}']) {
    pick(document, json);
    await settle();
    assert.equal(review(document).innerHTML, "");
    assert.match(document.getElementById("action-error").textContent, /^That (file isn't a Reddit Domain Blocker export|export is from a different version of Reddit Domain Blocker)\. Nothing was imported\.$/);
    assert.equal(document.getElementById("status").textContent, "");
  }
  pick(document, exportJson([entry("reddit.com")]));
  await settle();
  assert.equal(review(document).innerHTML, "");
  assert.equal(document.getElementById("action-error").textContent, "Nothing to import: every entry in that file was skipped.");
});

test("a file over 1 MB is refused without being read", async () => {
  const { document } = await setup();
  const input = document.getElementById("import-file");
  const file = { name: "big.json", size: 1048577, text: async () => { throw new Error("read"); } };
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new document.defaultView.Event("change"));
  await settle();
  assert.equal(document.getElementById("action-error").textContent, "That file is too large to be an export. Nothing was imported.");
  assert.equal(review(document).innerHTML, "");
});

test("a refused import shows the overage", async () => {
  const { chrome, document } = await setup();
  chrome.runtime.setMessageHandler(async () => ({ ok: false, reason: "too-many", over: 3 }));
  pick(document, exportJson([entry("b.com")]));
  await settle();
  q(document, "Import").click();
  await settle();
  assert.equal(document.getElementById("action-error").textContent, "That import would go over Chrome's limit of 512 domains by 3. Nothing was imported.");
  assert.equal(review(document).innerHTML, "");
  assert.equal(document.activeElement, importBtn(document));
});

test("a status from the worker, not the preview, is what's announced", async () => {
  const { chrome, document } = await setup();
  pick(document, exportJson([entry("c.com")]));
  await settle();
  assert.equal(review(document).querySelector("p").textContent, "1 new, 0 merged, 0 skipped");
  await chrome.storage.sync.set({ "d:c.com": stored() });
  await settle();
  q(document, "Import").click();
  await settle();
  assert.equal(document.getElementById("status").textContent, "Imported: 0 new, 1 merged, 0 skipped.");
});

test("messageFor covers the import outcomes", () => {
  assert.equal(messageFor({ ok: false, reason: "too-large", over: 2049 }).text, "That import would go over Chrome's sync storage limit by about 3 KB. Nothing was imported.");
  assert.equal(messageFor({ ok: false, reason: "file-too-big" }).text, "That file is too large to be an export. Nothing was imported.");
  assert.equal(messageFor({ ok: false, reason: "nothing-to-import", skipped: 2 }).kind, "error");
  assert.equal(messageFor({ ok: false, reason: "nothing-to-import", skipped: 2 }).text, "Nothing to import: every entry in that file was skipped.");
  assert.equal(messageFor({ ok: false, reason: "nothing-to-import", skipped: 0 }).text, "That file has no domains in it. Nothing was imported.");
  assert.equal(messageFor({ ok: false, reason: "import-quota" }).text, "Chrome refused to save the import. Nothing was imported. Try again in a minute.");
});

test("an export with no domains says so instead of blaming skips", async () => {
  const { document } = await setup();
  pick(document, exportJson([]));
  await settle();
  assert.equal(document.getElementById("action-error").textContent, "That file has no domains in it. Nothing was imported.");
  assert.equal(review(document).innerHTML, "");
});

test("skipText reads naturally and the list stops at 10", () => {
  assert.equal(skipText({ index: 0, domain: "a.com", reason: "duplicate" }), "a.com appears more than once");
  assert.equal(skipText({ index: 4, domain: null, reason: "invalid-record" }), "Entry 5 has missing or invalid fields");
  assert.equal(skipText({ index: 0, domain: "x", reason: "invalid-domain" }), "x isn't a valid domain");
  assert.equal(skipText({ index: 0, domain: "a".repeat(300), reason: "invalid-domain" }), `${"a".repeat(80)}… isn't a valid domain`);
  const { document } = page();
  const root = document.getElementById("import-review");
  const skipped = Array.from({ length: 13 }, (_, i) => ({ index: i, domain: `d${i}`, reason: "protected" }));
  renderImportReview(root, { added: 0, merged: 0, skipped }, { onImport() {}, onCancel() {} });
  assert.equal(root.querySelectorAll("li").length, 11);
  assert.equal(root.querySelector("li:last-child").textContent, "and 3 more");
  assert.equal(MAX_IMPORT_BYTES, 1048576);
});

test("clicking Import twice sends one domain/import", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored() });
  let sends = 0;
  chrome.runtime.setMessageHandler((msg) => {
    sends++;
    return handleMessage(msg, { sync: chrome.storage.sync, local: chrome.storage.local });
  });
  pick(document, exportJson([entry("a.com", { blockedCount: 3 })]));
  await settle();
  const btn = q(document, "Import");
  btn.click();
  btn.click();
  await settle();
  assert.equal(sends, 1);
});

test("a slower earlier file pick does not replace a newer review", async () => {
  const { document } = await setup();
  const input = document.getElementById("import-file");
  const choose = (file) => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new document.defaultView.Event("change"));
  };
  let release;
  const slow = exportJson([entry("old.com")]);
  choose({ size: 10, text: () => new Promise((r) => (release = () => r(slow))) });
  choose({ size: 10, text: async () => exportJson([entry("new.com"), entry("new2.com")]) });
  await settle();
  release();
  await settle();
  assert.equal(review(document).querySelector("p").textContent, "2 new, 0 merged, 0 skipped");
});

// ---- Button names and CSS ----

const CSS = readFileSync(new URL("../extension/options.css", import.meta.url), "utf8");
function mediaBody(css, query) {
  const start = css.indexOf(`@media (${query})`);
  assert.notEqual(start, -1, `missing @media (${query})`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  assert.fail("unterminated media block");
}
function ruleFor(body, selectorPattern) {
  const m = [...body.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((r) => selectorPattern.test(r[1]));
  assert.ok(m, `no rule matching ${selectorPattern}`);
  return { selector: m[1], decls: m[2] };
}

test("every button has an icon, a visible label, a title, and an aria-label containing the label", async () => {
  const { document } = await setup({ "d:a.com": stored(), "d:old.com": stored("archived") });
  q(document, "Delete permanently: old.com").click();
  await settle();
  pick(document, exportJson([entry("b.com")]));
  await settle();
  const buttons = [...document.querySelectorAll("button")];
  assert.ok(buttons.length >= 7);
  for (const b of buttons) {
    const label = b.querySelector("span")?.textContent ?? "";
    assert.ok(b.querySelector("svg[aria-hidden=true]"), `${label}: icon`);
    assert.ok(label.length > 0, "visible label");
    assert.ok(b.title.length > 0, `${label}: title`);
    assert.equal(b.title, b.getAttribute("aria-label"), `${label}: title equals aria-label`);
    assert.ok(b.getAttribute("aria-label")?.includes(label), `${label}: aria-label contains label`);
  }
});

test("options.css hides button text and enlarges targets at 412px, including btn-small", () => {
  const body = mediaBody(CSS, "max-width: 412px");
  assert.match(ruleFor(body, /\.btn\s*>\s*span/).decls, /display:\s*none/);
  const target = ruleFor(body, /\.btn-small/);
  assert.match(target.selector, /(^|,)\s*\.btn\s*(,|$)/);
  assert.match(target.decls, /min-width:\s*44px/);
  assert.match(target.decls, /min-height:\s*44px/);
  assert.match(target.decls, /justify-content:\s*center/);
  assert.match(target.decls, /padding:\s*0\.5rem/);
  assert.match(ruleFor(body, /\.btn svg/).decls, /width:\s*20px;\s*height:\s*20px/);
  assert.doesNotMatch(body, /confirm-text/);
});

test("button rows wrap, and the 412px block follows the base .btn-small rule", () => {
  assert.match(ruleFor(CSS, /^\s*\.transfer\s*$/).decls, /flex-wrap:\s*wrap/);
  assert.match(ruleFor(CSS, /^\s*\.review-actions\s*$/).decls, /flex-wrap:\s*wrap/);
  assert.ok(CSS.indexOf("\n.btn-small {") >= 0);
  assert.ok(CSS.indexOf("\n.btn-small {") < CSS.indexOf("@media (max-width: 412px)"));
});

test("options.css has a forced-colors block for buttons, focus, and the input", () => {
  const body = mediaBody(CSS, "forced-colors: active");
  assert.match(ruleFor(body, /\.btn\b/).decls, /border:\s*1px solid ButtonText/);
  assert.match(ruleFor(body, /:focus-visible/).decls, /outline-color:\s*Highlight/);
  assert.match(ruleFor(body, /input\[type="text"\]/).decls, /border-color:\s*CanvasText/);
});

// ---- M4 Task 3: stacked tables ----

test("tables are named by their section heading, with no caption", async () => {
  const { document } = await setup({ "d:a.com": stored(), "d:old.com": stored("archived") });
  assert.ok(document.querySelector("#list table[aria-labelledby=active-heading]"));
  assert.ok(document.querySelector("#archived-list table[aria-labelledby=archived-heading]"));
  assert.ok(document.getElementById("active-heading"));
  assert.ok(document.getElementById("archived-heading"));
  assert.equal(document.querySelector("caption"), null);
});

test("tables carry explicit table roles", async () => {
  const { document } = await setup({ "d:a.com": stored(), "d:old.com": stored("archived") });
  for (const id of ["list", "archived-list"]) {
    const root = document.getElementById(id);
    assert.equal(root.querySelector("table").getAttribute("role"), "table");
    for (const g of root.querySelectorAll("thead, tbody")) assert.equal(g.getAttribute("role"), "rowgroup");
    for (const r of root.querySelectorAll("tr")) assert.equal(r.getAttribute("role"), "row");
    for (const h of root.querySelectorAll("th")) assert.equal(h.getAttribute("role"), "columnheader");
    for (const c of root.querySelectorAll("td")) assert.equal(c.getAttribute("role"), "cell");
  }
});

test("stacked-layout cell labels are aria-hidden and match the column headers", async () => {
  const { document } = await setup({ "d:old.com": stored("archived") });
  const row = document.querySelector("#archived-list tbody tr");
  const labels = [...row.querySelectorAll(".cell-label")];
  assert.deepEqual(labels.map((l) => l.textContent), ["Domain", "Archived", "Posts hidden"]);
  assert.ok(labels.every((l) => l.getAttribute("aria-hidden") === "true"));
  assert.equal(row.querySelector("td.actions .cell-label"), null);
});

test("options.css stacks tables at 32rem and hides thead visually, not with display:none", () => {
  const body = mediaBody(CSS, "max-width: 32rem");
  for (const sel of ["table.domains", "tbody", "tr", "td"]) {
    assert.match(ruleFor(body, new RegExp("(^|,)\\s*" + sel.replace(".", "\\.") + "\\s*(,|$)")).decls, /display:\s*block/);
  }
  const thead = ruleFor(body, /thead/).decls;
  assert.doesNotMatch(thead, /display:\s*none/);
  assert.match(thead, /clip/);
  assert.match(ruleFor(body, /\.cell-label/).decls, /display:\s*inline/);
  assert.match(ruleFor(body, /td\.actions/).decls, /white-space:\s*normal/);
  assert.match(ruleFor(body, /td\.domain/).decls, /overflow-wrap:\s*anywhere/);
  assert.ok(CSS.indexOf("@media (max-width: 32rem)") < CSS.indexOf("@media (max-width: 412px)"));
  assert.match(CSS, /\.cell-label\s*\{[^}]*display:\s*none/);
  assert.match(ruleFor(body, /\.confirm-group/).decls, /justify-content:\s*flex-start/);
});

test("the delete confirmation works the same with the stacked markup", async () => {
  const { document } = await setup({ "d:old.com": stored("archived") });
  q(document, "Delete permanently: old.com").click();
  await settle();
  assert.match(document.querySelector('[role="group"]').textContent, /Really delete\?/);
  const confirm = q(document, "Confirm delete of old.com");
  assert.equal(document.activeElement, confirm);
  confirm.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  assert.equal(document.activeElement, q(document, "Delete permanently: old.com"));
});
