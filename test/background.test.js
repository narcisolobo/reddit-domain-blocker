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

const tab = { id: 7 };
const click = (fake, linkUrl, t = tab, menuItemId = "block-domain") =>
  fake.contextMenus.click({ menuItemId, linkUrl }, t);

test("install registers the menu", async () => {
  const fake = createFakeChrome();
  init(fake);
  await fake.runtime.install();
  assert.equal(fake.contextMenus.items.length, 1);
  assert.equal(fake.contextMenus.items[0].id, "block-domain");
});

test("a failing menu registration on install does not reject", async () => {
  const fake = createFakeChrome();
  fake.contextMenus.create = () => {
    throw new Error("menus unavailable");
  };
  init(fake);
  await assert.doesNotReject(fake.runtime.install());
});

test("clicking on an outbound link adds the domain with source context-menu and sends no notice", async () => {
  const fake = createFakeChrome();
  init(fake);
  await click(fake, "https://www.thedailybeast.com/x?y=1");
  const rec = (await fake.storage.sync.get(null))["d:thedailybeast.com"];
  assert.equal(rec.o, "m");
  assert.deepEqual(fake.tabs.sent, []);
});

test("an archived domain is restored, not duplicated", async () => {
  const fake = createFakeChrome();
  init(fake);
  await click(fake, "https://a.com/x");
  await fake.runtime.dispatchMessage({ type: "domain/archive", domain: "a.com" });
  const archived = (await fake.storage.sync.get(null))["d:a.com"];
  await click(fake, "https://a.com/y");
  const all = await fake.storage.sync.get(null);
  assert.equal(Object.keys(all).filter((k) => k.startsWith("d:")).length, 1);
  assert.notDeepEqual(all["d:a.com"], archived);
  assert.deepEqual(fake.tabs.sent, []);
});

test("Reddit permalink, user link, and mailto: are refused with a notice; nothing written", async () => {
  const fake = createFakeChrome();
  init(fake);
  await click(fake, "https://www.reddit.com/r/news/comments/abc/x/");
  await click(fake, "https://www.reddit.com/user/someone");
  await click(fake, "mailto:a@b.com");
  assert.equal(fake.tabs.sent.length, 3);
  assert.equal(fake.tabs.sent[0].tabId, 7);
  assert.deepEqual(fake.tabs.sent[0].msg, {
    type: "notice",
    kind: "error",
    text: "Reddit's own links can't be blocked. Right-click the post's outbound link instead.",
  });
  assert.equal(fake.tabs.sent[1].msg.kind, "error");
  assert.equal(fake.tabs.sent[2].msg.kind, "error");
  assert.deepEqual(await fake.storage.sync.get(null), {});
});

test("an already active domain sends the 'already blocked' notice", async () => {
  const fake = createFakeChrome();
  init(fake);
  await click(fake, "https://a.com/x");
  await click(fake, "https://www.a.com/y");
  assert.deepEqual(fake.tabs.sent.map((s) => s.msg), [
    { type: "notice", kind: "status", text: "a.com is already blocked." },
  ]);
});

test("a rejected tabs.sendMessage is swallowed", async () => {
  const fake = createFakeChrome();
  init(fake);
  fake.tabs.failNextSend(new Error("Could not establish connection."));
  await click(fake, "mailto:a@b.com");
  await click(fake, "https://a.com/x");
  assert.ok((await fake.storage.sync.get(null))["d:a.com"]);
});

test("a click with no tab or another menu id does nothing", async () => {
  const fake = createFakeChrome();
  init(fake);
  await click(fake, "https://a.com/x", null);
  await click(fake, "https://b.com/x", tab, "other");
  assert.deepEqual(await fake.storage.sync.get(null), {});
  assert.deepEqual(fake.tabs.sent, []);
});

test("a menu click and a message are serialized on one queue", async () => {
  const fake = createFakeChrome();
  init(fake);
  const [, res] = await Promise.all([
    click(fake, "https://race.com/x"),
    fake.runtime.dispatchMessage({ type: "domain/add", input: "race.com", source: "options" }),
  ]);
  assert.equal(res.outcome, "exists");
});
