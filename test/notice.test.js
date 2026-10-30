import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createNotice } from "../src/content/notice.js";

function setup() {
  const dom = new JSDOM('<!doctype html><html class="theme-light"><body><button id="outside">o</button></body></html>');
  const document = dom.window.document;
  const queue = [];
  const notice = createNotice(document, { defer: (fn) => queue.push(fn) });
  const run = () => queue.splice(0).forEach((fn) => fn());
  const hosts = () => document.querySelectorAll("[data-rdb-notice]");
  const root = () => hosts()[0].shadowRoot;
  const region = (role) => root().querySelector(`[role="${role}"]`);
  const dismissBtn = () => root().querySelector("button");
  const visible = () => !root().querySelector(".box").classList.contains("off");
  const key = (target, k) =>
    target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, composed: true }));
  return { dom, document, notice, run, queue, hosts, root, region, dismissBtn, visible, key };
}

test("error goes to role=alert, status to role=status, the other region is emptied", () => {
  const t = setup();
  t.notice.show({ kind: "error", text: "Nope" }); t.run();
  assert.equal(t.region("alert").textContent, "Nope");
  assert.equal(t.region("status").textContent, "");
  t.notice.show({ kind: "status", text: "Fine" }); t.run();
  assert.equal(t.region("status").textContent, "Fine");
  assert.equal(t.region("alert").textContent, "");
});

test("one host for any number of shows; the second show replaces the text", () => {
  const t = setup();
  t.notice.show({ kind: "error", text: "one" }); t.run();
  t.notice.show({ kind: "error", text: "two" }); t.run();
  assert.equal(t.hosts().length, 1);
  assert.equal(t.region("alert").textContent, "two");
});

test("Dismiss hides it; Escape inside hides it", () => {
  const t = setup();
  const btn = () => t.dismissBtn();
  t.notice.show({ kind: "status", text: "x" }); t.run();
  assert.equal(t.visible(), true);
  assert.equal(btn().getAttribute("aria-label"), "Dismiss message");
  assert.equal(btn().title, "Dismiss message");
  assert.match(btn().textContent, /Dismiss/);
  assert.ok(btn().querySelector("svg"));
  btn().click();
  assert.equal(t.visible(), false);
  t.notice.show({ kind: "status", text: "x" }); t.run();
  t.key(btn(), "Escape");
  assert.equal(t.visible(), false);
  t.notice.show({ kind: "status", text: "x" }); t.run();
  t.notice.dismiss();
  assert.equal(t.visible(), false);
});

test("Escape anywhere on the page dismisses while the notice is showing", () => {
  const t = setup();
  t.notice.show({ kind: "status", text: "x" }); t.run();
  t.key(t.document.getElementById("outside"), "Escape");
  assert.equal(t.visible(), false);
});

test("Escape does nothing once the notice is dismissed, and other keys never dismiss", () => {
  const t = setup();
  t.notice.show({ kind: "status", text: "x" }); t.run();
  t.key(t.document.getElementById("outside"), "Enter");
  assert.equal(t.visible(), true);
  t.notice.dismiss();
  let seen = 0;
  t.document.addEventListener("keydown", () => { seen += 1; });
  t.key(t.document.getElementById("outside"), "Escape");
  assert.equal(seen, 1);
  assert.equal(t.visible(), false);
});

