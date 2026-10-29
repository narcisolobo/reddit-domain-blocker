import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "./helpers/fake-chrome.js";
import { addDomain, archiveDomain, listRecords, handleMessage } from "../src/background/blocklist.js";

let area;
beforeEach(() => {
  area = createFakeChrome().storage.sync;
});

const stored = async (domain) => (await area.get("d:" + domain))["d:" + domain];

test("add stores a compact active record", async () => {
  const r = await addDomain(area, "https://www.thedailybeast.com/x?y=1", "options", 1000);
  assert.deepEqual(r, { ok: true, domain: "thedailybeast.com", outcome: "added" });
  assert.deepEqual(await stored("thedailybeast.com"), { s: "a", c: 1000, u: 1000, o: "o" });
});

test("adding an active domain again is a no-op that says so", async () => {
  await addDomain(area, "a.com", "options", 1000);
  const r = await addDomain(area, "a.com", "context-menu", 2000);
  assert.deepEqual(r, { ok: true, domain: "a.com", outcome: "exists" });
  assert.deepEqual(await stored("a.com"), { s: "a", c: 1000, u: 1000, o: "o" });
});

test("adding an archived domain restores it", async () => {
  await addDomain(area, "a.com", "options", 1000);
  await archiveDomain(area, "a.com", 2000);
  const r = await addDomain(area, "a.com", "context-menu", 3000);
  assert.deepEqual(r, { ok: true, domain: "a.com", outcome: "restored" });
  const item = await stored("a.com");
  assert.deepEqual(item, { s: "a", c: 1000, u: 3000, o: "o" });
  assert.equal("x" in item, false);
});

test("protected and invalid input write nothing", async () => {
  assert.deepEqual(await addDomain(area, "old.reddit.com", "options", 1), { ok: false, reason: "protected" });
  assert.deepEqual(await addDomain(area, "http://10.0.0.1/", "options", 1), { ok: false, reason: "ip" });
  assert.deepEqual(await addDomain(area, "   ", "options", 1), { ok: false, reason: "empty" });
  assert.deepEqual(await area.get(null), {});
});

test("archive sets s x, x, u", async () => {
  await addDomain(area, "a.com", "import", 1000);
  const r = await archiveDomain(area, "a.com", 2500);
  assert.deepEqual(r, { ok: true, domain: "a.com", outcome: "archived" });
  assert.deepEqual(await stored("a.com"), { s: "x", c: 1000, u: 2500, x: 2500, o: "i" });
});

test("archiving twice is already-archived and leaves u alone", async () => {
  await addDomain(area, "a.com", "options", 1000);
  await archiveDomain(area, "a.com", 2000);
  const r = await archiveDomain(area, "a.com", 9000);
  assert.deepEqual(r, { ok: true, domain: "a.com", outcome: "already-archived" });
  assert.deepEqual(await stored("a.com"), { s: "x", c: 1000, u: 2000, x: 2000, o: "o" });
});

test("archiving an unknown domain is not-found", async () => {
  assert.deepEqual(await archiveDomain(area, "nope.com", 1), { ok: false, reason: "not-found" });
  assert.deepEqual(await area.get(null), {});
});

test("quota failure surfaces as reason quota", async () => {
  area.failNextSet(new Error("QUOTA_BYTES_PER_ITEM quota exceeded"));
  assert.deepEqual(await addDomain(area, "a.com", "options"), { ok: false, reason: "quota" });
});

test("any other write failure is reason error", async () => {
  area.failNextSet(new Error("boom"));
  assert.deepEqual(await addDomain(area, "a.com", "options"), { ok: false, reason: "error" });
  await addDomain(area, "b.com", "options", 1);
  area.failNextSet(new Error("boom"));
  assert.deepEqual(await archiveDomain(area, "b.com", 2), { ok: false, reason: "error" });
  area.failNextSet(new Error("quota exceeded"));
  assert.deepEqual(await archiveDomain(area, "b.com", 2), { ok: false, reason: "quota" });
});

test("read failure is reason error", async () => {
  area.get = async () => {
    throw new Error("read failed");
  };
  assert.deepEqual(await addDomain(area, "a.com", "options"), { ok: false, reason: "error" });
  assert.deepEqual(await archiveDomain(area, "a.com"), { ok: false, reason: "error" });
});

test("listRecords returns all stored records", async () => {
  await addDomain(area, "a.com", "options", 1);
  await addDomain(area, "b.com", "import", 2);
  await archiveDomain(area, "b.com", 3);
  const recs = await listRecords(area);
  assert.deepEqual(
    recs.map((r) => [r.domain, r.status]).sort(),
    [["a.com", "active"], ["b.com", "archived"]],
  );
});

test("handleMessage routes add and archive and rejects unknown types", async () => {
  const added = await handleMessage({ type: "domain/add", input: "a.com", source: "options" }, area, 1000);
  assert.deepEqual(added, { ok: true, domain: "a.com", outcome: "added" });
  const archived = await handleMessage({ type: "domain/archive", domain: "a.com" }, area, 2000);
  assert.deepEqual(archived, { ok: true, domain: "a.com", outcome: "archived" });
  assert.deepEqual(await handleMessage({ type: "bogus" }, area), { ok: false, reason: "error" });
  assert.deepEqual(await handleMessage(undefined, area), { ok: false, reason: "error" });
});

test("missing or unknown source is rejected and writes nothing", async () => {
  for (const source of [undefined, "bogus", "toString", "__proto__"]) {
    assert.deepEqual(await addDomain(area, "a.com", source, 1), { ok: false, reason: "error" });
    assert.deepEqual(await area.get(null), {});
  }
  const viaMessage = await handleMessage({ type: "domain/add", input: "a.com" }, area, 1);
  assert.deepEqual(viaMessage, { ok: false, reason: "error" });
  assert.deepEqual(await area.get(null), {});
});

test("failed quota write on add leaves storage empty", async () => {
  area.failNextSet(new Error("quota exceeded"));
  assert.deepEqual(await addDomain(area, "a.com", "options", 1), { ok: false, reason: "quota" });
  assert.deepEqual(await area.get(null), {});
});

test("failed archive leaves the active record intact", async () => {
  await addDomain(area, "a.com", "options", 1000);
  area.failNextSet(new Error("boom"));
  assert.deepEqual(await archiveDomain(area, "a.com", 2000), { ok: false, reason: "error" });
  assert.deepEqual(await stored("a.com"), { s: "a", c: 1000, u: 1000, o: "o" });
});

test("handleMessage rejects null and string messages", async () => {
  assert.deepEqual(await handleMessage(null, area), { ok: false, reason: "error" });
  assert.deepEqual(await handleMessage("domain/add", area), { ok: false, reason: "error" });
  assert.deepEqual(await area.get(null), {});
});
