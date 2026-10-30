import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { init } from "../src/background/index.js";

test("add message writes sync storage and responds", async () => {
  const fake = createFakeChrome();
  init(fake);
  const res = await fake.runtime.dispatchMessage({ type: "domain/add", input: "example.com", source: "options" });
  assert.equal(res.ok, true);
  assert.ok((await fake.storage.sync.get(null))["d:example.com"]);
});

test("toolbar click opens the options page", () => {
  const fake = createFakeChrome();
  init(fake);
  fake.action.click();
  assert.equal(fake.runtime.openOptionsPage.calls, 1);
});

test("concurrent adds of the same domain are serialized", async () => {
  const fake = createFakeChrome();
  init(fake);
  const msg = { type: "domain/add", input: "race.com", source: "options" };
  const [a, b] = await Promise.all([
    fake.runtime.dispatchMessage(msg),
    fake.runtime.dispatchMessage(msg),
  ]);
  assert.equal(a.outcome, "added");
  assert.equal(b.outcome, "exists");
});

test("an unexpected handler failure responds with an error and does not break the queue", async () => {
  const fake = createFakeChrome();
  init(fake);
  fake.storage.sync.get = async () => {
    throw new Error("boom");
  };
  const bad = await fake.runtime.dispatchMessage({ type: "domain/add", input: "x.com", source: "options" });
  assert.deepEqual(bad, { ok: false, reason: "error" });
  const ok = await fake.runtime.dispatchMessage({ type: "nope" });
  assert.deepEqual(ok, { ok: false, reason: "error" });
});

test("concurrent stats/hits from two tabs both land", async () => {
  const fake = createFakeChrome();
  init(fake);
  await fake.storage.sync.set({ "d:a.com": { s: "a", c: 1, u: 1, o: "o" } });
  await Promise.all([
    fake.runtime.dispatchMessage({ type: "stats/hits", hits: { "a.com": 2 } }),
    fake.runtime.dispatchMessage({ type: "stats/hits", hits: { "a.com": 3 } }),
  ]);
  assert.equal((await fake.storage.local.get("stats:a.com"))["stats:a.com"].blockedCount, 5);
});
