import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { importDomains } from "../src/background/import.js";
import { handleMessage } from "../src/background/blocklist.js";

let fake;
let areas;
beforeEach(() => {
  fake = createFakeChrome();
  areas = { sync: fake.storage.sync, local: fake.storage.local };
});

const T = "2026-01-01T00:00:00.000Z";
const entry = (domain, extra = {}) => ({
  domain,
  status: "active",
  addedAt: T,
  updatedAt: T,
  archivedAt: null,
  blockedCount: 0,
  lastBlockedAt: null,
  source: "options",
  ...extra,
});
const file = (domains) => JSON.stringify({ schemaVersion: 1, exportedAt: T, extensionVersion: "1", domains });
const stored = (ms = Date.parse(T)) => ({ s: "a", c: ms, u: ms, o: "o" });

function spySets(area, log, name) {
  const orig = area.set;
  area.set = async (obj) => {
    log.push(name);
    return orig(obj);
  };
}

test("an import writes stats then records, one set() each", async () => {
  const log = [];
  spySets(areas.sync, log, "sync");
  spySets(areas.local, log, "local");
  const r = await importDomains(areas, file([entry("a.com", { blockedCount: 3 }), entry("b.com")]), "larger");
  assert.equal(r.ok, true);
  assert.deepEqual(log, ["local", "sync"]);
});

test("the result reports added, merged and skipped", async () => {
  await areas.sync.set({ "d:a.com": stored() });
  const r = await importDomains(areas, file([entry("a.com"), entry("b.com"), entry("nope")]), "larger");
  assert.deepEqual(r, { ok: true, outcome: "imported", added: 1, merged: 1, skipped: 1 });
});

test("re-importing your own export writes nothing", async () => {
  await areas.sync.set({ "d:a.com": stored() });
  await areas.local.set({ "stats:a.com": { blockedCount: 5, lastBlockedAt: Date.parse(T) } });
  const log = [];
  spySets(areas.sync, log, "sync");
  spySets(areas.local, log, "local");
  const text = file([entry("a.com", { blockedCount: 5, lastBlockedAt: T })]);
  const r = await importDomains(areas, text, "larger");
  assert.equal(r.ok, true);
  assert.deepEqual(log, []);
});

test("an import over 512 items is refused and changes nothing", async () => {
  const seed = {};
  for (let i = 0; i < 511; i++) seed[`d:s${i}.com`] = stored();
  await areas.sync.set(seed);
  const log = [];
  spySets(areas.sync, log, "sync");
  spySets(areas.local, log, "local");
  const r = await importDomains(areas, file([entry("x.com"), entry("y.com")]), "larger");
  assert.deepEqual(r, { ok: false, reason: "too-many", over: 1 });
  assert.deepEqual(log, []);
  assert.equal(Object.keys(await areas.sync.get(null)).length, 511);
});

test("an import over the byte limit is refused and changes nothing", async () => {
  areas.sync.overrideBytesInUse(102000);
  const log = [];
  spySets(areas.sync, log, "sync");
  spySets(areas.local, log, "local");
  const r = await importDomains(areas, file([entry("x.com")]), "larger");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too-large");
  assert.ok(r.over > 0);
  assert.deepEqual(log, []);
});

test("a failed sync write restores the stats that were written", async () => {
  await areas.sync.set({ "d:a.com": stored() });
  await areas.local.set({ "stats:a.com": { blockedCount: 5, lastBlockedAt: 300 } });
  areas.sync.failNextSet(new Error("QUOTA_BYTES quota exceeded"));
  const text = file([entry("a.com", { blockedCount: 4, lastBlockedAt: T }), entry("new.com", { blockedCount: 2 })]);
  const r = await importDomains(areas, text, "sum");
  assert.deepEqual(r, { ok: false, reason: "import-quota" });
  const local = await areas.local.get(null);
  assert.deepEqual(local["stats:a.com"], { blockedCount: 5, lastBlockedAt: 300 });
  assert.equal("stats:new.com" in local, false);
  assert.equal("d:new.com" in (await areas.sync.get(null)), false);
});

test("a failed local write is import-quota and leaves sync untouched", async () => {
  areas.local.failNextSet(new Error("QUOTA_BYTES quota exceeded"));
  const r = await importDomains(areas, file([entry("new.com", { blockedCount: 2 })]), "larger");
  assert.deepEqual(r, { ok: false, reason: "import-quota" });
  assert.deepEqual(await areas.sync.get(null), {});
});

test("a failed stats restore is logged and the original reason is still returned", async (t) => {
  await areas.sync.set({ "d:a.com": stored() });
  await areas.local.set({ "stats:a.com": { blockedCount: 5, lastBlockedAt: 300 } });
  const log = t.mock.method(console, "error", () => {});
  const realSet = areas.local.set.bind(areas.local);
  let calls = 0;
  areas.local.set = async (obj) => {
    if (++calls === 2) throw new Error("restore failed");
    return realSet(obj);
  };
  areas.sync.failNextSet(new Error("QUOTA_BYTES quota exceeded"));
  const r = await importDomains(areas, file([entry("a.com", { blockedCount: 9, updatedAt: "2027-01-01T00:00:00.000Z" })]), "larger");
  assert.deepEqual(r, { ok: false, reason: "import-quota" });
  assert.equal(log.mock.callCount(), 1);
});

test("unreadable text, a bad countMode, and an all-skipped file are refused", async () => {
  assert.deepEqual(await importDomains(areas, 42, "larger"), { ok: false, reason: "unreadable" });
  assert.deepEqual(await importDomains(areas, "not json", "larger"), { ok: false, reason: "unreadable" });
  assert.deepEqual(await importDomains(areas, file([entry("a.com")]), "max"), { ok: false, reason: "error" });
  assert.deepEqual(await importDomains(areas, file([entry("nope"), entry("reddit.com")]), "larger"), {
    ok: false,
    reason: "nothing-to-import",
    skipped: 2,
  });
  assert.deepEqual(await importDomains(areas, file([]), "larger"), { ok: false, reason: "nothing-to-import", skipped: 0 });
});

test("the worker plans against current storage, not the preview", async () => {
  const text = file([entry("c.com")]);
  await areas.sync.set({ "d:c.com": stored() });
  const r = await importDomains(areas, text, "larger");
  assert.deepEqual(r, { ok: true, outcome: "imported", added: 0, merged: 1, skipped: 0 });
});

test("handleMessage routes domain/import", async () => {
  const r = await handleMessage(
    { type: "domain/import", text: file([entry("a.com")]), countMode: "larger" },
    areas,
  );
  assert.deepEqual(r, { ok: true, outcome: "imported", added: 1, merged: 0, skipped: 0 });
  assert.ok("d:a.com" in (await areas.sync.get(null)));
});
