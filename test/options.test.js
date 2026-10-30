import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { messageFor, renderList } from "../src/options/view.js";
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
  renderList(root, [rec("zeta.com"), rec("old.com", "archived"), rec("alpha.com")], { onRemove() {} });
  const cells = [...root.querySelectorAll("td.domain")].map((td) => td.textContent);
  assert.deepEqual(cells, ["alpha.com", "zeta.com"]);
  assert.equal(root.querySelector("caption").textContent, "Blocked domains");
  const ths = [...root.querySelectorAll("th")];
  assert.equal(ths.length, 2);
  assert.ok(ths.every((th) => th.getAttribute("scope") === "col"));
  assert.equal(ths[0].textContent, "Domain");
  assert.equal(ths[1].textContent, "Actions");
  assert.ok(ths[1].querySelector(".visually-hidden"));
});

test("Remove button has text, aria-label, title, hidden svg, and calls onRemove", () => {
  const { document } = page();
  const root = document.getElementById("list");
  const removed = [];
  renderList(root, [rec("example.com")], { onRemove: (d) => removed.push(d) });
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
  renderList(root, [rec("old.com", "archived")], { onRemove() {} });
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

test("changes in other storage areas do not trigger a render", async () => {
  const { chrome, document } = await setup();
  await chrome.storage.local.set({ "d:local.com": stored() });
  await settle();
  assert.equal(document.querySelector("table"), null);
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
