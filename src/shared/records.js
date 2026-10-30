export const KEY_PREFIX = "d:";

const SOURCE_TO_CODE = {
  options: "o",
  "context-menu": "m",
  stub: "s",
  import: "i",
};
const CODE_TO_SOURCE = Object.fromEntries(
  Object.entries(SOURCE_TO_CODE).map(([source, code]) => [code, source]),
);

// The valid JS Date range; anything beyond it would throw in toISOString().
const MAX_TIME = 8.64e15;
export const validTime =(n) => Number.isFinite(n) && Math.abs(n) <= MAX_TIME;

export function keyFor(domain) {
  return KEY_PREFIX + domain;
}

export function toStored(rec) {
  const stored = {
    s: rec.status === "archived" ? "x" : "a",
    c: rec.addedAt,
    u: rec.updatedAt,
  };
  if (rec.status === "archived") stored.x = rec.archivedAt;
  stored.o = SOURCE_TO_CODE[rec.source];
  return stored;
}

export function fromStored(key, stored) {
  if (typeof key !== "string" || !key.startsWith(KEY_PREFIX)) return null;
  const domain = key.slice(KEY_PREFIX.length);
  if (!domain) return null;
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    return null;
  }
  if (stored.s !== "a" && stored.s !== "x") return null;
  if (!Object.hasOwn(CODE_TO_SOURCE, stored.o)) return null;
  if (!validTime(stored.c) || !validTime(stored.u)) return null;
  if ("x" in stored && !validTime(stored.x)) return null;

  const archived = stored.s === "x";
  if (archived && !("x" in stored)) return null;

  return {
    domain,
    status: archived ? "archived" : "active",
    addedAt: stored.c,
    updatedAt: stored.u,
    archivedAt: archived ? stored.x : null,
    source: CODE_TO_SOURCE[stored.o],
  };
}

export function recordsFromItems(items) {
  const records = [];
  for (const [key, value] of Object.entries(items ?? {})) {
    const rec = fromStored(key, value);
    if (rec) records.push(rec);
  }
  return records;
}

export function activeDomains(records) {
  return records.filter((r) => r.status === "active").map((r) => r.domain);
}
