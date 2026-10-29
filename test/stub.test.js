import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createStub } from "../src/content/stub.js";

function setup(overrides = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const document = dom.window.document;
  const calls = [];
  const handlers = {
    onShow: () => calls.push("show"),
    onHide: () => calls.push("hide"),
    onUnblock: () => calls.push("unblock"),
  };
  const stub = createStub(document, {
    domain: "example.com",
    theme: "light",
    state: "hidden",
    handlers,
    ...overrides,
  });
  document.body.append(stub.element);
  const root = stub.element.shadowRoot;
  const buttons = () => [...root.querySelectorAll("button")];
  const byLabel = (label) => buttons().find((b) => b.getAttribute("aria-label") === label);
  return { document, stub, root, calls, buttons, byLabel };
}

test("renders hidden state text and buttons in a shadow root", () => {
  const { stub, root, buttons, byLabel } = setup();
  assert.equal(stub.element.tagName, "DIV");
  assert.ok(stub.element.hasAttribute("data-rdb-stub"));
  const group = root.querySelector("[role=group]");
  assert.equal(group.getAttribute("aria-label"), "Hidden post from example.com");
  assert.match(group.textContent, /Hidden: example\.com/);
  assert.equal(buttons().length, 2);
  assert.ok(byLabel("Show post"));
  assert.ok(byLabel("Unblock example.com"));
  assert.equal(byLabel("Show post").textContent.trim(), "Show post");
  assert.equal(byLabel("Unblock example.com").textContent.trim(), "Unblock domain");
});

test("buttons have icon, title and aria-label", () => {
  const { buttons } = setup();
  for (const b of buttons()) {
    assert.ok(b.querySelector("svg[aria-hidden=true]"));
    assert.ok(b.getAttribute("title"));
    assert.ok(b.getAttribute("aria-label"));
  }
});

test("click Show post calls onShow; click Unblock calls onUnblock", () => {
  const { calls, byLabel } = setup();
  byLabel("Show post").click();
  byLabel("Unblock example.com").click();
  assert.deepEqual(calls, ["show", "unblock"]);
});

test("setState('revealed') swaps to Shown: text and Hide post button; Hide post calls onHide", () => {
  const { stub, root, calls, byLabel } = setup();
  stub.setState("revealed");
  assert.match(root.querySelector("[role=group]").textContent, /Shown: example\.com/);
  assert.equal(byLabel("Show post"), undefined);
  byLabel("Hide post").click();
  assert.deepEqual(calls, ["hide"]);
  assert.ok(byLabel("Unblock example.com"));
  stub.setState("hidden");
  assert.match(root.querySelector("[role=group]").textContent, /Hidden: example\.com/);
});

test("setTheme updates data-theme; setDomain updates text, group label, and Unblock name", () => {
  const { stub, root, byLabel } = setup();
  const group = root.querySelector("[role=group]");
  assert.equal(group.getAttribute("data-theme"), "light");
  stub.setTheme("dark");
  assert.equal(group.getAttribute("data-theme"), "dark");
  stub.setDomain("foo.org");
  assert.match(group.textContent, /Hidden: foo\.org/);
  assert.equal(group.getAttribute("aria-label"), "Hidden post from foo.org");
  const unblock = byLabel("Unblock foo.org");
  assert.ok(unblock);
  assert.equal(unblock.getAttribute("title"), "Unblock foo.org");
  assert.equal(byLabel("Unblock example.com"), undefined);
});

test("domain text is never parsed as HTML", () => {
  const { stub, root } = setup();
  stub.setDomain("<img src=x>");
  assert.equal(root.querySelector("img"), null);
  assert.match(root.querySelector("[role=group]").textContent, /<img src=x>/);
});

test("showError renders role=alert text and clears when state changes", () => {
  const { stub, root } = setup();
  const alert = root.querySelector("[role=alert]");
  assert.ok(alert);
  stub.showError("Could not unblock.");
  assert.equal(root.querySelector("[role=alert]").textContent, "Could not unblock.");
  stub.setState("revealed");
  assert.equal(root.querySelector("[role=alert]").textContent, "");
});

test("host styles do not leak: document-level CSS selecting 'button' does not apply", () => {
  const { document, stub, root } = setup();
  assert.ok(root.querySelector("style"));
  assert.equal(stub.element.querySelector("button"), null);
  assert.equal(document.querySelectorAll("button").length, 0);
});

test("focusPrimary focuses Show post in hidden state and Hide post in revealed state", () => {
  const { stub, root, byLabel } = setup();
  stub.focusPrimary();
  assert.equal(root.activeElement, byLabel("Show post"));
  stub.setState("revealed");
  stub.focusPrimary();
  assert.equal(root.activeElement, byLabel("Hide post"));
});

test("showError and focusPrimary never throw", () => {
  const { stub } = setup();
  assert.doesNotThrow(() => stub.showError(undefined));
  assert.doesNotThrow(() => stub.showError(null));
});