test("Escape during IME composition does not dismiss", () => {
  const t = setup();
  t.notice.show({ kind: "status", text: "x" }); t.run();
  t.document.getElementById("outside").dispatchEvent(
    new t.dom.window.KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
  assert.equal(t.visible(), true);
});

test("the page still sees Escape: it is not stopped or cancelled", () => {
  const t = setup();
  t.notice.show({ kind: "status", text: "x" }); t.run();
  let event = null;
  t.document.body.addEventListener("keydown", (e) => { event = e; });
  t.key(t.document.getElementById("outside"), "Escape");
  assert.ok(event);
  assert.equal(event.defaultPrevented, false);
});

test("dismissing with focus on Dismiss gives focus back to what had it when the notice showed", () => {
  const t = setup();
  const outside = t.document.getElementById("outside");
  outside.focus();
  t.notice.show({ kind: "status", text: "x" }); t.run();
  t.dismissBtn().focus();
  assert.equal(t.root().activeElement, t.dismissBtn());
  t.key(t.dismissBtn(), "Escape");
  assert.equal(t.document.activeElement, outside);
});

test("clicking Dismiss also returns focus", () => {
  const t = setup();
  const outside = t.document.getElementById("outside");
  outside.focus();
  t.notice.show({ kind: "status", text: "x" }); t.run();
  t.dismissBtn().focus();
  t.dismissBtn().click();
  assert.equal(t.document.activeElement, outside);
});

test("dismissing moves no focus when focus is not on Dismiss", () => {
  const t = setup();
  const other = t.document.createElement("button");
  t.document.body.append(other);
  t.document.getElementById("outside").focus();
  t.notice.show({ kind: "status", text: "x" }); t.run();
  other.focus();
  t.notice.dismiss();
  assert.equal(t.document.activeElement, other);
});

test("if the earlier element is gone, dismissing does not throw", () => {
  const t = setup();
  const outside = t.document.getElementById("outside");
  outside.focus();
  t.notice.show({ kind: "status", text: "x" }); t.run();
  t.dismissBtn().focus();
  outside.remove();
  assert.doesNotThrow(() => t.key(t.dismissBtn(), "Escape"));
  assert.equal(t.visible(), false);
});

test("show does not move focus", () => {
  const t = setup();
  const outside = t.document.getElementById("outside");
  outside.focus();
  t.notice.show({ kind: "error", text: "x" }); t.run();
  assert.equal(t.document.activeElement, outside);
});

test("theme follows Reddit's theme at show time", () => {
  const t = setup();
  const theme = () => t.root().querySelector("[data-theme]").getAttribute("data-theme");
  t.notice.show({ kind: "status", text: "x" }); t.run();
  assert.equal(theme(), "light");
  t.document.documentElement.className = "theme-dark";
  t.notice.show({ kind: "status", text: "x" }); t.run();
  assert.equal(theme(), "dark");
});

test("text is set as text, not HTML", () => {
  const t = setup();
  t.notice.show({ kind: "error", text: "<b>x</b>" }); t.run();
  assert.equal(t.region("alert").textContent, "<b>x</b>");
  assert.equal(t.region("alert").querySelector("b"), null);
});

test("live regions and their ancestors are never display:none or visibility:hidden", () => {
  const t = setup();
  const check = () => {
    for (const r of ["status", "alert"]) {
      for (let el = t.region(r); el; el = el.parentNode) {
        if (el.nodeType !== 1) continue;
        assert.notEqual(el.style.display, "none");
        assert.notEqual(el.style.visibility, "hidden");
        assert.equal(el.hidden, false);
      }
    }
  };
  t.notice.show({ kind: "status", text: "x" });
  check();
  t.run();
  t.notice.dismiss();
  check();
  const css = t.root().querySelector("style").textContent;
  const offRule = css.match(/\.box\.off \{[^}]*\}/)[0];
  assert.doesNotMatch(offRule, /display:\s*none|visibility:\s*hidden/);
  assert.doesNotMatch(css.replace(offRule, ""), /\.messages[^{]*\{[^}]*display:\s*none/);
});

test("the box is visible before the text is written", () => {
  const t = setup();
  t.notice.show({ kind: "error", text: "late" });
  assert.equal(t.visible(), true);
  assert.equal(t.region("alert").textContent, "");
  t.run();
  assert.equal(t.region("alert").textContent, "late");
});

test("the Dismiss button is out of the tab order while the notice is off", () => {
  const t = setup();
  t.notice.show({ kind: "status", text: "x" });
  t.run();
  assert.equal(t.dismissBtn().hidden, false);
  t.notice.dismiss();
  assert.equal(t.dismissBtn().hidden, true);
  const css = t.root().querySelector("style").textContent;
  assert.match(css, /button\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  t.notice.show({ kind: "status", text: "y" });
  assert.equal(t.dismissBtn().hidden, false);
});
