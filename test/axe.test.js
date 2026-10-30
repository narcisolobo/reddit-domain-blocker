import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import axe from "axe-core";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { init } from "../src/options/index.js";
import { handleMessage } from "../src/background/blocklist.js";
import { createStub } from "../src/content/stub.js";
import { createNotice } from "../src/content/notice.js";

const HTML = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");

// WCAG 2.2 AA is the target; best-practice-only rules are not failures of it.
// color-contrast is off because jsdom computes no styles; test/contrast.test.js
// checks the palette's contrast ratios instead.
const AXE_OPTIONS = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  rules: { "color-contrast": { enabled: false } },
};

// Incomplete rule ids that jsdom cannot evaluate; any other incomplete result fails.
const CANNOT_EVALUATE_IN_JSDOM = new Set([
  // Each import-review radio has exactly one wrapping <label> and no id; in jsdom, axe's
  // label[for=id] lookup on an id-less input comes back incomplete rather than passing.
  "form-field-multiple-labels",
]);

function stored(status = "active") {
  return status === "active"
    ? { s: "a", c: 1, u: 1, o: "o" }
    : { s: "x", c: 1, u: 1, x: 2, o: "o" };
}

const D = "2024-01-01T00:00:00.000Z";
const entry = (domain) => ({ domain, status: "active", addedAt: D, updatedAt: D, archivedAt: null, blockedCount: 0, lastBlockedAt: null, source: "options" });
const exportJson = (domains) => JSON.stringify({ schemaVersion: 1, exportedAt: D, extensionVersion: "0.1.0", domains });

function pick(document, json) {
  const input = document.getElementById("import-file");
  const file = { name: "list.json", size: json.length, text: async () => json };
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new document.defaultView.Event("change"));
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 5; i++) await tick();
}

function axeWindow(html) {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  dom.window.eval(axe.source);
  return dom;
}

async function setup(items = {}) {
  const chrome = createFakeChrome();
  await chrome.storage.sync.set(items);
  chrome.runtime.setMessageHandler((msg) => handleMessage(msg, { sync: chrome.storage.sync, local: chrome.storage.local }));
  const dom = axeWindow(HTML);
  await init({ chrome, document: dom.window.document });
  return { chrome, dom, document: dom.window.document };
}

async function check(dom) {
  const { violations, passes, incomplete } = await dom.window.axe.run(dom.window.document, AXE_OPTIONS);
  const summary = violations
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)
    .join("\n");
  assert.equal(violations.length, 0, summary);
  assert.ok(passes.length > 0, "axe evaluated no rules");
  const unexpected = incomplete.filter((r) => !CANNOT_EVALUATE_IN_JSDOM.has(r.id));
  assert.equal(
    unexpected.length,
    0,
    unexpected.map((r) => `${r.id}: ${r.nodes.map((n) => n.target.join(" ")).join(", ")}`).join("\n"),
  );
}

test("axe: options page, empty", async () => {
  const { dom } = await setup();
  await check(dom);
});

test("axe: options page with active and archived rows", async () => {
  const { dom } = await setup({
    "d:a.com": stored(),
    "d:b.com": stored(),
    "d:old.com": stored("archived"),
  });
  await check(dom);
});

test("axe: options page with the delete confirmation open", async () => {
  const { dom, document } = await setup({ "d:old.com": stored("archived") });
  document.querySelector('button[aria-label="Delete permanently: old.com"]').click();
  await settle();
  assert.ok(document.querySelector('[role="group"][aria-label="Confirm deleting old.com"]'));
  await check(dom);
});

test("axe: options page with the import review open, skips listed, count choice shown", async () => {
  const { dom, document } = await setup({ "d:a.com": stored() });
  pick(document, exportJson([entry("a.com"), entry("b.com"), entry("reddit.com"), entry("not a domain")]));
  await settle();
  const review = document.getElementById("import-review");
  assert.ok(review.querySelector("fieldset"));
  assert.ok(review.querySelector("li"));
  await check(dom);
});

test("axe: options page with an add-field error and a row-action error", async () => {
  const { chrome, dom, document } = await setup({ "d:a.com": stored() });
  const input = document.getElementById("domain-input");
  input.value = "localhost";
  document.querySelector("form button[type=submit]").click();
  await settle();
  assert.equal(input.getAttribute("aria-invalid"), "true");
  await check(dom);

  chrome.runtime.sendMessage = async () => ({ ok: false, reason: "error" });
  document.querySelector('button[aria-label="Remove a.com"]').click();
  await settle();
  assert.equal(document.getElementById("action-error").textContent, "Something went wrong. Please try again.");
  await check(dom);
});

test("axe: a hidden stub and a shown stub in a Reddit-like page", async () => {
  const dom = axeWindow('<!doctype html><html lang="en"><head><title>Reddit</title></head><body><main></main></body></html>');
  const document = dom.window.document;
  const noop = () => {};
  const stub = createStub(document, {
    domain: "example.com",
    theme: "light",
    state: "hidden",
    handlers: { onShow: noop, onHide: noop, onUnblock: noop },
  });
  document.querySelector("main").append(stub.element);
  assert.ok(stub.element.shadowRoot.querySelector("button"));
  await check(dom);
  stub.setState("shown");
  assert.ok(stub.element.shadowRoot.querySelector('button[aria-label="Hide post"]'));
  await check(dom);
});

test("axe: the notice shown with a refusal message", async () => {
  const dom = axeWindow('<!doctype html><html lang="en"><head><title>Reddit</title></head><body><main><p>Feed</p></main></body></html>');
  const document = dom.window.document;
  const notice = createNotice(document, { defer: (fn) => fn() });
  notice.show({ kind: "error", text: "Reddit's own domains can't be blocked." });
  const host = document.querySelector("[data-rdb-notice]");
  assert.equal(host.shadowRoot.querySelector('[role="alert"]').textContent, "Reddit's own domains can't be blocked.");
  await check(dom);
});
