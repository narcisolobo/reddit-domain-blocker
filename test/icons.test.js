import { test } from "node:test";
import assert from "node:assert/strict";
import { icon } from "../src/shared/icons.js";

for (const name of ["plus", "trash", "eye", "eye-off", "ban", "arrow-back-up", "x"]) {
  test(`icon(${name}) is decorative inline svg`, () => {
    const svg = icon(name);
    assert.match(svg, /^<svg[^>]*aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
    assert.match(svg, /stroke="currentColor"/);
  });
}

test("size is applied", () => assert.match(icon("plus", 20), /width="20"/));
test("default size is 16", () => assert.match(icon("plus"), /width="16"/));
test("unknown name throws", () => assert.throws(() => icon("nope")));
