import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { parseStats, statsFromItems, statsKey } from "../src/shared/stats.js";
import { recordHits } from "../src/background/stats.js";
import { handleMessage } from "../src/background/blocklist.js";

let sync, local, areas;
const rec = { s: "a", c: 1, u: 1, o: "o" };
const localData = async () => local.get(null);

beforeEach(async () => {
  const fake = createFakeChrome();
  sync = fake.storage.sync;
  local = fake.storage.local;
  areas = { sync, local };
  await sync.set({ "d:a.com": rec, "d:b.com": rec });
  await local.set({ "stats:a.com": { blockedCount: 2, lastBlockedAt: 1 } });
});

test("parseStats accepts valid values and rejects the rest", () => {
  assert.deepEqual(parseStats({ blockedCount: 3, lastBlockedAt: 5 }), { blockedCount: 3, lastBlockedAt: 5 });
  assert.deepEqual(parseStats({ blockedCount: 0, lastBlockedAt: null }), { blockedCount: 0, lastBlockedAt: null });
  for (const bad of [null, 3, [], { blockedCount: -1, lastBlockedAt: null }, { blockedCount: 1.5, lastBlockedAt: null },
    { blockedCount: "3", lastBlockedAt: null }, { blockedCount: 1, lastBlockedAt: "x" }, { blockedCount: NaN, lastBlockedAt: 1 }])
    assert.equal(parseStats(bad), null);
});

test("statsFromItems keeps valid stats entries and skips the rest", () => {
  const map = statsFromItems({
    "stats:a.com": { blockedCount: 1, lastBlockedAt: null },
    "stats:bad.com": "junk",
    "d:a.com": { blockedCount: 1, lastBlockedAt: null },
  });
  assert.deepEqual([...map.keys()], ["a.com"]);
  assert.equal(statsKey("a.com"), "stats:a.com");
});

test("recordHits adds to existing counts and sets lastBlockedAt", async () => {
  const res = await recordHits(areas, { "a.com": 3, "b.com": 1 }, 100);
  assert.deepEqual(res, { ok: true, recorded: 2 });
  const data = await localData();
  assert.deepEqual(data["stats:a.com"], { blockedCount: 5, lastBlockedAt: 100 });
  assert.deepEqual(data["stats:b.com"], { blockedCount: 1, lastBlockedAt: 100 });
});

test("recordHits counts archived domains too", async () => {
  await sync.set({ "d:a.com": { s: "x", c: 1, u: 1, x: 2, o: "o" } });
  await recordHits(areas, { "a.com": 1 }, 100);
  assert.equal((await localData())["stats:a.com"].blockedCount, 3);
});

test("recordHits drops hits for domains with no sync record", async () => {
  const res = await recordHits(areas, { "gone.com": 4 }, 100);
  assert.deepEqual(res, { ok: true, recorded: 0 });
  assert.equal("stats:gone.com" in (await localData()), false);
});

test("recordHits skips invalid entries and keeps valid ones", async () => {
  await sync.set({ "d:www.a.com": rec, "d:c.com": rec, "d:d.com": rec, "d:e.com": rec });
  const res = await recordHits(areas, {
    "a.com": 1, "WWW.A.com": 1, "reddit.com": 1, "b.com": -1, "c.com": 1.5, "d.com": "2", "e.com": 1e9,
  }, 100);
  assert.deepEqual(res, { ok: true, recorded: 1 });
  assert.deepEqual(Object.keys(await localData()).sort(), ["stats:a.com"]);
  assert.equal((await localData())["stats:a.com"].blockedCount, 3);
});

test("recordHits with a non-object hits writes nothing and is ok with recorded 0", async () => {
  for (const hits of [null, [], "x", undefined]) {
    assert.deepEqual(await recordHits(areas, hits, 1), { ok: true, recorded: 0 });
  }
  assert.deepEqual(await localData(), { "stats:a.com": { blockedCount: 2, lastBlockedAt: 1 } });
});

test("recordHits makes one local set() per call", async () => {
  let sets = 0;
  const set = local.set;
  local.set = async (obj) => {
    sets += 1;
    return set(obj);
  };
  await recordHits(areas, { "a.com": 1, "b.com": 1 }, 1);
  assert.equal(sets, 1);
});

test("a malformed existing stats value is treated as zero", async () => {
  await local.set({ "stats:a.com": "junk" });
  await recordHits(areas, { "a.com": 1 }, 7);
  assert.deepEqual((await localData())["stats:a.com"], { blockedCount: 1, lastBlockedAt: 7 });
});

test("a failed local write is reason error", async () => {
  local.failNextSet(new Error("x"));
  assert.deepEqual(await recordHits(areas, { "a.com": 1 }, 1), { ok: false, reason: "error" });
});

test("handleMessage routes stats/hits", async () => {
  const res = await handleMessage({ type: "stats/hits", hits: { "a.com": 1 } }, areas, 9);
  assert.deepEqual(res, { ok: true, recorded: 1 });
});
