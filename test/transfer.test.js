import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEMA_VERSION,
  buildExport,
  exportFilename,
  parseImport,
  planImport,
  itemBytes,
  checkSyncLimits,
  SYNC_MAX_ITEMS,
  SYNC_QUOTA_BYTES,
  SYNC_MARGIN_BYTES,
} from "../src/shared/transfer.js";
import { toStored } from "../src/shared/records.js";

const iso = (n) => new Date(n).toISOString();

function rec(domain, status = "active", extra = {}) {
  return {
    domain,
    status,
    addedAt: 1000,
    updatedAt: 2000,
    archivedAt: status === "archived" ? 3000 : null,
    source: status === "archived" ? "context-menu" : "options",
    ...extra,
  };
}

function fileOf(domains) {
  return JSON.stringify({ schemaVersion: 1, exportedAt: iso(0), extensionVersion: "0.1.0", domains });
}

function fileRec(domain, extra = {}) {
  return {
    domain,
    status: "active",
    addedAt: iso(1000),
    updatedAt: iso(2000),
    archivedAt: null,
    blockedCount: 1,
    lastBlockedAt: iso(1500),
    source: "options",
    ...extra,
  };
}

function entry(domain, extra = {}) {
  return { ...rec(domain), blockedCount: 0, lastBlockedAt: null, ...extra };
}

test("buildExport produces the 5.4 shape with ISO dates, sorted, archived included", () => {
  const records = [rec("b.com", "archived"), rec("a.com")];
  const stats = new Map([["a.com", { blockedCount: 4, lastBlockedAt: 5000 }]]);
  const out = buildExport(records, stats, { now: 9000, version: "0.1.0" });
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(out.schemaVersion, 1);
  assert.equal(out.exportedAt, iso(9000));
  assert.equal(out.extensionVersion, "0.1.0");
  assert.deepEqual(out.domains.map((d) => d.domain), ["a.com", "b.com"]);
  assert.deepEqual(out.domains[0], {
    domain: "a.com",
    status: "active",
    addedAt: iso(1000),
    updatedAt: iso(2000),
    archivedAt: null,
    blockedCount: 4,
    lastBlockedAt: iso(5000),
    source: "options",
  });
  assert.equal(out.domains[1].archivedAt, iso(3000));
  assert.equal(out.domains[1].blockedCount, 0);
  assert.equal(out.domains[1].lastBlockedAt, null);
});

test("exportFilename uses the local date", () => {
  assert.equal(exportFilename(new Date(2026, 9, 30, 23, 30).getTime()), "reddit-domain-blocker-2026-10-30.json");
  assert.equal(exportFilename(new Date(2026, 0, 2, 0, 5).getTime()), "reddit-domain-blocker-2026-01-02.json");
});

test("export then parse round-trips every field", () => {
  const records = [rec("b.com", "archived"), rec("a.com", "active", { source: "stub" })];
  const stats = new Map([
    ["a.com", { blockedCount: 4, lastBlockedAt: 5000 }],
    ["b.com", { blockedCount: 2, lastBlockedAt: null }],
  ]);
  const text = JSON.stringify(buildExport(records, stats, { now: 9000, version: "0.1.0" }));
  const parsed = parseImport(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.skipped, []);
  assert.deepEqual(parsed.entries, [
    { ...rec("a.com", "active", { source: "stub" }), blockedCount: 4, lastBlockedAt: 5000 },
    { ...rec("b.com", "archived"), blockedCount: 2, lastBlockedAt: null },
  ]);
});

test("parseImport rejects unreadable input", () => {
  for (const text of ["", "not json", "[]", "null", '{"schemaVersion":1}', '{"schemaVersion":1,"domains":{}}']) {
    assert.deepEqual(parseImport(text), { ok: false, reason: "unreadable" }, text);
  }
});

test("parseImport rejects other schema versions", () => {
  for (const text of ['{"schemaVersion":2,"domains":[]}', '{"schemaVersion":"1","domains":[]}', '{"domains":[]}']) {
    assert.deepEqual(parseImport(text), { ok: false, reason: "unsupported-version" }, text);
  }
});

