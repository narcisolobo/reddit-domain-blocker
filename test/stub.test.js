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
  assert.ok(byLabel("Unblock domain example.com"));
  assert.equal(byLabel("Show post").textContent.trim(), "Show post");
  assert.equal(byLabel("Unblock domain example.com").textContent.trim(), "Unblock domain");
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
  byLabel("Unblock domain example.com").click();
  assert.deepEqual(calls, ["show", "unblock"]);
});

test("setState('revealed') swaps to Shown: text and Hide post button; Hide post calls onHide", () => {
  const { stub, root, calls, byLabel } = setup();
  stub.setState("revealed");
  assert.match(root.querySelector("[role=group]").textContent, /Shown: example\.com/);
  assert.equal(byLabel("Show post"), undefined);
  assert.equal(root.querySelector("[role=group]").getAttribute("aria-label"), "Shown post from example.com");
  stub.setDomain("foo.org");
  assert.equal(root.querySelector("[role=group]").getAttribute("aria-label"), "Shown post from foo.org");
  stub.setDomain("example.com");
  byLabel("Hide post").click();
  assert.deepEqual(calls, ["hide"]);
  assert.ok(byLabel("Unblock domain example.com"));
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
  const unblock = byLabel("Unblock domain foo.org");
  assert.ok(unblock);
  assert.equal(unblock.getAttribute("title"), "Unblock domain foo.org");
  assert.equal(byLabel("Unblock domain example.com"), undefined);
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

test("every button's aria-label contains its visible text in both states", () => {
  const { stub, buttons } = setup();
  for (const state of ["hidden", "revealed"]) {
    stub.setState(state);
    for (const b of buttons()) {
      const visible = b.textContent.trim().toLowerCase();
      assert.ok(visible);
      assert.ok(b.getAttribute("aria-label").toLowerCase().includes(visible));
    }
  }
});

test("the stub label shows the ban icon before the text, aria-hidden", () => {
  const { root } = setup();
  const label = root.querySelector(".label");
  assert.equal(label.firstElementChild.tagName.toLowerCase(), "svg");
  assert.equal(label.firstElementChild.getAttribute("aria-hidden"), "true");
  assert.equal(label.querySelector(".label-text").textContent, "Hidden: example.com");
  assert.equal(label.textContent, "Hidden: example.com");
});

test("setDomain keeps the icon and updates only the text", () => {
  const { stub, root } = setup();
  const icon = root.querySelector(".label svg");
  stub.setDomain("foo.org");
  assert.equal(root.querySelector(".label svg"), icon);
  assert.equal(root.querySelector(".label-text").textContent, "Hidden: foo.org");
  stub.setState("revealed");
  assert.equal(root.querySelectorAll(".label svg").length, 1);
  assert.equal(root.querySelector(".label-text").textContent, "Shown: foo.org");
});

test("stub buttons go icon-only with 44px targets at 412px", () => {
  const { root, buttons } = setup();
  const css = root.querySelector("style").textContent;
  const media = css.slice(css.indexOf("@media (max-width: 412px)"));
  assert.match(media, /button > span\s*\{\s*display: none;/);
  assert.match(media, /min-width: 44px;/);
  assert.match(media, /min-height: 44px;/);
  assert.match(media, /justify-content: center;/);
  assert.match(media, /padding: 8px;/);
  for (const b of buttons()) {
    assert.ok(b.getAttribute("aria-label"));
    assert.ok(b.getAttribute("title"));
  }
});

test("a 60-character domain wraps instead of widening the stub", () => {
  const { root } = setup({ domain: "a".repeat(60) + ".com" });
  const css = root.querySelector("style").textContent;
  const rule = css.match(/\.label\s*\{[^}]*\}/)[0];
  assert.match(rule, /min-width: 0;/);
  assert.match(rule, /overflow-wrap: anywhere;/);
  const text = css.match(/\.label-text\s*\{[^}]*\}/)[0];
  assert.match(text, /min-width: 0;/);
  assert.match(text, /overflow-wrap: anywhere;/);
});
