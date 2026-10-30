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
