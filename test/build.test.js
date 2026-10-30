import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

test("build ships THIRD_PARTY_LICENSES inside extension/", () => {
  rmSync("extension/THIRD_PARTY_LICENSES", { force: true });
  execFileSync("node", ["scripts/build.js"], { stdio: "pipe" });
  assert.equal(existsSync("extension/THIRD_PARTY_LICENSES"), true);
  const shipped = readFileSync("extension/THIRD_PARTY_LICENSES");
  assert.deepEqual(shipped, readFileSync("THIRD_PARTY_LICENSES"));
  const text = shipped.toString("utf8");
  assert.match(text, /MIT/);
  assert.match(text, /Tabler/);
});

test("manifest points the extension and toolbar icons at PNGs of the declared sizes", () => {
  const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
  const sizes = ["16", "32", "48", "128"];
  assert.deepEqual(Object.keys(manifest.icons), sizes);
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  for (const size of sizes) {
    const png = readFileSync(`extension/${manifest.icons[size]}`);
    assert.equal(png.toString("latin1", 1, 4), "PNG");
    // IHDR width and height, big-endian, at bytes 16-23.
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
});