test("parseImport skips bad records with reasons and keeps the rest", () => {
  const archivedNoDate = fileRec("c.com", { status: "archived" });
  const parsed = parseImport(
    fileOf([
      fileRec("a.com"),
      fileRec("reddit.com"),
      fileRec("not a domain"),
      fileRec("d.com", { addedAt: "yesterday" }),
      7,
      archivedNoDate,
      fileRec("e.com", { blockedCount: -1 }),
      fileRec("WWW.A.com"),
    ]),
  );
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entries.map((e) => e.domain), ["a.com"]);
  assert.deepEqual(parsed.skipped.map((s) => s.reason), [
    "protected",
    "invalid-domain",
    "invalid-record",
    "invalid-record",
    "invalid-record",
    "invalid-record",
    "duplicate",
  ]);
  assert.deepEqual(parsed.skipped[0], { index: 1, domain: "reddit.com", reason: "protected" });
  assert.equal(parsed.skipped[3].domain, null);
  assert.equal(parsed.skipped[3].index, 4);
});

test("parseImport skips a non-string domain as invalid-domain with a null raw domain", () => {
  const parsed = parseImport(fileOf([fileRec(["a.com"]), fileRec(123)]));
  assert.deepEqual(parsed.entries, []);
  assert.deepEqual(parsed.skipped, [
    { index: 0, domain: null, reason: "invalid-domain" },
    { index: 1, domain: null, reason: "invalid-domain" },
  ]);
});

test("parseImport normalizes domains", () => {
  const parsed = parseImport(fileOf([fileRec("https://WWW.Example.com/x")]));
  assert.equal(parsed.entries[0].domain, "example.com");
});

test("parseImport defaults missing counts and unknown sources", () => {
  const bare = fileRec("a.com", { source: "zzz" });
  delete bare.blockedCount;
  delete bare.lastBlockedAt;
  const noSource = fileRec("b.com");
  delete noSource.source;
  const parsed = parseImport(fileOf([bare, noSource]));
  assert.deepEqual(parsed.entries.map((e) => [e.blockedCount, e.lastBlockedAt, e.source]), [
    [0, null, "import"],
    [1, 1500, "import"],
  ]);
});

test("parseImport ignores archivedAt on an active record", () => {
  const parsed = parseImport(fileOf([fileRec("a.com", { archivedAt: iso(3000) })]));
  assert.equal(parsed.entries[0].archivedAt, null);
});

test("parseImport rejects a bad lastBlockedAt", () => {
  const parsed = parseImport(fileOf([fileRec("a.com", { lastBlockedAt: "soon" })]));
  assert.deepEqual(parsed.skipped.map((s) => s.reason), ["invalid-record"]);
});

test("planImport adds file-only domains with their metadata", () => {
  const e = entry("new.com", { blockedCount: 3, lastBlockedAt: 4000 });
  const plan = planImport([], new Map(), [e], "larger");
  assert.equal(plan.added, 1);
  assert.equal(plan.merged, 0);
  assert.deepEqual(plan.syncItems, { "d:new.com": toStored(e) });
  assert.deepEqual(plan.localItems, { "stats:new.com": { blockedCount: 3, lastBlockedAt: 4000 } });
});

function mergeSetup() {
  const records = [rec("a.com", "active", { addedAt: 100, updatedAt: 200 })];
  const stats = new Map([["a.com", { blockedCount: 5, lastBlockedAt: 300 }]]);
  const file = {
    ...rec("a.com", "archived", { addedAt: 50, updatedAt: 400, archivedAt: 400, source: "stub" }),
    blockedCount: 7,
    lastBlockedAt: 250,
  };
  return { records, stats, file };
}

test("planImport merges per 5.5", () => {
  const { records, stats, file } = mergeSetup();
  const larger = planImport(records, stats, [file], "larger");
  assert.equal(larger.added, 0);
  assert.equal(larger.merged, 1);
  assert.deepEqual(larger.syncItems["d:a.com"], { s: "x", c: 50, u: 400, x: 400, o: "o" });
  assert.deepEqual(larger.localItems["stats:a.com"], { blockedCount: 7, lastBlockedAt: 300 });
  const sum = planImport(records, stats, [file], "sum");
  assert.deepEqual(sum.localItems["stats:a.com"], { blockedCount: 12, lastBlockedAt: 300 });
});

