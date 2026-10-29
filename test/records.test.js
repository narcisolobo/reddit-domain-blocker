import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEY_PREFIX,
  keyFor,
  toStored,
  fromStored,
  recordsFromItems,
  activeDomains,
} from "../src/shared/records.js";

const rec = {
  domain: "example.com",
  status: "active",
  addedAt: 1793297667000,
  updatedAt: 1793297667000,
  archivedAt: null,
  source: "options",
};
const active = rec;
const archived = {
  domain: "a.com",
  status: "archived",
  addedAt: 1,
  updatedAt: 3,
  archivedAt: 2,
  source: "stub",
};

test("keyFor prefixes the domain", () => {
  assert.equal(KEY_PREFIX, "d:");
  assert.equal(keyFor("example.com"), "d:example.com");
});

test("round trip, active omits x", () => {
  const stored = toStored(rec);
  assert.equal("x" in stored, false);
  assert.deepEqual(fromStored("d:example.com", stored), rec);
});

test("round trip, archived keeps x", () => {
  assert.deepEqual(fromStored("d:a.com", toStored(archived)), archived);
});

test("every source round trips", () => {
  for (const source of ["options", "context-menu", "stub", "import"]) {
    const r = { ...rec, source };
    assert.deepEqual(fromStored("d:example.com", toStored(r)), r);
  }
});

test("a typical record stays compact", () =>
  assert.ok(
    "d:thedailybeast.com".length + JSON.stringify(toStored(rec)).length < 130,
  ));

test("malformed entries are ignored", () => {
  const items = {
    "d:ok.com": toStored(rec),
    "d:bad.com": { s: "zzz" },
    "d:worse.com": "str",
    "d:n.com": null,
    "other:key": toStored(rec),
    "d:t.com": { s: "a", c: "1", u: 1, o: "o" },
  };
  assert.deepEqual(recordsFromItems(items).map((r) => r.domain), ["ok.com"]);
});

test("fromStored rejects each kind of bad value", () => {
  const good = { s: "a", c: 1, u: 2, o: "o" };
  assert.equal(fromStored("d:", good), null);
  assert.equal(fromStored("example.com", good), null);
  assert.equal(fromStored("d:a.com", []), null);
  assert.equal(fromStored("d:a.com", undefined), null);
  assert.equal(fromStored("d:a.com", { ...good, o: "q" }), null);
  assert.equal(fromStored("d:a.com", { ...good, c: Infinity }), null);
  assert.equal(fromStored("d:a.com", { ...good, u: NaN }), null);
  assert.equal(fromStored("d:a.com", { ...good, x: "5" }), null);
  assert.equal(fromStored("d:a.com", { ...good, s: "x" }), null);
});

test("activeDomains filters archived", () =>
  assert.deepEqual(activeDomains([active, archived]), ["example.com"]));
