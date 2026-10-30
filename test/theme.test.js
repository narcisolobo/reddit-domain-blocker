import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { detectTheme, watchTheme } from "../src/content/theme.js";

function doc(htmlAttrs = "", bodyAttrs = "") {
  const html = `<!doctype html><html ${htmlAttrs}><body ${bodyAttrs}></body></html>`;
  return new JSDOM(html).window.document;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test("detectTheme returns dark for the dark signal", () => {
  assert.equal(detectTheme(doc('class="theme-beta theme-dark"')), "dark");
});

test("detectTheme returns light for the light signal", () => {
  assert.equal(detectTheme(doc('class="theme-beta theme-light"')), "light");
});

test("detectTheme prefers the class over a contradicting background", () => {
  assert.equal(detectTheme(doc('class="theme-light"', 'style="background: rgb(11, 20, 22)"')), "light");
});

test("detectTheme uses computed color-scheme when no class is present", () => {
  const d = doc('style="color-scheme: dark"');
  assert.equal(detectTheme(d), "dark");
});

test("detectTheme is light when no signal and body background is white", () => {
  assert.equal(detectTheme(doc("", 'style="background: rgb(255, 255, 255)"')), "light");
});

test("detectTheme is dark when no signal and body background is rgb(11, 20, 22)", () => {
  assert.equal(detectTheme(doc("", 'style="background: rgb(11, 20, 22)"')), "dark");
});

test("detectTheme falls back to the html background when body is transparent", () => {
  assert.equal(detectTheme(doc('style="background: rgb(11, 20, 22)"')), "dark");
});

test("detectTheme is light when nothing signals a theme", () => {
  assert.equal(detectTheme(doc()), "light");
});

test("watchTheme calls back once on a change, not on unrelated attribute edits", async () => {
  const d = doc('class="theme-light"');
  const seen = [];
  const stop = watchTheme(d, (theme) => seen.push(theme));
  d.documentElement.setAttribute("data-foo", "1");
  await tick();
  d.documentElement.className = "theme-light theme-beta";
  await tick();
  assert.deepEqual(seen, []);
  d.documentElement.className = "theme-dark";
  await tick();
  assert.deepEqual(seen, ["dark"]);
  stop();
});

test("watchTheme observes body style changes", async () => {
  const d = doc();
  const seen = [];
  const stop = watchTheme(d, (theme) => seen.push(theme));
  d.body.setAttribute("style", "background: rgb(11, 20, 22)");
  await tick();
  assert.deepEqual(seen, ["dark"]);
  stop();
});

test("watchTheme's returned function stops callbacks", async () => {
  const d = doc('class="theme-light"');
  const seen = [];
  const stop = watchTheme(d, (theme) => seen.push(theme));
  stop();
  d.documentElement.className = "theme-dark";
  await tick();
  assert.deepEqual(seen, []);
});

function bodylessDoc() {
  const d = new JSDOM("<!doctype html><html></html>").window.document;
  d.body?.remove();
  return d;
}

function attachBody(d, style) {
  const body = d.createElement("body");
  if (style) body.setAttribute("style", style);
  d.documentElement.appendChild(body);
  return body;
}

test("watchTheme reacts to a body attached late", async () => {
  const d = bodylessDoc();
  assert.equal(d.body, null);
  const seen = [];
  const stop = watchTheme(d, (theme) => seen.push(theme));
  attachBody(d, "background: rgb(11, 20, 22)");
  await tick();
  assert.deepEqual(seen, ["dark"]);
  stop();
});

test("watchTheme observes style changes on a late body", async () => {
  const d = bodylessDoc();
  const seen = [];
  const stop = watchTheme(d, (theme) => seen.push(theme));
  const body = attachBody(d, "background: rgb(11, 20, 22)");
  await tick();
  body.setAttribute("style", "background: rgb(255, 255, 255)");
  await tick();
  assert.deepEqual(seen, ["dark", "light"]);
  stop();
});

test("watchTheme disconnected before the body appears never calls back", async () => {
  const d = bodylessDoc();
  const seen = [];
  const stop = watchTheme(d, (theme) => seen.push(theme));
  stop();
  attachBody(d, "background: rgb(11, 20, 22)");
  await tick();
  assert.deepEqual(seen, []);
});

test("detectTheme skips rgba(0, 0, 0, 0) and transparent backgrounds", () => {
  assert.equal(detectTheme(doc('style="background: rgb(11, 20, 22)"', 'style="background: rgba(0, 0, 0, 0)"')), "dark");
  assert.equal(detectTheme(doc('style="background: rgb(11, 20, 22)"', 'style="background: transparent"')), "dark");
});

test("detectTheme counts rgb(11 20 22 / 50%) as dark", () => {
  assert.equal(detectTheme(doc("", 'style="background: rgb(11 20 22 / 50%)"')), "dark");
});

test("detectTheme skips rgb(11 20 22 / 0%)", () => {
  assert.equal(detectTheme(doc('style="background: rgb(255, 255, 255)"', 'style="background: rgb(11 20 22 / 0%)"')), "light");
});

test("detectTheme returns light without a documentElement or defaultView", () => {
  const d = bodylessDoc();
  d.documentElement.remove();
  assert.equal(detectTheme(d), "light");
  assert.equal(detectTheme({ documentElement: {}, defaultView: null }), "light");
});