test("planImport lets a newer active file record revive an archived one, with no x key", () => {
  const existing = rec("a.com", "archived", { addedAt: 100, updatedAt: 200, archivedAt: 200 });
  const file = entry("a.com", { addedAt: 100, updatedAt: 400 });
  const plan = planImport([existing], new Map(), [file], "larger");
  assert.equal(plan.syncItems["d:a.com"].s, "a");
  assert.equal("x" in plan.syncItems["d:a.com"], false);
});

test("planImport caps a sum at the largest safe integer", () => {
  const stats = new Map([["a.com", { blockedCount: Number.MAX_SAFE_INTEGER - 2, lastBlockedAt: null }]]);
  const plan = planImport([rec("a.com")], stats, [entry("a.com", { blockedCount: 5 })], "sum");
  assert.equal(plan.localItems["stats:a.com"].blockedCount, Number.MAX_SAFE_INTEGER);
});

test("planImport keeps the existing status when the existing record is newer or tied", () => {
  const existing = rec("a.com", "active", { updatedAt: 500 });
  for (const updatedAt of [500, 300]) {
    const file = entry("a.com", { status: "archived", archivedAt: 300, updatedAt, addedAt: 1000 });
    const plan = planImport([existing], new Map(), [file], "larger");
    assert.deepEqual(plan.syncItems, {}, `updatedAt ${updatedAt}`);
  }
});

test("planImport writes nothing when re-importing an identical export with larger", () => {
  const records = [rec("b.com", "archived"), rec("a.com")];
  const stats = new Map([["a.com", { blockedCount: 4, lastBlockedAt: 5000 }]]);
  const text = JSON.stringify(buildExport(records, stats, { now: 9000, version: "0.1.0" }));
  const { entries } = parseImport(text);
  const plan = planImport(records, stats, entries, "larger");
  assert.deepEqual(plan.syncItems, {});
  assert.deepEqual(plan.localItems, {});
  assert.equal(plan.added, 0);
  assert.equal(plan.merged, 2);
});

test("planImport treats missing existing stats as zero", () => {
  const plan = planImport([rec("a.com")], new Map(), [entry("a.com", { blockedCount: 2, lastBlockedAt: 9 })], "sum");
  assert.deepEqual(plan.localItems, { "stats:a.com": { blockedCount: 2, lastBlockedAt: 9 } });
  const none = planImport([rec("a.com")], new Map(), [entry("a.com")], "sum");
  assert.deepEqual(none.localItems, {});
});

function items(n) {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`d:k${i}.com`, { s: "a", c: 1, u: 1, o: "o" }]));
}

test("checkSyncLimits counts only new keys toward 512", () => {
  assert.equal(SYNC_MAX_ITEMS, 512);
  const current = items(510);
  const write = (names) => Object.fromEntries(names.map((n) => [n, { s: "a" }]));
  assert.deepEqual(
    checkSyncLimits({ currentItems: current, bytesInUse: 0, writes: write(["d:new1.com", "d:new2.com", "d:k0.com"]) }),
    { ok: true },
  );
  assert.deepEqual(
    checkSyncLimits({ currentItems: current, bytesInUse: 0, writes: write(["d:new1.com", "d:new2.com", "d:new3.com"]) }),
    { ok: false, reason: "too-many", over: 1 },
  );
});

test("checkSyncLimits measures bytes after overwrites", () => {
  const limit = SYNC_QUOTA_BYTES - SYNC_MARGIN_BYTES;
  const old = { s: "a", c: 1, u: 1, o: "o" };
  const same = { s: "a", c: 2, u: 2, o: "o" };
  const bigger = { s: "a", c: 22, u: 2, o: "o" };
  const currentItems = { "d:a.com": old };
  assert.equal(itemBytes("d:a.com", old), "d:a.com".length + JSON.stringify(old).length);
  assert.deepEqual(checkSyncLimits({ currentItems, bytesInUse: limit, writes: { "d:a.com": same } }), { ok: true });
  assert.deepEqual(checkSyncLimits({ currentItems, bytesInUse: limit, writes: { "d:a.com": bigger } }), {
    ok: false,
    reason: "too-large",
    over: 1,
  });
});
