import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { messageFor, renderList, renderArchived } from "../src/options/view.js";
import { init } from "../src/options/index.js";
import { handleMessage } from "../src/background/blocklist.js";

const HTML = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");

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

test("renderList shows active domains only, sorted, with caption and th scope=col", () => {
  const { document } = page();
  const root = document.getElementById("list");
  renderList(root, [rec("zeta.com"), rec("old.com", "archived"), rec("alpha.com")], new Map(), { onRemove() {} });
  const cells = [...root.querySelectorAll("td.domain")].map((td) => td.textContent);
  assert.deepEqual(cells, ["alpha.com", "zeta.com"]);
  assert.equal(root.querySelector("caption").textContent, "Blocked domains");
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
  assert.equal(btn.getAttribute("title"), "Archive example.com");
  assert.equal(btn.querySelector("svg").getAttribute("aria-hidden"), "true");
  btn.click();
  assert.deepEqual(removed, ["example.com"]);
});

test("empty list shows the empty state and no table", () => {
  const { document } = page();
  const root = document.getElementById("list");
  renderList(root, [rec("old.com", "archived")], new Map(), { onRemove() {} });
  assert.equal(root.querySelector("table"), null);
  assert.match(root.textContent, /No blocked domains yet\./);
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
  assert.deepEqual([...document.querySelectorAll("td.domain")].map((t) => t.textContent), ["thedailybeast.com"]);
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
  const alert = document.querySelector('[role="alert"]');
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
  assert.equal(document.querySelector('[role="alert"]').textContent, "");
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
  assert.equal(document.querySelector('[role="alert"]').textContent, "Something went wrong. Please try again.");
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
  assert.deepEqual([...document.querySelectorAll("td.domain")].map((t) => t.textContent), ["elsewhere.com"]);
});

test("a malformed record in storage is ignored", async () => {
  const { document } = await setup({
    "d:good.com": stored(),
    "d:bad.com": { nonsense: true },
    "d:worse.com": "string",
    "d:nul.com": null,
    "other": { s: "a" },
  });
  assert.deepEqual([...document.querySelectorAll("td.domain")].map((t) => t.textContent), ["good.com"]);
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
  const domains = [...document.querySelectorAll("td.domain")].map((t) => t.textContent);
  assert.deepEqual(domains, ["fast.com", "old.com", "slow.com"]);
});

// ---- M2 Task 4: counts, Archived section, Restore ----

const stat = (n) => ({ blockedCount: n, lastBlockedAt: 5 });
const countOf = (document, d) => document.querySelector(`[data-count-for="${d}"]`).textContent;

test("active table shows Posts hidden from local stats, 0 when missing", async () => {
  const { chrome, document } = await setup({ "d:a.com": stored(), "d:b.com": stored() });
  await chrome.storage.local.set({ "stats:a.com": stat(12) });
  await settle();
  assert.equal(countOf(document, "a.com"), "12");
  assert.equal(countOf(document, "b.com"), "0");
  assert.equal(document.querySelector('td.count[data-count-for="a.com"]').className, "count");
});

test("archived table: caption, th scope=col, time datetime, counts, Restore button names", async () => {
  const { document } = await setup({ "d:old.com": stored("archived") });
  const root = document.getElementById("archived-list");
  assert.equal(root.querySelector("caption").textContent, "Archived domains");
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
  assert.equal(btn.getAttribute("title"), "Block old.com again");
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
  assert.deepEqual([...root.querySelectorAll("td.domain")].map((t) => t.textContent), ["a.com", "z.com"]);
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
  assert.deepEqual([...document.querySelectorAll("#list td.domain")].map((t) => t.textContent), ["old.com"]);
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
