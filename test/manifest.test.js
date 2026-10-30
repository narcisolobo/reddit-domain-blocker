import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("manifest is MV3 with the spec's permissions", () => {
  const m = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.minimum_chrome_version, "120");
  assert.deepEqual(m.permissions, ["storage", "contextMenus"]);
  assert.equal(m.host_permissions, undefined);
  assert.deepEqual(m.content_scripts[0].matches, ["*://*.reddit.com/*"]);
  assert.equal(m.content_scripts[0].run_at, "document_start");
  assert.equal(m.background.service_worker, "background.js");
  assert.equal(m.options_ui.open_in_tab, true);
});
