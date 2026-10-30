import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createNotice } from "../src/content/notice.js";

function setup() {
  const dom = new JSDOM('<!doctype html><html class="theme-light"><body><button id="outside">o</button></body></html>');
  const document = dom.window.document;
  const notice = createNotice(document);
  const hosts = () => document.querySelectorAll("[data-rdb-notice]");
  const root = () => hosts()[0].shadowRoot;
  const region = (role) => root().querySelector(`[role="${role}"]`);
  const dismissBtn = () => root().querySelector("button");
  const visible = () => hosts()[0].style.display !== "none";
  const key = (target, k) =>
    target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, composed: true }));
  return { dom, document, notice, hosts, root, region, dismissBtn, visible, key };
}

test("error goes to role=alert, status to role=status, the other region is emptied", () => {
  const t = setup();
  t.notice.show({ kind: "error", text: "Nope" });
  assert.equal(t.region("alert").textContent, "Nope");
  assert.equal(t.region("status").textContent, "");
  t.notice.show({ kind: "status", text: "Fine" });
  assert.equal(t.region("status").textContent, "Fine");
  assert.equal(t.region("alert").textContent, "");
});

test("one host for any number of shows; the second show replaces the text", () => {
  const t = setup();
  t.notice.show({ kind: "error", text: "one" });
  t.notice.show({ kind: "error", text: "two" });
  assert.equal(t.hosts().length, 1);
  assert.equal(t.region("alert").textContent, "two");
});

test("Dismiss hides it; Escape inside hides it; Escape outside does nothing", () => {
  const t = setup();
  const btn = () => t.dismissBtn();
  t.notice.show({ kind: "status", text: "x" });
  assert.equal(t.visible(), true);
  assert.equal(btn().getAttribute("aria-label"), "Dismiss message");
  assert.equal(btn().title, "Dismiss message");
  assert.match(btn().textContent, /Dismiss/);
  assert.ok(btn().querySelector("svg"));
  btn().click();
  assert.equal(t.visible(), false);
  t.notice.show({ kind: "status", text: "x" });
  t.key(btn(), "Escape");
  assert.equal(t.visible(), false);
  t.notice.show({ kind: "status", text: "x" });
  t.key(t.document.getElementById("outside"), "Escape");
  assert.equal(t.visible(), true);
  t.notice.dismiss();
  assert.equal(t.visible(), false);
});

test("show does not move focus", () => {
  const t = setup();
  const outside = t.document.getElementById("outside");
  outside.focus();
  t.notice.show({ kind: "error", text: "x" });
  assert.equal(t.document.activeElement, outside);
});

test("theme follows Reddit's theme at show time", () => {
  const t = setup();
  const theme = () => t.root().querySelector("[data-theme]").getAttribute("data-theme");
  t.notice.show({ kind: "status", text: "x" });
  assert.equal(theme(), "light");
  t.document.documentElement.className = "theme-dark";
  t.notice.show({ kind: "status", text: "x" });
  assert.equal(theme(), "dark");
});

test("text is set as text, not HTML", () => {
  const t = setup();
  t.notice.show({ kind: "error", text: "<b>x</b>" });
  assert.equal(t.region("alert").textContent, "<b>x</b>");
  assert.equal(t.region("alert").querySelector("b"), null);
});
