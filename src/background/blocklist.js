import { normalizeInput } from "../shared/domain.js";
import { recordHits } from "./stats.js";
import { statsKey } from "../shared/stats.js";
import { keyFor, toStored, fromStored, recordsFromItems } from "../shared/records.js";

const SOURCES = ["options", "context-menu", "stub", "import"];

function failureReason(err) {
  return /quota/i.test(String(err?.message ?? err)) ? "quota" : "error";
}

async function readRecord(area, domain) {
  const key = keyFor(domain);
  const items = await area.get(key);
  return fromStored(key, items?.[key]);
}

async function writeRecord(area, rec) {
  await area.set({ [keyFor(rec.domain)]: toStored(rec) });
}

async function writeRestored(area, existing, now) {
  await writeRecord(area, { ...existing, status: "active", archivedAt: null, updatedAt: now });
}

export async function addDomain(area, input, source, now = Date.now()) {
  const norm = normalizeInput(input);
  if (!norm.ok) return { ok: false, reason: norm.reason };
  if (!SOURCES.includes(source)) return { ok: false, reason: "error" };
  const domain = norm.domain;

  try {
    const existing = await readRecord(area, domain);
    if (existing && existing.status === "active") {
      return { ok: true, domain, outcome: "exists" };
    }
    if (existing) {
      await writeRestored(area, existing, now);
      return { ok: true, domain, outcome: "restored" };
    }
    await writeRecord(area, {
      domain,
      status: "active",
      addedAt: now,
      updatedAt: now,
      archivedAt: null,
      source,
    });
    return { ok: true, domain, outcome: "added" };
  } catch (err) {
    return { ok: false, reason: failureReason(err) };
  }
}

export async function archiveDomain(area, domain, now = Date.now()) {
  try {
    const existing = await readRecord(area, domain);
    if (!existing) return { ok: false, reason: "not-found" };
    if (existing.status === "archived") {
      return { ok: true, domain, outcome: "already-archived" };
    }
    await writeRecord(area, { ...existing, status: "archived", archivedAt: now, updatedAt: now });
    return { ok: true, domain, outcome: "archived" };
  } catch (err) {
    return { ok: false, reason: failureReason(err) };
  }
}

export async function restoreDomain(area, domain, now = Date.now()) {
  try {
    const existing = await readRecord(area, domain);
    if (!existing) return { ok: false, domain, reason: "not-found" };
    if (existing.status === "active") return { ok: true, domain, outcome: "exists" };
    await writeRestored(area, existing, now);
    return { ok: true, domain, outcome: "restored" };
  } catch (err) {
    return { ok: false, domain, reason: failureReason(err) };
  }
}

export async function deleteDomain(areas, domain) {
  try {
    const existing = await readRecord(areas.sync, domain);
    if (!existing) return { ok: false, domain, reason: "not-found" };
    if (existing.status !== "archived") return { ok: false, domain, reason: "not-archived" };
    // Stats first: if the sync remove then fails, the record is still there
    // to retry instead of leaving unreachable orphan stats.
    await areas.local.remove(statsKey(domain));
    await areas.sync.remove(keyFor(domain));
    return { ok: true, domain, outcome: "deleted" };
  } catch {
    return { ok: false, domain, reason: "error" };
  }
}

export async function listRecords(area) {
  return recordsFromItems(await area.get(null));
}

export async function handleMessage(msg, areas, now = Date.now()) {
  switch (msg?.type) {
    case "domain/add":
      return addDomain(areas.sync, msg.input, msg.source, now);
    case "domain/archive":
      return archiveDomain(areas.sync, msg.domain, now);
    case "domain/restore":
      return restoreDomain(areas.sync, msg.domain, now);
    case "domain/delete":
      return deleteDomain(areas, msg.domain);
    case "stats/hits":
      return recordHits(areas, msg.hits, now);
    default:
      return { ok: false, reason: "error" };
  }
}
