import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { MENU_ID, registerMenu, menuNoticeFor } from "../src/background/menu.js";

test("registerMenu creates exactly one entry with the spec's properties", async () => {
  const fake = createFakeChrome();
  await registerMenu(fake.contextMenus);
  await registerMenu(fake.contextMenus);
  assert.deepEqual(fake.contextMenus.items, [
    { id: MENU_ID, title: "Block this domain", contexts: ["link"], documentUrlPatterns: ["*://*.reddit.com/*"] },
  ]);
  assert.equal(MENU_ID, "block-domain");
});

test("menuNoticeFor: null for added and restored; texts for exists and every reason", () => {
  assert.equal(menuNoticeFor({ ok: true, domain: "a.com", outcome: "added" }), null);
  assert.equal(menuNoticeFor({ ok: true, domain: "a.com", outcome: "restored" }), null);
  assert.deepEqual(menuNoticeFor({ ok: true, domain: "a.com", outcome: "exists" }), {
    kind: "status",
    text: "a.com is already blocked.",
  });
  const err = (reason) => menuNoticeFor({ ok: false, reason });
  const none = "That link has no domain that can be blocked.";
  assert.deepEqual(err("protected"), {
    kind: "error",
    text: "Reddit's own links can't be blocked. Right-click the post's outbound link instead.",
  });
  for (const r of ["invalid", "empty", "single-label"]) assert.deepEqual(err(r), { kind: "error", text: none });
  assert.deepEqual(err("ip"), { kind: "error", text: "IP addresses can't be blocked." });
  assert.deepEqual(err("quota"), {
    kind: "error",
    text: "The block list is full. Remove some domains on the options page.",
  });
  for (const r of ["error", "weird"]) {
    assert.deepEqual(err(r), { kind: "error", text: "Couldn't block that domain. Please try again." });
  }
});
