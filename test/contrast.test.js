import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { contrast, cssTokens } from "./helpers/contrast.js";
import { LIGHT, DARK, paletteCss } from "../src/content/palette.js";
import { createStub } from "../src/content/stub.js";
import { createNotice } from "../src/content/notice.js";

const css = readFileSync(new URL("../extension/options.css", import.meta.url), "utf8");
const darkCss = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
const OPTIONS = { light: cssTokens(css, ":root"), dark: cssTokens(darkCss, ":root") };
const CONTENT = { light: LIGHT, dark: DARK };
const REDDIT_BG = { light: ["#ffffff"], dark: ["#0e1113"] };

function check(pairs, min) {
  for (const [name, fg, bg] of pairs) {
    const r = contrast(fg, bg);
    assert.ok(r >= min, `${name} is ${r.toFixed(2)} (need ${min})`);
  }
}

test("contrast helper matches known WCAG ratios", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
  assert.equal(contrast("#fff", "#000").toFixed(1), "21.0");
});

test("cssTokens reads the exact selector and expands shorthand", () => {
  const sample = ":root { --a: #fff; --b: #112233; }\n@media (x) {\n  :root {\n    --a: #000;\n  }\n}";
  assert.deepEqual(cssTokens(sample, ":root"), { a: "#ffffff", b: "#112233" });
  assert.deepEqual(cssTokens(sample.slice(20), ":root"), { a: "#000000" });
});

for (const theme of ["light", "dark"]) {
  const o = OPTIONS[theme];
  const c = CONTENT[theme];

  test(`options page ${theme}: text pairs reach 4.5:1`, () => {
    assert.ok(Object.keys(o).length > 5, "tokens parsed");
    const pair = (a, b) => [`--${a} on --${b}`, o[a], o[b]];
    check([
      pair("text", "bg"), pair("muted", "bg"), pair("error", "bg"),
      pair("add-text", "add-bg"), pair("remove-text", "remove-bg"), pair("grey-text", "bg"),
    ], 4.5);
  });

  test(`options page ${theme}: boundaries and focus reach 3:1`, () => {
    const pair = (a, b) => [`--${a} on --${b}`, o[a], o[b]];
    check([
      pair("border", "bg"), pair("grey-border", "bg"), pair("focus", "bg"),
      pair("add-bg", "bg"), pair("remove-bg", "bg"),
    ], 3);
  });

  test(`stub and notice ${theme}: text reaches 4.5:1`, () => {
    check([
      ["fg on bg", c.fg, c.bg], ["fg on btnBg", c.fg, c.btnBg],
      ["fg on btnHover", c.fg, c.btnHover], ["error on bg", c.error, c.bg],
    ], 4.5);
  });

  test(`stub and notice ${theme}: boundaries and focus reach 3:1`, () => {
    check([
      ["border on bg", c.border, c.bg], ["border on btnBg", c.border, c.btnBg],
      ["focus on bg", c.focus, c.bg],
      ...REDDIT_BG[theme].flatMap((p) => [
        [`border on Reddit ${p}`, c.border, p], [`focus on Reddit ${p}`, c.focus, p],
      ]),
    ], 3);
  });
}

test("stub and notice render the same palette", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const document = dom.window.document;
  const stub = createStub(document, { domain: "example.com", theme: "light", state: "hidden", handlers: {} });
  document.body.append(stub.element);
  const notice = createNotice(document, { defer: (fn) => fn() });
  notice.show({ kind: "status", text: "x" });
  const styleOf = (host) => host.shadowRoot.querySelector("style").textContent;
  const stubCss = styleOf(stub.element);
  const noticeCss = styleOf(document.querySelector("[data-rdb-notice]"));
  assert.ok(stubCss.includes(paletteCss(".bar")), "stub uses paletteCss(.bar)");
  assert.ok(noticeCss.includes(paletteCss(".box")), "notice uses paletteCss(.box)");
  for (const [name, text, sel] of [["stub", stubCss, ".bar"], ["notice", noticeCss, ".box"]]) {
    const rest = text.replace(paletteCss(sel), "");
    assert.deepEqual(rest.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [], [], `${name} has no color literal outside the palette`);
  }
});
