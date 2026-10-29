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
