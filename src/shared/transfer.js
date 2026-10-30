import { normalizeInput } from "./domain.js";
import { keyFor, toStored, validTime } from "./records.js";
import { statsKey } from "./stats.js";

export const SCHEMA_VERSION = 1;
export const SYNC_MAX_ITEMS = 512;
export const SYNC_QUOTA_BYTES = 102400;
export const SYNC_MARGIN_BYTES = 1024;

const SOURCES = ["options", "context-menu", "stub", "import"];

const isoOrNull = (ms) => (ms === null ? null : new Date(ms).toISOString());

export function buildExport(records, stats, { now, version }) {
  const domains = [...records]
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0))
    .map((r) => {
      const s = stats.get(r.domain);
      return {
        domain: r.domain,
        status: r.status,
        addedAt: isoOrNull(r.addedAt),
        updatedAt: isoOrNull(r.updatedAt),
        archivedAt: isoOrNull(r.archivedAt),
        blockedCount: s ? s.blockedCount : 0,
        lastBlockedAt: isoOrNull(s ? s.lastBlockedAt : null),
        source: r.source,
      };
    });
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    extensionVersion: version,
    domains,
  };
}

export function exportFilename(now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `reddit-domain-blocker-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDate(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return validTime(ms) ? ms : null;
}

function parseEntry(raw, domain) {
  if (raw.status !== "active" && raw.status !== "archived") return null;
  const addedAt = parseDate(raw.addedAt);
  const updatedAt = parseDate(raw.updatedAt);
  if (addedAt === null || updatedAt === null) return null;

  const archived = raw.status === "archived";
  const archivedAt = archived ? parseDate(raw.archivedAt) : null;
  if (archived && archivedAt === null) return null;

  let blockedCount = 0;
  if (raw.blockedCount !== undefined) {
    if (!Number.isSafeInteger(raw.blockedCount) || raw.blockedCount < 0) return null;
    blockedCount = raw.blockedCount;
  }
  let lastBlockedAt = null;
  if (raw.lastBlockedAt !== undefined && raw.lastBlockedAt !== null) {
    lastBlockedAt = parseDate(raw.lastBlockedAt);
    if (lastBlockedAt === null) return null;
  }

  return {
    domain,
    status: raw.status,
    addedAt,
    updatedAt,
    archivedAt,
    source: SOURCES.includes(raw.source) ? raw.source : "import",
    blockedCount,
    lastBlockedAt,
  };
}

export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!isObject(data) || !Array.isArray(data.domains)) return { ok: false, reason: "unreadable" };
  if (data.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: "unsupported-version" };

  const entries = [];
  const skipped = [];
  const seen = new Set();
  data.domains.forEach((raw, index) => {
    const skip = (reason) => {
      const domain = isObject(raw) && typeof raw.domain === "string" ? raw.domain : null;
      skipped.push({ index, domain, reason });
    };
    if (!isObject(raw)) return skip("invalid-record");
    if (typeof raw.domain !== "string") return skip("invalid-domain");
    const normalized = normalizeInput(raw.domain);
    if (!normalized.ok) return skip(normalized.reason === "protected" ? "protected" : "invalid-domain");
    const entry = parseEntry(raw, normalized.domain);
    if (!entry) return skip("invalid-record");
    if (seen.has(entry.domain)) return skip("duplicate");
    seen.add(entry.domain);
    entries.push(entry);
  });
  return { ok: true, entries, skipped };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function latest(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function mergeRecord(existing, entry) {
  const fileWins = entry.updatedAt > existing.updatedAt;
  const winner = fileWins ? entry : existing;
  return {
    domain: existing.domain,
    status: winner.status,
    addedAt: Math.min(existing.addedAt, entry.addedAt),
    updatedAt: Math.max(existing.updatedAt, entry.updatedAt),
    archivedAt: winner.archivedAt,
    source: existing.source,
  };
}

function mergeStats(current, entry, countMode) {
  const count =
    countMode === "sum"
      ? Math.min(current.blockedCount + entry.blockedCount, Number.MAX_SAFE_INTEGER)
      : Math.max(current.blockedCount, entry.blockedCount);
  return { blockedCount: count, lastBlockedAt: latest(current.lastBlockedAt, entry.lastBlockedAt) };
}

export function planImport(records, stats, entries, countMode) {
  const byDomain = new Map(records.map((r) => [r.domain, r]));
  const plan = { added: 0, merged: 0, syncItems: {}, localItems: {} };

  for (const entry of entries) {
    const existing = byDomain.get(entry.domain);
    const current = stats.get(entry.domain);
    let record;
    let nextStats;
    if (existing) {
      plan.merged++;
      record = mergeRecord(existing, entry);
      nextStats = mergeStats(current ?? { blockedCount: 0, lastBlockedAt: null }, entry, countMode);
    } else {
      plan.added++;
      record = entry;
      nextStats = { blockedCount: entry.blockedCount, lastBlockedAt: entry.lastBlockedAt };
    }

    const stored = toStored(record);
    if (!existing || !sameJson(stored, toStored(existing))) plan.syncItems[keyFor(entry.domain)] = stored;
    const before = current ?? (existing ? { blockedCount: 0, lastBlockedAt: null } : null);
    if (!before || !sameJson(nextStats, before)) plan.localItems[statsKey(entry.domain)] = nextStats;
  }
  return plan;
}

export function itemBytes(key, value) {
  return key.length + JSON.stringify(value).length;
}

export function checkSyncLimits({ currentItems, bytesInUse, writes }) {
  let items = Object.keys(currentItems).length;
  let bytes = bytesInUse;
  for (const [key, value] of Object.entries(writes)) {
    if (Object.hasOwn(currentItems, key)) bytes -= itemBytes(key, currentItems[key]);
    else items++;
    bytes += itemBytes(key, value);
  }
  if (items > SYNC_MAX_ITEMS) return { ok: false, reason: "too-many", over: items - SYNC_MAX_ITEMS };
  const over = bytes - (SYNC_QUOTA_BYTES - SYNC_MARGIN_BYTES);
  if (over > 0) return { ok: false, reason: "too-large", over };
  return { ok: true };
}
