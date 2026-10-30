import { normalizeInput } from "../shared/domain.js";
import { keyFor } from "../shared/records.js";
import { statsKey, parseStats } from "../shared/stats.js";

const MAX_COUNT = 10000;

function validHits(hits) {
  const valid = new Map();
  if (hits === null || typeof hits !== "object" || Array.isArray(hits)) return valid;
  for (const [key, count] of Object.entries(hits)) {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_COUNT) continue;
    const norm = normalizeInput(key);
    if (norm.ok && norm.domain === key) valid.set(key, count);
  }
  return valid;
}

export async function recordHits(areas, hits, now = Date.now()) {
  const valid = validHits(hits);
  if (valid.size === 0) return { ok: true, recorded: 0 };
  try {
    const domains = [...valid.keys()];
    const synced = await areas.sync.get(domains.map(keyFor));
    const known = domains.filter((d) => keyFor(d) in synced);
    if (known.length === 0) return { ok: true, recorded: 0 };
    const current = await areas.local.get(known.map(statsKey));
    const updates = {};
    for (const domain of known) {
      const before = parseStats(current[statsKey(domain)]);
      updates[statsKey(domain)] = {
        blockedCount: (before?.blockedCount ?? 0) + valid.get(domain),
        lastBlockedAt: now,
      };
    }
    await areas.local.set(updates);
    return { ok: true, recorded: known.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
